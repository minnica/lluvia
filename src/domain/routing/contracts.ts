import { z } from "zod";
import { instantSchema, pointSchema } from "@/domain/provider-common";
import type { Point } from "@/domain/provider-common";

const nonNegative = z.number().finite().nonnegative();
export const profileSchema = z.enum(["motorcycle", "car"]);

export const routingRequestSchema = z.object({
  origin: pointSchema,
  destination: pointSchema,
  via: z.array(pointSchema),
  departureAt: instantSchema,
  profile: profileSchema,
  avoid: z.array(z.enum(["tolls", "motorways", "unpaved"])),
}).strict();

export const routePointSchema = z.object({
  position: pointSchema,
  distanceFromStartM: nonNegative,
  durationFromStartSeconds: nonNegative,
}).strict();

const lineStringSchema = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(z.tuple([
    z.number().finite().min(-180).max(180),
    z.number().finite().min(-90).max(90),
  ])).min(2),
}).strict();

export const routeSchema = z.object({
  id: z.string().min(1),
  geometry: lineStringSchema,
  progress: z.array(routePointSchema).min(2),
  durationSeconds: nonNegative,
  distanceM: nonNegative,
  requestedDepartureAt: instantSchema,
  retrievedAt: instantSchema,
  requestedProfile: profileSchema,
  effectiveProfile: z.enum(["motorcycle", "car", "mixed", "unknown"]),
  traffic: z.enum(["live-and-historical", "historical", "none", "unknown"]),
  warnings: z.array(z.string()),
}).strict().superRefine((route, ctx) => {
  if (route.progress.length !== route.geometry.coordinates.length) {
    ctx.addIssue({ code: "custom", path: ["progress"], message: "Cada vértice requiere un tiempo acumulado" });
    return;
  }
  route.progress.forEach((point, index) => {
    const coordinate = route.geometry.coordinates[index];
    if (point.position.lon !== coordinate[0] || point.position.lat !== coordinate[1]) {
      ctx.addIssue({ code: "custom", path: ["progress", index, "position"], message: "El progreso debe corresponder a la geometría" });
    }
    if (index === 0) {
      if (point.distanceFromStartM !== 0 || point.durationFromStartSeconds !== 0) {
        ctx.addIssue({ code: "custom", path: ["progress", index], message: "La ruta debe iniciar en cero" });
      }
    } else {
      const previous = route.progress[index - 1];
      if (point.distanceFromStartM < previous.distanceFromStartM ||
          point.durationFromStartSeconds < previous.durationFromStartSeconds) {
        ctx.addIssue({ code: "custom", path: ["progress", index], message: "Distancia y duración deben ser monótonas" });
      }
    }
  });
  const last = route.progress.at(-1);
  if (last?.distanceFromStartM !== route.distanceM || last?.durationFromStartSeconds !== route.durationSeconds) {
    ctx.addIssue({ code: "custom", path: ["progress"], message: "El progreso final debe coincidir con los totales" });
  }
  if (route.requestedProfile !== route.effectiveProfile && route.warnings.length === 0) {
    ctx.addIssue({ code: "custom", path: ["warnings"], message: "Un perfil aproximado debe explicarse" });
  }
});

export const routingCapabilitiesSchema = z.object({
  profiles: z.array(profileSchema),
  departureTimeSupported: z.boolean(),
  cumulativeTimesSupported: z.boolean(),
  warnings: z.array(z.string()),
}).strict();

export const routingResponseSchema = z.object({
  schemaVersion: z.literal(1),
  provider: z.string().min(1),
  adapterVersion: z.string().min(1),
  routes: z.array(routeSchema),
}).strict();

export type RoutingRequest = z.infer<typeof routingRequestSchema> & { signal?: AbortSignal };
export type RoutePoint = z.infer<typeof routePointSchema>;
export type Route = z.infer<typeof routeSchema>;
export type RoutingCapabilities = z.infer<typeof routingCapabilitiesSchema>;
export type RoutingResponse = z.infer<typeof routingResponseSchema>;

export interface RoutingProvider {
  readonly id: string;
  getCapabilities(point: Point): Promise<RoutingCapabilities>;
  getRoutes(request: RoutingRequest): Promise<RoutingResponse>;
}

export function validateRoutingResponse(response: unknown, request: RoutingRequest): RoutingResponse {
  const parsed = routingResponseSchema.parse(response);
  for (const route of parsed.routes) {
    const first = route.progress[0].position;
    const last = route.progress[route.progress.length - 1].position;
    if (first.lat !== request.origin.lat || first.lon !== request.origin.lon ||
        last.lat !== request.destination.lat || last.lon !== request.destination.lon ||
        route.requestedDepartureAt !== request.departureAt || route.requestedProfile !== request.profile) {
      throw new Error("La ruta no corresponde a la solicitud");
    }
  }
  return parsed;
}

