import "server-only";
import { createHash, randomBytes } from "node:crypto";

const salt = randomBytes(16);
const windows = new Map<string, { count: number; resetAt: number }>();

// This is a burst guard for one function instance. Deployment-wide limits belong at the edge.
export function checkRequestLimit(request: Request, scope: string, maxPerMinute: number): number | null {
  const now = Date.now();
  const address = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
  const key = createHash("sha256").update(salt).update(scope).update(address).digest("hex");
  const current = windows.get(key);
  if (windows.size >= 2000) {
    for (const [id, item] of windows) if (item.resetAt <= now) windows.delete(id);
    if (windows.size >= 2000) windows.delete(windows.keys().next().value!);
  }
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + 60_000 });
    return null;
  }
  if (current.count >= maxPerMinute) return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  current.count++;
  return null;
}

export function limitedResponse(retryAfterSeconds: number): Response {
  return Response.json({ code: "quota", error: "Demasiadas consultas seguidas. Espera un minuto y vuelve a intentar." },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfterSeconds) } });
}
