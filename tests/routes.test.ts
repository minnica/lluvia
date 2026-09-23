import { describe, expect, it, vi } from "vitest";
import { assessRoute } from "@/domain/routing/exposure";
import { compareDepartures } from "@/domain/routing/comparison";
import { sampleRoute } from "@/domain/routing/sampling";
import { mergeImportedRoutes, routeExportSchema, type SavedRoute } from "@/domain/routing/favorites";
import type { RoutingRequest } from "@/domain/routing/contracts";
import type { WeatherResponse, WeatherValue } from "@/domain/weather/contracts";

vi.mock("server-only", () => ({}));
import { normalizeTomTom } from "@/server/providers/routing/tomtom";
import { POST as routesPost } from "@/app/api/routes/route";
import { POST as routeWeatherPost } from "@/app/api/route-weather/route";

const request: RoutingRequest = {
  origin: { lat: 19.2, lon: -98.7 }, via: [{ lat: 19.21, lon: -98.69 }], destination: { lat: 19.22, lon: -98.68 },
  departureAt: "2026-09-22T12:00:00Z", profile: "motorcycle", avoid: [],
};
const raw = { routes: [{ summary: { lengthInMeters: 4800, travelTimeInSeconds: 2400 },
  legs: [
    { points: [{ latitude: 19.2, longitude: -98.7 }, { latitude: 19.205, longitude: -98.695 }, { latitude: 19.21, longitude: -98.69 }] },
    { points: [{ latitude: 19.21, longitude: -98.69 }, { latitude: 19.215, longitude: -98.685 }, { latitude: 19.22, longitude: -98.68 }] },
  ],
  progress: [{ pointIndex: 0, distanceInMeters: 0, travelTimeInSeconds: 0 },
    { pointIndex: 2, distanceInMeters: 2400, travelTimeInSeconds: 1200 },
    { pointIndex: 4, distanceInMeters: 4800, travelTimeInSeconds: 2400 }],
  sections: [{ sectionType: "TRAVEL_MODE", travelMode: "motorcycle" }],
}] };
const route = normalizeTomTom(raw, request, "2026-09-22T12:00:00Z").routes[0];
const period = { start: "2026-09-22T12:00:00Z", end: "2026-09-22T13:00:00Z" };
function value(variable: WeatherValue["variable"], amount: number | null): WeatherValue {
  return { variable, value: amount, unit: variable === "precipitationProbability" ? "probability" : "mm",
    validPeriod: period, validAt: null, temporalMeaning: variable === "precipitationProbability" ? "period-probability" : "period-total",
    probabilityEvent: variable === "precipitationProbability" ? { thresholdMm: 0.1, comparison: "gt", description: "Más de 0.1 mm" } : null,
    product: "synthetic-hourly", model: null, issuedAt: null, retrievedAt: "2026-09-22T12:00:00Z",
    outputStepMinutes: 60, nativeStepMinutes: null, spatialResolutionM: null, origin: "model", flags: ["unknown-issue-time"] };
}

