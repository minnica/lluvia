import "server-only";
import { z } from "zod";
import type { Point } from "@/domain/provider-common";
import { distanceM } from "@/domain/routing/geometry";
import { validateRoutingResponse, type Route, type RoutingCapabilities, type RoutingProvider, type RoutingRequest, type RoutingResponse } from "@/domain/routing/contracts";

const coordinate = z.object({ latitude: z.number().finite(), longitude: z.number().finite() });
const responseSchema = z.object({ routes: z.array(z.object({
  summary: z.object({ lengthInMeters: z.number().nonnegative(), travelTimeInSeconds: z.number().nonnegative() }),
  legs: z.array(z.object({ points: z.array(coordinate).min(2) })).min(1),
  progress: z.array(z.object({ pointIndex: z.number().int().nonnegative(), distanceInMeters: z.number().nonnegative(), travelTimeInSeconds: z.number().nonnegative() })).min(2),
  sections: z.array(z.object({ sectionType: z.string(), travelMode: z.string().optional() })).optional(),
})).min(1) });

export class RoutingFailure extends Error {
  constructor(readonly code: "invalid-input" | "configuration" | "quota" | "timeout" | "unavailable" | "invalid-response", message: string) { super(message); }
}

const toPoint = (value: z.infer<typeof coordinate>): Point => ({ lat: value.latitude, lon: value.longitude });

export function normalizeTomTom(raw: unknown, request: RoutingRequest, retrievedAt: string): RoutingResponse {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new RoutingFailure("invalid-response", "TomTom devolvió una ruta incompleta");
  const routes: Route[] = parsed.data.routes.map((source) => {
    if (source.legs.length !== request.via.length + 1) throw new RoutingFailure("invalid-response", "No se conservaron los puntos intermedios");
    for (let index = 1; index < source.progress.length; index++) {
      const previous = source.progress[index - 1];
      const current = source.progress[index];
      if (current.pointIndex <= previous.pointIndex || current.distanceInMeters < previous.distanceInMeters ||
          current.travelTimeInSeconds < previous.travelTimeInSeconds) {
        throw new RoutingFailure("invalid-response", "TomTom devolvió progreso desordenado");
      }
    }
    const joined = source.legs.flatMap((leg, index) => index === 0 ? leg.points : leg.points.slice(1)).map(toPoint);
    const separate = source.legs.flatMap((leg) => leg.points).map(toPoint);
    const lastIndex = source.progress.at(-1)!.pointIndex;
    const points = lastIndex === joined.length - 1 ? joined : lastIndex === separate.length - 1 ? separate : [];
    if (points.length < 2) throw new RoutingFailure("invalid-response", "La geometría de la ruta está incompleta");
    for (let index = 0; index < request.via.length; index++) {
      const end = toPoint(source.legs[index].points.at(-1)!);
      if (distanceM(end, request.via[index]) > 1000) throw new RoutingFailure("invalid-response", "La ruta no pasa por un punto intermedio solicitado");
    }
    const sparse = source.progress;
    if (sparse[0].pointIndex !== 0 || sparse.at(-1)!.pointIndex !== points.length - 1 ||
        sparse[0].distanceInMeters !== 0 || sparse[0].travelTimeInSeconds !== 0 ||
        sparse.at(-1)!.distanceInMeters !== source.summary.lengthInMeters ||
        sparse.at(-1)!.travelTimeInSeconds !== source.summary.travelTimeInSeconds) {
      throw new RoutingFailure("invalid-response", "TomTom no entregó progreso completo en los extremos");
    }
    const progress = points.map((position, index) => {
      const rightIndex = sparse.findIndex((item) => item.pointIndex >= index);
      if (rightIndex < 0) throw new RoutingFailure("invalid-response", "Índices de progreso incompletos");
      const right = sparse[rightIndex];
      const left = sparse[Math.max(0, rightIndex - 1)];
      if (right.pointIndex < left.pointIndex || right.distanceInMeters < left.distanceInMeters ||
          right.travelTimeInSeconds < left.travelTimeInSeconds) throw new RoutingFailure("invalid-response", "Progreso desordenado");
      let fraction = 0;
      if (right.pointIndex > left.pointIndex) {
        let partial = 0;
        let total = 0;
        for (let vertex = left.pointIndex + 1; vertex <= right.pointIndex; vertex++) {
          const length = distanceM(points[vertex - 1], points[vertex]);
          total += length;
          if (vertex <= index) partial += length;
        }
        fraction = total > 0 ? partial / total : (index - left.pointIndex) / (right.pointIndex - left.pointIndex);
      }
      return { position,
        distanceFromStartM: left.distanceInMeters + (right.distanceInMeters - left.distanceInMeters) * fraction,
        durationFromStartSeconds: left.travelTimeInSeconds + (right.travelTimeInSeconds - left.travelTimeInSeconds) * fraction };
    });
    const modeSections = (source.sections ?? []).filter((section) => section.sectionType.toUpperCase() === "TRAVEL_MODE");
    const effectiveProfile = !modeSections.length ? "unknown" : modeSections.every((section) => section.travelMode === request.profile)
      ? request.profile : modeSections.every((section) => section.travelMode === "other") ? "unknown" : "mixed";
    const warnings = ["El perfil de motocicleta de TomTom es beta y puede tener restricciones incompletas."];
    if (effectiveProfile !== request.profile) warnings.push("El modo solicitado no pudo verificarse en todos los tramos; revisa la ruta antes de salir.");
    if (sparse.length < points.length) warnings.push("Tiempos entre puntos de progreso interpolados según distancia sobre la geometría.");
    if (distanceM(points[0], request.origin) > 100 || distanceM(points.at(-1)!, request.destination) > 100) warnings.push("TomTom ajustó origen o destino a una vía cercana.");
    return {
      id: crypto.randomUUID(), geometry: { type: "LineString", coordinates: points.map((point) => [point.lon, point.lat]) }, progress,
      durationSeconds: source.summary.travelTimeInSeconds, distanceM: source.summary.lengthInMeters,
      requestedDepartureAt: request.departureAt, retrievedAt, requestedProfile: request.profile,
      effectiveProfile, traffic: "live-and-historical", warnings,
    };
  });
  return validateRoutingResponse({ schemaVersion: 1, provider: "tomtom", adapterVersion: "1", routes }, request);
}

