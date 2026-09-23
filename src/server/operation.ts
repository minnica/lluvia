import "server-only";

type Outcome = "ok" | "partial" | "error";

// Operational events deliberately omit coordinates, search text, URLs and provider keys.
export function recordOperation(name: "weather" | "routes" | "route-weather" | "geocode", startedAt: number,
  outcome: Outcome, details: { code?: string; maxProviderCalls?: number; points?: number } = {}) {
  console.info(JSON.stringify({ event: "lluvia.api", name, outcome,
    durationMs: Date.now() - startedAt, ...details }));
}