describe("recorridos A2 con datos sintéticos", () => {
  it("respeta paradas, tiempos acumulados y perfil efectivo de TomTom", () => {
    expect(route.progress).toHaveLength(5);
    expect(route.progress[2].position).toEqual(request.via[0]);
    expect(route.progress[1].durationFromStartSeconds).toBeCloseTo(600);
    expect(route.effectiveProfile).toBe("motorcycle");
    expect(route.warnings).toContain("Tiempos entre puntos de progreso interpolados según distancia sobre la geometría.");
    expect(() => normalizeTomTom({ routes: [{ ...raw.routes[0], legs: raw.routes[0].legs.slice(0, 1) }] }, request, route.retrievedAt)).toThrow();
    expect(() => normalizeTomTom({ routes: [{ ...raw.routes[0], progress: raw.routes[0].progress.slice(0, 2) }] }, request, route.retrievedAt)).toThrow();
  });

  it("evalúa la hora de paso por tramo sin sumar probabilidades horarias", () => {
    const segments = sampleRoute(route);
    expect(segments).toHaveLength(10);
    expect(segments[0].start.seconds).toBe(0);
    expect(segments.at(-1)?.end.seconds).toBe(2400);
    const forecast: WeatherResponse = { schemaVersion: 1, provider: "open-meteo", adapterVersion: "synthetic", requestId: "test",
      points: segments.map((segment, index) => ({ pointId: segment.id, requestedPoint: segment.midpoint.position,
        resolvedPoint: segment.midpoint.position, status: "ok", values: [value("precipitationProbability", index === 7 ? 0.7 : 0.1),
          value("precipitationAmount", index === 7 ? 1 : 0)], availablePeriods: [{ product: "synthetic-hourly", period }], warnings: [], error: null })) };
    const assessment = assessRoute(route, forecast, Date.parse("2026-09-22T12:01:00Z"));
    expect(assessment.rainSignalMinutes).toBe(4);
    expect(assessment.unknownMinutes).toBe(0);
    expect(assessment.segments[7].probability).toBe(0.7);
    forecast.points[2].values = [value("precipitationProbability", 0.1)];
    const partial = assessRoute(route, forecast, Date.parse("2026-09-22T12:01:00Z"));
    expect(partial.state).toBe("insufficient-data");
    expect(partial.unknownMinutes).toBe(4);
  });

  it("valida la exportación y gestiona duplicados e IDs repetidos", () => {
    const saved: SavedRoute = { schemaVersion: 1, id: "22222222-2222-4222-8222-222222222222", name: "Trabajo",
      origin: request.origin, destination: request.destination, via: request.via, profile: "motorcycle", avoid: [],
      createdAt: request.departureAt, updatedAt: request.departureAt };
    expect(routeExportSchema.safeParse({ format: "lluvia-routes", version: 1, exportedAt: request.departureAt, routes: [saved] }).success).toBe(true);
    expect(routeExportSchema.safeParse({ format: "lluvia-routes", version: 2, exportedAt: request.departureAt, routes: [saved] }).success).toBe(false);
    const merged = mergeImportedRoutes([saved], [saved, { ...saved, name: "Otro" }], () => "33333333-3333-4333-8333-333333333333");
    expect(merged.skipped).toBe(1);
    expect(merged.renamed).toBe(1);
    expect(merged.merged).toHaveLength(2);
  });

  it("rechaza entrada inválida sin necesitar la clave de routing", async () => {
    const response = await routesPost(new Request("https://localhost/api/routes", { method: "POST", body: JSON.stringify({ origin: request.origin }) }));
    expect(response.status).toBe(400);
  });

  it("coordina ruta y pronósticos reales del contrato por hora de paso", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(request.departureAt));
    const previousKey = process.env.TOMTOM_API_KEY;
    process.env.TOMTOM_API_KEY = "synthetic-test-key";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "api.tomtom.com") {
        expect(url.searchParams.get("travelMode")).toBe("motorcycle");
        expect(url.pathname).toContain("19.21,-98.69");
        return Response.json(raw);
      }
      expect(url.searchParams.get("timezone")).toBe("UTC");
      return Response.json({ latitude: 19.21, longitude: -98.69, utc_offset_seconds: 0,
        hourly_units: { precipitation_probability: "%", precipitation: "mm" },
        hourly: { time: ["2026-09-22T13:00"], precipitation_probability: [20], precipitation: [0] } });
    });
    try {
      const response = await routeWeatherPost(new Request("https://localhost/api/route-weather", { method: "POST",
        body: JSON.stringify({ origin: request.origin, destination: request.destination, via: request.via,
          profile: request.profile, avoid: [] }) }));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.route.progress[2].position).toEqual(request.via[0]);
      expect(body.assessment.segments).toHaveLength(10);
      expect(body.assessment.unknownMinutes).toBe(0);
      expect(body.assessment.segments[9].segment.midpoint.seconds).toBe(2280);
      expect(body.comparison.alternatives.map((item: { offsetMinutes: number }) => item.offsetMinutes)).toEqual([0, 10, 20, 30]);
      expect(body.comparison.requiredHorizonMinutes).toBe(80);
      expect(body.comparison.state).toBe("insufficient-data");
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("api.tomtom.com"))).toHaveLength(4);
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("api.open-meteo.com"))).toHaveLength(10);
      expect(body.forecast.points).toHaveLength(10); // Cuatro rutas idénticas comparten los mismos puntos.
    } finally {
      fetchMock.mockRestore();
      if (previousKey === undefined) delete process.env.TOMTOM_API_KEY;
      else process.env.TOMTOM_API_KEY = previousKey;
      vi.useRealTimers();
    }
  });
});

