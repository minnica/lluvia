import { afterEach, describe, expect, it, vi } from "vitest";
import { weatherRequestSchema, validateWeatherResponse } from "@/domain/weather/contracts";
vi.mock("server-only", () => ({}));
import { WeatherbitProvider, normalizeWeatherbit } from "@/server/providers/weather/weatherbit";
import { operationalWeatherProvider } from "@/server/providers/weather/factory";
import { GET } from "@/app/api/weather/route";

const request = weatherRequestSchema.parse({
  points: [{ id: "san-rafael", position: { lat: 19.213346, lon: -98.75547 } }],
  period: { start: "2026-09-22T12:15:00.000Z", end: "2026-09-22T13:45:00.000Z" },
  variables: ["precipitationProbability", "precipitationAmount", "precipitationRate"],
});
const hourly = { lat: 19.21, lon: -98.75, data: [
  { timestamp_utc: "2026-09-22T13:00:00", pop: 40, precip: 1.5 },
  { timestamp_utc: "2026-09-22T14:00:00", pop: 0, precip: 0 },
] };
const retrievedAt = "2026-09-22T12:00:00.000Z";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Weatherbit Hourly sintético", () => {
  it("normaliza periodos precedentes, unidades, evento desconocido y ceros", () => {
    const point = normalizeWeatherbit(hourly, request, "san-rafael", retrievedAt);
    expect(point.status).toBe("ok");
    expect(point.values[0]).toMatchObject({ value: 0.4, validPeriod: {
      start: "2026-09-22T12:00:00.000Z", end: "2026-09-22T13:00:00.000Z" },
      probabilityEvent: { thresholdMm: null, comparison: "unknown" }, nativeStepMinutes: null });
    expect(point.values[1]).toMatchObject({ value: 1.5, unit: "mm" });
    expect(point.values[2]).toMatchObject({ value: 1.5, unit: "mm/h" });
    expect(point.values[4]).toMatchObject({ value: 0, unit: "mm" });
    expect(validateWeatherResponse({ schemaVersion: 1, provider: "weatherbit", adapterVersion: "1", requestId: "test", points: [point] }, request).points[0]).toEqual(point);
  });

  it("distingue valores ausentes y rechaza horas duplicadas", () => {
    const partial = normalizeWeatherbit({ ...hourly, data: [hourly.data[0], { timestamp_utc: "2026-09-22T14:00:00" }] }, request, "san-rafael", retrievedAt);
    expect(partial.status).toBe("partial");
    expect(partial.values[3].value).toBeNull();
    expect(() => normalizeWeatherbit({ ...hourly, data: [hourly.data[0], hourly.data[0]] }, request, "san-rafael", retrievedAt)).toThrow();
    const gap = normalizeWeatherbit({ ...hourly, data: [hourly.data[0], { timestamp_utc: "2026-09-22T15:00:00", pop: 0, precip: 0 }] }, request, "san-rafael", retrievedAt);
    expect(gap.status).toBe("partial");
    expect(gap.availablePeriods).toHaveLength(2);
  });

  it("selecciona el adaptador sin afectar al predeterminado y exige clave", async () => {
    vi.stubEnv("WEATHER_PROVIDER", "weatherbit");
    vi.stubEnv("WEATHERBIT_API_KEY", "");
    expect(operationalWeatherProvider().id).toBe("weatherbit");
    await expect(operationalWeatherProvider().getForecast(request)).rejects.toMatchObject({ detail: { code: "configuration" } });
    vi.stubEnv("WEATHER_PROVIDER", "open-meteo");
    expect(operationalWeatherProvider().id).toBe("open-meteo");
  });

  it("traduce cuota y conserva fallos de un punto sin perder el resto del lote", async () => {
    vi.stubEnv("WEATHERBIT_API_KEY", "synthetic-key");
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(hourly), { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const batch = { ...request, points: [...request.points, { id: "other", position: { lat: 19.22, lon: -98.74 } }] };
    const response = await new WeatherbitProvider().getForecast(batch);
    expect(response.points.map((point) => point.status)).toEqual(["ok", "unavailable"]);
    expect(response.points[1].error?.code).toBe("quota");
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.host).toBe("api.weatherbit.io");
    expect(url.searchParams.get("units")).toBe("M");
    expect(fetchMock.mock.calls[0][1].next.revalidate).toBe(300);
    expect(response.points[0].values[0].retrievedAt).not.toBe("");
  });

  it("sirve Weatherbit por /api/weather al seleccionarlo en el servidor", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T12:15:00Z"));
    vi.stubEnv("WEATHER_PROVIDER", "weatherbit");
    vi.stubEnv("WEATHERBIT_API_KEY", "synthetic-key");
    const fetchMock = vi.fn().mockResolvedValue(Response.json(hourly));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const response = await GET(new Request("https://localhost/api/weather?lat=19.213346&lon=-98.75547&minutes=90"));
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const body = await response.json();
      expect(body.forecast.provider).toBe("weatherbit");
      expect(body.forecast.points[0].values[0].probabilityEvent.thresholdMm).toBeNull();
      expect(JSON.stringify(body)).not.toContain("synthetic-key");
    } finally { vi.useRealTimers(); }
  });
});
