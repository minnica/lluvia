import { describe, expect, it, vi } from "vitest";
import { assessLocalForecast } from "@/domain/weather/local";
import type { WeatherRequest } from "@/domain/weather/contracts";
import { validateWeatherResponse } from "@/domain/weather/contracts";

vi.mock("server-only", () => ({}));
import { normalizeOpenMeteo, OpenMeteoProvider } from "@/server/providers/weather/open-meteo";
import { GET } from "@/app/api/weather/route";

const request: WeatherRequest = {
  points: [{ id: "home", position: { lat: 19.213346, lon: -98.75547 } }],
  period: { start: "2026-09-22T12:30:00Z", end: "2026-09-22T14:30:00Z" },
  variables: ["precipitationProbability", "precipitationAmount", "precipitationRate"],
};
const retrievedAt = "2026-09-22T12:00:00Z";
const apiResponse = {
  latitude: 19.21, longitude: -98.76, elevation: 2600, utc_offset_seconds: 0,
  hourly_units: { precipitation_probability: "%", precipitation: "mm" },
  hourly: { time: ["2026-09-22T13:00", "2026-09-22T14:00", "2026-09-22T15:00"],
    precipitation_probability: [40, 70, 20], precipitation: [0, 2, 0] },
};

describe("consulta local horaria", () => {
  it("sitúa cada dato en la hora precedente y conserva probabilidad, acumulación y tasa media", () => {
    const point = normalizeOpenMeteo(apiResponse, request, "home", retrievedAt);
    validateWeatherResponse({ schemaVersion: 1, provider: "open-meteo", adapterVersion: "1", requestId: "test", points: [point] }, request);
    expect(point.status).toBe("ok");
    expect(point.resolvedPoint).toEqual({ lat: 19.21, lon: -98.76, elevationM: 2600 });
    expect(point.values[0].validPeriod).toEqual({ start: "2026-09-22T12:00:00.000Z", end: "2026-09-22T13:00:00.000Z" });
    expect(point.values[0].value).toBe(0.4);
    expect(point.values[0].probabilityEvent?.thresholdMm).toBe(0.1);
    expect(point.values[3].value).toBe(0.7);
    expect(point.values[4].value).toBe(2);
    expect(point.values[5].value).toBe(2);
    expect(assessLocalForecast(point, request.period, Date.parse(retrievedAt)).state).toBe("rain-signal");
  });

  it("marca dato nulo, cobertura parcial y pronóstico vencido como insuficientes", () => {
    const partial = normalizeOpenMeteo({ ...apiResponse, hourly: { ...apiResponse.hourly, precipitation_probability: [40, null, 20] } }, request, "home", retrievedAt);
    expect(partial.status).toBe("partial");
    expect(assessLocalForecast(partial, request.period, Date.parse(retrievedAt)).state).toBe("insufficient-data");
    const noProbability = normalizeOpenMeteo({ ...apiResponse, hourly: { time: apiResponse.hourly.time, precipitation: apiResponse.hourly.precipitation } }, request, "home", retrievedAt);
    expect(noProbability.status).toBe("partial");
    expect(noProbability.values.find((value) => value.variable === "precipitationProbability")?.value).toBeNull();
    const full = normalizeOpenMeteo(apiResponse, request, "home", retrievedAt);
    expect(assessLocalForecast(full, request.period, Date.parse(retrievedAt) + 21 * 60_000).state).toBe("insufficient-data");
    const short = { ...request, period: { start: request.period.start, end: "2026-09-22T16:30:00Z" } };
    expect(assessLocalForecast(normalizeOpenMeteo(apiResponse, short, "home", retrievedAt), short.period, Date.parse(retrievedAt)).state).toBe("insufficient-data");
  });

  it("rechaza unidades, series y horas incorrectas", () => {
    expect(() => normalizeOpenMeteo({ ...apiResponse, hourly_units: { ...apiResponse.hourly_units, precipitation: "inch" } }, request, "home", retrievedAt)).toThrow();
    expect(() => normalizeOpenMeteo({ ...apiResponse, hourly: { ...apiResponse.hourly, precipitation: [0] } }, request, "home", retrievedAt)).toThrow();
    expect(() => normalizeOpenMeteo({ ...apiResponse, hourly: { ...apiResponse.hourly, time: ["2026-09-22T13:00", "2026-09-22T13:00", "2026-09-22T15:00"] } }, request, "home", retrievedAt)).toThrow();
  });

  it("ignora la lluvia de horas anteriores al orientar una salida", () => {
    const pastRain = normalizeOpenMeteo({ ...apiResponse, hourly: {
      ...apiResponse.hourly, precipitation_probability: [80, 10, 10], precipitation: [2, 0, 0],
    } }, request, "home", retrievedAt);
    const future = { start: "2026-09-22T13:00:00Z", end: "2026-09-22T15:00:00Z" };
    expect(assessLocalForecast(pastRain, future, Date.parse(retrievedAt)).state).toBe("no-rain-signal");
  });

  it("consulta el endpoint de servidor y aísla el fallo de un punto en un lote", async () => {
    const calls: string[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      calls.push(String(input));
      return calls.length === 1 ? Response.json(apiResponse) : new Response(null, { status: 429 });
    });
    try {
      const batch = { ...request, points: [...request.points, { id: "second", position: { lat: 19.22, lon: -98.75 } }] };
      const response = await new OpenMeteoProvider().getForecast(batch);
      expect(response.points.map((point) => point.status)).toEqual(["ok", "unavailable"]);
      expect(response.points[1].error?.code).toBe("quota");
      expect(calls[0]).toContain("timezone=UTC");
      expect(calls[0]).toContain("precipitation_probability%2Cprecipitation");
      expect(calls[0]).not.toContain("apikey");
    } finally { fetchMock.mockRestore(); }
  });

  it("devuelve solo el contrato normalizado y rechaza entradas inválidas", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T12:30:00Z"));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(apiResponse));
    try {
      const invalid = await GET(new Request("https://localhost/api/weather?lat=91&lon=0&minutes=60"));
      expect(invalid.status).toBe(400);
      const valid = await GET(new Request("https://localhost/api/weather?lat=19.213346&lon=-98.75547&minutes=60"));
      expect(valid.status).toBe(200);
      expect(valid.headers.get("Cache-Control")).toBe("no-store");
      const body = await valid.json();
      expect(body.forecast.provider).toBe("open-meteo");
      expect(body.forecast.points[0].values[0].validPeriod.start).toBe("2026-09-22T12:00:00.000Z");
      expect(body.forecast.points[0].hourly).toBeUndefined();
      const hourly = await GET(new Request("https://localhost/api/weather?lat=19.213346&lon=-98.75547&view=hourly"));
      expect(hourly.status).toBe(200);
      const hourlyBody = await hourly.json();
      expect(hourlyBody.period).toEqual({ start: "2026-09-22T10:00:00.000Z", end: "2026-09-22T23:00:00.000Z" });
    } finally { fetchMock.mockRestore(); vi.useRealTimers(); }
  });
});