describe("comparación A3 con datos sintéticos", () => {
  const departures = [0, 10, 20, 30].map((offset) => ({ ...route,
    requestedDepartureAt: new Date(Date.parse(request.departureAt) + offset * 60_000).toISOString() }));
  const periods = [11, 12, 13].map((hour) => ({ start: `2026-09-22T${hour}:00:00Z`,
    end: `2026-09-22T${hour + 1}:00:00Z` }));
  function forecastFor(index: number, amounts: Array<number | null>, availableHours = 3): WeatherResponse {
    return { schemaVersion: 1, provider: "open-meteo", adapterVersion: "synthetic", requestId: `a${index}`,
      points: sampleRoute(departures[index]).map((segment) => ({ pointId: segment.id,
        requestedPoint: segment.midpoint.position, resolvedPoint: segment.midpoint.position, status: "ok",
        values: periods.slice(0, availableHours).flatMap((hour, hourIndex) => [
          { ...value("precipitationProbability", amounts[hourIndex] === null ? null : amounts[hourIndex]! > 0 ? 0.7 : 0.1), validPeriod: hour },
          { ...value("precipitationAmount", amounts[hourIndex]), validPeriod: hour },
        ]), availablePeriods: periods.slice(0, availableHours).map((hour) => ({ product: "synthetic-hourly", period: hour })),
        warnings: [], error: null })) };
  }
  const compare = (amounts: Array<number | null>, availableHours = 3) => compareDepartures(
    departures, departures.map((_, index) => forecastFor(index, amounts, availableHours)),
    [null, null, null, null], request.departureAt, Date.parse(request.departureAt),
  );

  it("exige 80 minutos para 40 de viaje, 30 de espera y 10 de margen", () => {
    const result = compare([0, 0, 0], 2);
    expect(result.requiredHorizonMinutes).toBe(80);
    expect(result.state).toBe("insufficient-data");
    expect(result.bestOffsetMinutes).toBeNull();
    expect(result.alternatives[3].assessment?.state).toBe("insufficient-data");
  });

  it("conserva lluvia al inicio, al final y ausencia sin elegir por horas", () => {
    const early = compare([0, 1, 0]);
    const late = compare([0, 0, 1]);
    const dry = compare([0, 0, 0]);
    expect(early.alternatives[0].assessment?.rainSignalMinutes).toBe(40);
    expect(late.alternatives[3].assessment?.rainSignalMinutes).toBe(12); // Tres tramos de 4 min cruzan la hora lluviosa.
    for (const result of [early, late, dry]) {
      expect(result.state).toBe("limited");
      expect(result.bestOffsetMinutes).toBeNull();
      expect(result.alternatives.every((item) => item.sensitivity.length === 4)).toBe(true);
    }
    expect(dry.alternatives.every((item) => item.assessment?.rainSignalMinutes === 0)).toBe(true);
  });

  it("marca valores ausentes y alternativas sin ruta", () => {
    const missing = compare([0, null, 0]);
    expect(missing.state).toBe("insufficient-data");
    const noRoute = compareDepartures([departures[0], null, departures[2], departures[3]],
      departures.map((_, index) => forecastFor(index, [0, 0, 0])), [null, "Ruta no disponible", null, null],
      request.departureAt, Date.parse(request.departureAt));
    expect(noRoute.state).toBe("insufficient-data");
    expect(noRoute.alternatives[1].routingError).toBe("Ruta no disponible");
  });

  it("expone cambios de geometría y tiempos entre salidas", () => {
    const changed = { ...departures[1],
      geometry: { ...departures[1].geometry, coordinates: departures[1].geometry.coordinates.map((point, index) =>
        index === 1 ? [point[0] + 0.001, point[1]] as [number, number] : point) },
      progress: departures[1].progress.map((point, index) => index === 1 ? {
        ...point, position: { ...point.position, lon: point.position.lon + 0.001 },
        durationFromStartSeconds: point.durationFromStartSeconds + 30 } : point),
    };
    const result = compareDepartures([departures[0], changed, departures[2], departures[3]],
      departures.map((_, index) => forecastFor(index, [0, 0, 0])), [null, null, null, null],
      request.departureAt, Date.parse(request.departureAt));
    expect(result.alternatives[1].routeChanged).toBe(true);
    expect(result.alternatives[1].timingChanged).toBe(true);
  });
});
