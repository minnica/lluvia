import { z } from "zod";
import { weatherRequestSchema } from "@/domain/weather/contracts";
import { operationalWeatherProvider } from "@/server/providers/weather/factory";
import { WeatherProviderFailure } from "@/server/providers/weather/error";
import { recordOperation } from "@/server/operation";
import { checkRequestLimit, limitedResponse } from "@/server/request-limit";

export const runtime = "nodejs";

const querySchema = z.object({
  lat: z.coerce.number().finite().min(-90).max(90),
  lon: z.coerce.number().finite().min(-180).max(180),
  minutes: z.coerce.number().int().min(30).max(360).optional(),
  view: z.literal("hourly").optional(),
});

function hourlyWindow(now: number) {
  const hour = Math.floor(now / 3_600_000) * 3_600_000;
  return {
    start: new Date(hour - 2 * 3_600_000).toISOString(),
    end: new Date(hour + 11 * 3_600_000).toISOString(),
  };
}

export async function GET(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const retryAfter = checkRequestLimit(request, "weather", 20);
  if (retryAfter !== null) {
    recordOperation("weather", startedAt, "error", { code: "local-rate-limit" });
    return limitedResponse(retryAfter);
  }
  const url = new URL(request.url);
  const query = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!query.success || (!query.data.view && query.data.minutes === undefined)) {
    recordOperation("weather", startedAt, "error", { code: "invalid-input" });
    return Response.json({ error: "Coordenadas o periodo inválidos" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const now = Date.now();
  const weatherRequest = weatherRequestSchema.parse({
    points: [{ id: "selected-location", position: { lat: query.data.lat, lon: query.data.lon } }],
    period: query.data.view === "hourly" ? hourlyWindow(now) : {
      start: new Date(now).toISOString(), end: new Date(now + query.data.minutes! * 60_000).toISOString(),
    },
    variables: ["precipitationProbability", "precipitationAmount", "precipitationRate"],
  });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
  try {
    const provider = operationalWeatherProvider();
    const forecast = await provider.getForecast({ ...weatherRequest, signal });
    recordOperation("weather", startedAt, forecast.points[0]?.status === "ok" ? "ok" : "partial", { maxProviderCalls: 1, points: 1 });
    return Response.json({ forecast, period: weatherRequest.period }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const detail = error instanceof WeatherProviderFailure ? error.detail :
      { code: "unavailable", retryable: true, message: "No se pudo obtener el pronóstico" };
    const status = detail.code === "configuration" ? 503 : detail.code === "quota" ? 429 : detail.code === "timeout" ? 504 : 502;
    recordOperation("weather", startedAt, "error", { code: detail.code, maxProviderCalls: 1, points: 1 });
    return Response.json({ error: detail.message, code: detail.code }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
