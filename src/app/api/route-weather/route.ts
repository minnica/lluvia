import { weatherRequestSchema, type WeatherResponse } from "@/domain/weather/contracts";
import { assessRoute } from "@/domain/routing/exposure";
import { compareDepartures, departureOffsets } from "@/domain/routing/comparison";
import { sampleRoute } from "@/domain/routing/sampling";
import type { Route } from "@/domain/routing/contracts";
import { getRoute, readRouteInput, routeError } from "@/server/routes/service";
import { RoutingFailure } from "@/server/providers/routing/tomtom";
import { createWeatherProvider } from "@/server/providers/weather/factory";
import { OpenMeteoProvider, WeatherProviderFailure } from "@/server/providers/weather/open-meteo";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const input = await readRouteInput(request);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    const decisionAt = new Date().toISOString();
    const { response, route } = await getRoute(input, signal, decisionAt);
    if (route.durationSeconds > 4 * 3600) return Response.json({ error: "El recorrido supera las 4 horas admitidas" }, { status: 422 });
    const routes: Array<Route | null> = [route];
    const routingErrors: Array<string | null> = [null];
    const later = await Promise.all(departureOffsets.slice(1).map(async (offset) => {
      try {
        const departure = new Date(Date.parse(decisionAt) + offset * 60_000).toISOString();
        const result = await getRoute(input, signal, departure);
        if (result.route.durationSeconds > 4 * 3600) throw new Error("El recorrido supera las 4 horas admitidas");
        sampleRoute(result.route);
        return { route: result.route, error: null };
      } catch (error) {
        return { route: null, error: error instanceof Error ? error.message : "No se pudo calcular esta salida" };
      }
    }));
    for (const result of later) { routes.push(result.route); routingErrors.push(result.error); }
    const segmentsByRoute = routes.map((item) => item ? sampleRoute(item) : []);
    const uniquePoints = new Map<string, { id: string; position: typeof segmentsByRoute[number][number]["midpoint"]["position"] }>();
    const pointIds = segmentsByRoute.map((segments) => segments.map((segment) => {
      const position = segment.midpoint.position;
      const key = `${position.lat.toFixed(6)},${position.lon.toFixed(6)}`;
      if (!uniquePoints.has(key)) uniquePoints.set(key, { id: `p${uniquePoints.size + 1}`, position });
      return uniquePoints.get(key)!.id;
    }));
    const end = Math.max(...routes.filter((item): item is Route => item !== null).map((item) =>
      Date.parse(item.requestedDepartureAt) + item.durationSeconds * 1000));
    const weatherRequest = weatherRequestSchema.parse({
      points: [...uniquePoints.values()],
      period: { start: new Date(Date.parse(decisionAt) - 10 * 60_000).toISOString(),
        end: new Date(end + 10 * 60_000).toISOString() },
      variables: ["precipitationProbability", "precipitationAmount", "precipitationRate"],
    });
    let forecast: WeatherResponse;
    let weatherError: string | null = null;
    try {
      const provider = createWeatherProvider({ "open-meteo": () => new OpenMeteoProvider() });
      forecast = await provider.getForecast({ ...weatherRequest, signal });
    } catch (error) {
      weatherError = error instanceof WeatherProviderFailure ? error.message : "No se pudo obtener el pronóstico de la ruta";
      forecast = { schemaVersion: 1, provider: "open-meteo", adapterVersion: "1", requestId: crypto.randomUUID(),
        points: weatherRequest.points.map(({ id, position }) => ({ pointId: id, requestedPoint: position, resolvedPoint: null,
          status: "unavailable", values: [], availablePeriods: [], warnings: [],
          error: { code: "unavailable", retryable: true, message: weatherError! } })) };
    }
    const routeForecasts = segmentsByRoute.map((segments, routeIndex): WeatherResponse => ({ ...forecast,
      points: segments.map((segment, segmentIndex) => {
        const point = forecast.points.find((item) => item.pointId === pointIds[routeIndex][segmentIndex]);
        return { ...point!, pointId: segment.id, requestedPoint: segment.midpoint.position };
      }),
    }));
    const comparison = compareDepartures(routes, routeForecasts, routingErrors, decisionAt, Date.now());
    return Response.json({ routing: response, route, forecast, assessment: assessRoute(route, routeForecasts[0], Date.now()),
      comparison, weatherError },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!(error instanceof RoutingFailure) && error instanceof Error && error.message.includes("demasiados puntos")) {
      return Response.json({ error: error.message }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }
    return routeError(error);
  }
}
