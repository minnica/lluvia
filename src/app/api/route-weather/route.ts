import { weatherRequestSchema, type WeatherResponse } from "@/domain/weather/contracts";
import { assessRoute } from "@/domain/routing/exposure";
import { sampleRoute } from "@/domain/routing/sampling";
import { getRoute, readRouteInput, routeError } from "@/server/routes/service";
import { RoutingFailure } from "@/server/providers/routing/tomtom";
import { createWeatherProvider } from "@/server/providers/weather/factory";
import { OpenMeteoProvider, WeatherProviderFailure } from "@/server/providers/weather/open-meteo";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const input = await readRouteInput(request);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    const { response, route } = await getRoute(input, signal);
    if (route.durationSeconds > 4 * 3600) return Response.json({ error: "El recorrido supera las 4 horas admitidas" }, { status: 422 });
    const segments = sampleRoute(route);
    const weatherRequest = weatherRequestSchema.parse({
      points: segments.map((segment) => ({ id: segment.id, position: segment.midpoint.position })),
      period: { start: route.requestedDepartureAt,
        end: new Date(Date.parse(route.requestedDepartureAt) + route.durationSeconds * 1000).toISOString() },
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
    return Response.json({ routing: response, route, forecast, assessment: assessRoute(route, forecast, Date.now()), weatherError },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!(error instanceof RoutingFailure) && error instanceof Error && error.message.includes("demasiados puntos")) {
      return Response.json({ error: error.message }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }
    return routeError(error);
  }
}
