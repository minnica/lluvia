import "server-only";
import { z } from "zod";
import { routingRequestSchema } from "@/domain/routing/contracts";
import type { RoutingRequest } from "@/domain/routing/contracts";
import { createRoutingProvider } from "@/server/providers/routing/factory";
import { TomTomRoutingProvider, RoutingFailure } from "@/server/providers/routing/tomtom";

export const routeInputSchema = routingRequestSchema.omit({ departureAt: true }).extend({
  via: z.array(routingRequestSchema.shape.origin).max(4),
  avoid: z.array(z.enum(["tolls", "motorways", "unpaved"])).max(3),
}).strict();

export async function readRouteInput(request: Request) {
  const body = await request.text();
  if (body.length > 16_000) throw new RoutingFailure("invalid-input", "Solicitud demasiado grande");
  let raw: unknown;
  try { raw = JSON.parse(body); } catch { throw new RoutingFailure("invalid-input", "JSON de recorrido inválido"); }
  const parsed = routeInputSchema.safeParse(raw);
  if (!parsed.success) throw new RoutingFailure("invalid-input", "Origen, destino o preferencias inválidos");
  return parsed.data;
}

export async function getRoute(input: z.infer<typeof routeInputSchema>, signal: AbortSignal) {
  const request: RoutingRequest = { ...input, departureAt: new Date().toISOString(), signal };
  const provider = createRoutingProvider({ tomtom: () => new TomTomRoutingProvider() });
  const result = await provider.getRoutes(request);
  if (!result.routes.length) throw new RoutingFailure("unavailable", "No se encontró una ruta entre estos puntos");
  return { response: result, route: result.routes[0] };
}

export function routeError(error: unknown): Response {
  const detail = error instanceof RoutingFailure ? error : new RoutingFailure("unavailable", "No se pudo calcular el recorrido");
  const status = detail.code === "configuration" ? 503 : detail.code === "quota" ? 429 :
    detail.code === "timeout" ? 504 : detail.code === "invalid-input" ? 400 : 502;
  return Response.json({ error: detail.message, code: detail.code }, { status, headers: { "Cache-Control": "no-store" } });
}
