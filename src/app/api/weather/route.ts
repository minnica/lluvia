import { z } from "zod";
import { weatherRequestSchema } from "@/domain/weather/contracts";
import { createWeatherProvider } from "@/server/providers/weather/factory";
import { OpenMeteoProvider, WeatherProviderFailure } from "@/server/providers/weather/open-meteo";

export const runtime = "nodejs";

const querySchema = z.object({
  lat: z.coerce.number().finite().min(-90).max(90),
  lon: z.coerce.number().finite().min(-180).max(180),
  minutes: z.coerce.number().int().min(30).max(360),
});

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!query.success) return Response.json({ error: "Coordenadas o periodo inválidos" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const now = Date.now();
  const weatherRequest = weatherRequestSchema.parse({
    points: [{ id: "selected-location", position: { lat: query.data.lat, lon: query.data.lon } }],
    period: { start: new Date(now).toISOString(), end: new Date(now + query.data.minutes * 60_000).toISOString() },
    variables: ["precipitationProbability", "precipitationAmount", "precipitationRate"],
  });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
  try {
    const provider = createWeatherProvider({ "open-meteo": () => new OpenMeteoProvider() });
    const forecast = await provider.getForecast({ ...weatherRequest, signal });
    return Response.json({ forecast, period: weatherRequest.period }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const detail = error instanceof WeatherProviderFailure ? error.detail :
      { code: "unavailable", retryable: true, message: "No se pudo obtener el pronóstico" };
    const status = detail.code === "configuration" ? 503 : detail.code === "quota" ? 429 : detail.code === "timeout" ? 504 : 502;
    return Response.json({ error: detail.message, code: detail.code }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
