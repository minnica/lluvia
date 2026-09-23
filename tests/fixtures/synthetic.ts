import type { RoutingRequest, RoutingResponse } from "@/domain/routing/contracts";
import type { WeatherRequest, WeatherResponse, WeatherValue } from "@/domain/weather/contracts";

// Datos fabricados exclusivamente para las pruebas; nunca son pronósticos reales.
export const weatherRequest: WeatherRequest = {
  points: [{ id: "synthetic-home", position: { lat: 19.21, lon: -98.75 } }],
  period: { start: "2026-09-22T12:00:00Z", end: "2026-09-22T13:00:00Z" },
  variables: ["precipitationProbability", "precipitationAmount"],
};

export const hourlyProbability: WeatherValue = {
  variable: "precipitationProbability",
  value: 0.4,
  unit: "probability",
  validPeriod: weatherRequest.period,
  validAt: null,
  temporalMeaning: "period-probability",
  probabilityEvent: {
    thresholdMm: null,
    comparison: "unknown",
    description: "Lluvia durante la hora indicada; umbral no especificado",
  },
  product: "synthetic-hourly",
  model: null,
  issuedAt: null,
  retrievedAt: "2026-09-22T11:55:00Z",
  outputStepMinutes: 60,
  nativeStepMinutes: null,
  spatialResolutionM: null,
  origin: "unknown",
  flags: ["unknown-issue-time", "unknown-resolution"],
};

export const weatherResponse: WeatherResponse = {
  schemaVersion: 1,
  provider: "open-meteo",
  adapterVersion: "synthetic-1",
  requestId: "synthetic-request",
  points: [{
    pointId: "synthetic-home",
    requestedPoint: weatherRequest.points[0].position,
    resolvedPoint: null,
    status: "partial",
    values: [hourlyProbability],
    availablePeriods: [{ product: "synthetic-hourly", period: weatherRequest.period }],
    warnings: ["Acumulación sintética omitida"],
    error: null,
  }],
};

export const routingRequest: RoutingRequest = {
  origin: { lat: 19.21, lon: -98.75 },
  destination: { lat: 19.22, lon: -98.74 },
  via: [],
  departureAt: "2026-09-22T12:00:00Z",
  profile: "motorcycle",
  avoid: [],
};

export const routingResponse: RoutingResponse = {
  schemaVersion: 1,
  provider: "tomtom",
  adapterVersion: "synthetic-1",
  routes: [{
    id: "synthetic-route",
    geometry: { type: "LineString", coordinates: [[-98.75, 19.21], [-98.74, 19.22]] },
    progress: [
      { position: routingRequest.origin, distanceFromStartM: 0, durationFromStartSeconds: 0 },
      { position: routingRequest.destination, distanceFromStartM: 1500, durationFromStartSeconds: 300 },
    ],
    durationSeconds: 300,
    distanceM: 1500,
    requestedDepartureAt: routingRequest.departureAt,
    retrievedAt: "2026-09-22T11:55:00Z",
    requestedProfile: "motorcycle",
    effectiveProfile: "car",
    traffic: "unknown",
    warnings: ["El perfil de motocicleta se aproxima con automóvil"],
  }],
};

