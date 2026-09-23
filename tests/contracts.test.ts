import { describe, expect, it } from "vitest";
import { periodSchema, pointSchema } from "@/domain/provider-common";
import { routeSchema, validateRoutingResponse } from "@/domain/routing/contracts";
import { amountToMeanRate, percentageToProbability } from "@/domain/weather/units";
import {
  providerErrorSchema, validateWeatherResponse, weatherRequestSchema, weatherValueSchema,
} from "@/domain/weather/contracts";
import { hourlyProbability, routingRequest, routingResponse, weatherRequest, weatherResponse } from "./fixtures/synthetic";

describe("contratos compartidos con datos sintéticos", () => {
  it("conserva una probabilidad horaria sin convertirla en dato por minuto", () => {
    expect(validateWeatherResponse(weatherResponse, weatherRequest).points[0].values[0]).toEqual(hourlyProbability);
    expect(weatherValueSchema.safeParse({ ...hourlyProbability, validPeriod: null, validAt: "2026-09-22T12:30:00Z" }).success).toBe(false);
    expect(weatherValueSchema.safeParse({ ...hourlyProbability, value: 1.2 }).success).toBe(false);
  });

  it("diferencia dato ausente, cero y fallo de un punto del lote", () => {
    expect(weatherValueSchema.parse({ ...hourlyProbability, value: null }).value).toBeNull();
    expect(weatherValueSchema.parse({ ...hourlyProbability, value: 0 }).value).toBe(0);
    const failedPoint = {
      pointId: "synthetic-second",
      requestedPoint: { lat: 19.22, lon: -98.74 },
      resolvedPoint: null,
      status: "unavailable",
      values: [],
      availablePeriods: [],
      warnings: [],
      error: { code: "quota", retryable: true, retryAfterSeconds: 60, message: "Cuota agotada" },
    };
    const request = { ...weatherRequest, points: [...weatherRequest.points, { id: failedPoint.pointId, position: failedPoint.requestedPoint }] };
    expect(validateWeatherResponse({ ...weatherResponse, points: [...weatherResponse.points, failedPoint] }, request).points[0].status).toBe("partial");
    expect(providerErrorSchema.safeParse({ ...failedPoint.error, retryAfterSeconds: -1 }).success).toBe(false);
  });

  it("rechaza coordenadas, periodos e IDs inválidos", () => {
    expect(pointSchema.safeParse({ lat: 91, lon: 0 }).success).toBe(false);
    expect(periodSchema.safeParse({ start: "2026-09-22T13:00:00Z", end: "2026-09-22T12:00:00Z" }).success).toBe(false);
    expect(periodSchema.safeParse({ start: "2026-09-22T12:00:00-06:00", end: "2026-09-22T19:00:00Z" }).success).toBe(false);
    expect(periodSchema.safeParse({ start: "2026-02-30T12:00:00Z", end: "2026-03-01T12:00:00Z" }).success).toBe(false);
    expect(weatherRequestSchema.safeParse({ ...weatherRequest, points: [weatherRequest.points[0], weatherRequest.points[0]] }).success).toBe(false);
    expect(() => validateWeatherResponse({ ...weatherResponse, points: [] }, weatherRequest)).toThrow();
  });

  it("convierte unidades solo con un periodo y un rango explícitos", () => {
    expect(percentageToProbability(40)).toBe(0.4);
    expect(amountToMeanRate(2, 30)).toBe(4);
    expect(() => percentageToProbability(101)).toThrow();
    expect(() => amountToMeanRate(2, 0)).toThrow();
    expect(weatherValueSchema.safeParse({ ...hourlyProbability, unit: "mm" }).success).toBe(false);
    expect(weatherValueSchema.safeParse({ ...hourlyProbability, variable: "precipitationRate", unit: "mm/h", probabilityEvent: null, temporalMeaning: "period-total" }).success).toBe(false);
  });

  it("valida tiempos acumulados, geometría y perfil efectivo", () => {
    expect(validateRoutingResponse(routingResponse, routingRequest).routes[0].effectiveProfile).toBe("car");
    const route = routingResponse.routes[0];
    expect(routeSchema.safeParse({ ...route, progress: [route.progress[0], { ...route.progress[1], durationFromStartSeconds: -1 }] }).success).toBe(false);
    expect(routeSchema.safeParse({ ...route, geometry: { type: "LineString", coordinates: [[19.21, -98.75], [19.22, -98.74]] } }).success).toBe(false);
    expect(routeSchema.safeParse({ ...route, warnings: [] }).success).toBe(false);
  });
});