export class TomTomRoutingProvider implements RoutingProvider {
  readonly id = "tomtom";
  async getCapabilities(_point: Point): Promise<RoutingCapabilities> {
    void _point;
    return { profiles: ["motorcycle", "car"], departureTimeSupported: true, cumulativeTimesSupported: true,
      warnings: ["Motocicleta es un perfil beta de TomTom; las restricciones pueden ser incompletas."] };
  }
  async getRoutes(request: RoutingRequest): Promise<RoutingResponse> {
    const key = process.env.TOMTOM_API_KEY;
    if (!key) throw new RoutingFailure("configuration", "Falta configurar TOMTOM_API_KEY para recorridos");
    const positions = [request.origin, ...request.via, request.destination].map((point) => `${point.lat},${point.lon}`).join(":");
    const url = new URL(`https://api.tomtom.com/routing/1/calculateRoute/${positions}/json`);
    url.searchParams.set("key", key);
    url.searchParams.set("travelMode", request.profile);
    url.searchParams.set("departAt", request.departureAt);
    url.searchParams.set("traffic", "true");
    url.searchParams.set("routeRepresentation", "polyline");
    url.searchParams.append("extendedRouteRepresentation", "distance");
    url.searchParams.append("extendedRouteRepresentation", "travelTime");
    url.searchParams.set("sectionType", "travelMode");
    const avoid = { tolls: "tollRoads", motorways: "motorways", unpaved: "unpavedRoads" } as const;
    for (const preference of request.avoid) url.searchParams.append("avoid", avoid[preference]);
    let response: Response;
    try { response = await fetch(url, { cache: "no-store", signal: request.signal }); }
    catch {
      if (request.signal?.aborted) throw new RoutingFailure("timeout", "La ruta agotó el tiempo de espera");
      throw new RoutingFailure("unavailable", "TomTom no está disponible");
    }
    if (response.status === 429) throw new RoutingFailure("quota", "Se alcanzó la cuota de rutas");
    if (!response.ok) throw new RoutingFailure("unavailable", `TomTom respondió con estado ${response.status}`);
    try { return normalizeTomTom(await response.json(), request, new Date().toISOString()); }
    catch (error) {
      if (error instanceof RoutingFailure) throw error;
      throw new RoutingFailure("invalid-response", "No se pudo interpretar la ruta de TomTom");
    }
  }
}
