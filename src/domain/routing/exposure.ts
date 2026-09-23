import type { Route } from "@/domain/routing/contracts";
import type { PointForecast, WeatherResponse, WeatherValue } from "@/domain/weather/contracts";
import { sampleRoute, type RouteSegment } from "@/domain/routing/sampling";

export type SegmentAssessment = {
  segment: RouteSegment;
  state: "rain-signal" | "no-rain-signal" | "unknown";
  probability: number | null;
  amountMm: number | null;
  validPeriods: Array<{ start: string; end: string }>;
  resolvedPoint: PointForecast["resolvedPoint"];
  warning: string | null;
};
export type RouteAssessment = {
  state: "limited" | "insufficient-data";
  rainSignalMinutes: number;
  unknownMinutes: number;
  segments: SegmentAssessment[];
  warnings: string[];
};

function overlapping(values: WeatherValue[], variable: WeatherValue["variable"], start: number, end: number) {
  return values.filter((value) => value.variable === variable && value.validPeriod &&
    Date.parse(value.validPeriod.start) < end && Date.parse(value.validPeriod.end) > start);
}

function covers(values: WeatherValue[], start: number, end: number) {
  let cursor = start;
  for (const value of [...values].sort((a, b) => Date.parse(a.validPeriod!.start) - Date.parse(b.validPeriod!.start))) {
    if (value.value === null || Date.parse(value.validPeriod!.start) > cursor) return false;
    cursor = Math.max(cursor, Date.parse(value.validPeriod!.end));
    if (cursor >= end) return true;
  }
  return false;
}

export function assessRoute(route: Route, forecast: WeatherResponse, now: number): RouteAssessment {
  const segments = sampleRoute(route).map((segment): SegmentAssessment => {
    const point = forecast.points.find((entry) => entry.pointId === segment.id);
    const start = Date.parse(route.requestedDepartureAt) + segment.start.seconds * 1000;
    const end = Date.parse(route.requestedDepartureAt) + segment.end.seconds * 1000;
    const probabilities = overlapping(point?.values ?? [], "precipitationProbability", start, end);
    const amounts = overlapping(point?.values ?? [], "precipitationAmount", start, end);
    const fresh = point && point.values.every((value) => Date.parse(value.retrievedAt) + 20 * 60_000 >= now);
    const known = point && point.status !== "unavailable" && fresh &&
      covers(probabilities, start, end) && covers(amounts, start, end);
    const validPeriods = [...new Map([...probabilities, ...amounts].filter((value) => value.validPeriod)
      .map((value) => [value.validPeriod!.start, value.validPeriod!])).values()]
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    return {
      segment,
      state: !known ? "unknown" : amounts.some((value) => (value.value ?? 0) > 0) ||
        probabilities.some((value) => (value.value ?? 0) >= 0.5) ? "rain-signal" : "no-rain-signal",
      probability: probabilities.some((value) => value.value !== null) ? Math.max(...probabilities.flatMap((value) => value.value === null ? [] : [value.value])) : null,
      amountMm: amounts.some((value) => value.value !== null) ? Math.max(...amounts.flatMap((value) => value.value === null ? [] : [value.value])) : null,
      validPeriods,
      resolvedPoint: point?.resolvedPoint ?? null,
      warning: !known ? point?.error?.message ?? "Sin cobertura continua y vigente para este tramo" : null,
    };
  });
  const seconds = (state: SegmentAssessment["state"]) => segments.filter((item) => item.state === state)
    .reduce((total, item) => total + item.segment.end.seconds - item.segment.start.seconds, 0);
  return {
    state: segments.some((item) => item.state === "unknown") ? "insufficient-data" : "limited",
    rainSignalMinutes: Math.round(seconds("rain-signal") / 60),
    unknownMinutes: Math.round(seconds("unknown") / 60),
    segments,
    warnings: ["La señal horaria no indica los minutos reales bajo lluvia ni la seguridad del camino.",
      "El muestreo del trayecto no aumenta la resolución meteorológica original.",
      "No se dispone de elevación fiable por tramo para ajustar el muestreo al relieve."],
  };
}
