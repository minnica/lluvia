import type { Route } from "@/domain/routing/contracts";
import { assessRoute, type RouteAssessment } from "@/domain/routing/exposure";
import type { WeatherResponse } from "@/domain/weather/contracts";

export const departureOffsets = [0, 10, 20, 30] as const;
export type DepartureOffset = typeof departureOffsets[number];
export type Alternative = {
  offsetMinutes: DepartureOffset;
  route: Route | null;
  routingError: string | null;
  assessment: RouteAssessment | null;
  sensitivity: Array<{ shiftMinutes: -10 | -5 | 5 | 10; rainSignalMinutes: number; unknownMinutes: number; complete: boolean }>;
  routeChanged: boolean;
  timingChanged: boolean;
  durationDeltaMinutes: number | null;
};
export type DepartureComparison = {
  state: "comparable" | "limited" | "insufficient-data";
  decisionAt: string;
  requiredHorizonMinutes: number;
  forecastAgeMinutes: number;
  bestOffsetMinutes: DepartureOffset | null;
  reason: string;
  alternatives: Alternative[];
};

export function compareDepartures(
  routes: Array<Route | null>, forecasts: WeatherResponse[], errors: Array<string | null>,
  decisionAt: string, now: number,
): DepartureComparison {
  const base = routes[0];
  const alternatives = departureOffsets.map((offsetMinutes, index): Alternative => {
    const route = routes[index];
    const forecast = forecasts[index];
    const assessment = route && forecast ? assessRoute(route, forecast, now) : null;
    const sensitivity = route && forecast ? ([-10, -5, 5, 10] as const).map((shiftMinutes) => {
      const result = assessRoute(route, forecast, now, shiftMinutes);
      return { shiftMinutes, rainSignalMinutes: result.rainSignalMinutes, unknownMinutes: result.unknownMinutes,
        complete: result.state !== "insufficient-data" };
    }) : [];
    return { offsetMinutes, route, routingError: errors[index], assessment, sensitivity,
      routeChanged: !!(base && route && (route.geometry.coordinates.some((point, pointIndex) =>
        point[0] !== base.geometry.coordinates[pointIndex]?.[0] || point[1] !== base.geometry.coordinates[pointIndex]?.[1]) ||
        route.geometry.coordinates.length !== base.geometry.coordinates.length)),
      timingChanged: !!(base && route && (route.durationSeconds !== base.durationSeconds ||
        route.progress.length !== base.progress.length || route.progress.some((point, pointIndex) =>
          point.durationFromStartSeconds !== base.progress[pointIndex]?.durationFromStartSeconds))),
      durationDeltaMinutes: base && route ? Math.round((route.durationSeconds - base.durationSeconds) / 60) : null };
  });
  const oldestRetrievedAt = Math.min(now, ...forecasts.flatMap((forecast) => forecast.points.flatMap((point) =>
    point.values.map((value) => Date.parse(value.retrievedAt)))));
  const forecastAgeMinutes = Math.max(0, Math.ceil((now - oldestRetrievedAt) / 60_000));
  const longestDuration = Math.max(...routes.filter((route): route is Route => route !== null).map((route) => route.durationSeconds));
  const latestEnd = Math.max(Date.parse(decisionAt) + 30 * 60_000 + longestDuration * 1000,
    ...routes.filter((route): route is Route => route !== null).map((route) =>
      Date.parse(route.requestedDepartureAt) + route.durationSeconds * 1000));
  const requiredHorizonMinutes = Math.ceil((latestEnd - Date.parse(decisionAt)) / 60_000) + 10 + forecastAgeMinutes;
  const complete = alternatives.every((item) => item.assessment !== null && item.assessment.state !== "insufficient-data" &&
    item.sensitivity.every((scenario) => scenario.complete));
  const values = forecasts.flatMap((forecast) => forecast.points.flatMap((point) => point.values));
  const products = new Set(values.map((value) => `${value.product}:${value.model ?? "unknown"}:${value.origin}`));
  const sufficientlyFine = values.length > 0 && values.every((value) => value.nativeStepMinutes !== null &&
    value.nativeStepMinutes <= 15 && value.outputStepMinutes !== null && value.outputStepMinutes <= 15 &&
    value.origin !== "interpolated" && !value.flags.includes("interpolated"));
  const consistentProfile = routes.every((route) => route?.effectiveProfile === base?.effectiveProfile);
  const state = !complete ? "insufficient-data" : !sufficientlyFine || products.size !== 1 || !consistentProfile ? "limited" : "comparable";
  let bestOffsetMinutes: DepartureOffset | null = null;
  if (state === "comparable") {
    const ranges = alternatives.map((item) => {
      const minutes = [item.assessment!.rainSignalMinutes, ...item.sensitivity.map((scenario) => scenario.rainSignalMinutes)];
      return { offset: item.offsetMinutes, low: Math.min(...minutes), high: Math.max(...minutes) };
    });
    const winner = ranges.find((candidate) => ranges.every((other) => other === candidate || candidate.high < other.low));
    bestOffsetMinutes = winner?.offset ?? null;
  }
  const reason = state === "insufficient-data"
    ? `Falta ruta o cobertura meteorológica continua y vigente para alguna salida o para el margen de ±10 min. Se necesitan al menos ${requiredHorizonMinutes} min desde la decisión, incluida la antigüedad conocida del pronóstico.`
    : state === "limited"
      ? "Las horas meteorológicas o las fuentes distintas no permiten afirmar que esperar mejore el trayecto. Las cifras muestran señal por hora, no lluvia minuto a minuto."
      : bestOffsetMinutes === null
        ? "Las diferencias no resisten escenarios de paso ±5 y ±10 min; no hay una salida claramente mejor."
        : `${bestOffsetMinutes === 0 ? "Salir ahora" : `Esperar ${bestOffsetMinutes} min`} tiene menos señal en todos los escenarios de paso evaluados; considera también el coste de esperar y las condiciones viales.`;
  return { state, decisionAt, requiredHorizonMinutes, forecastAgeMinutes, bestOffsetMinutes, reason, alternatives };
}
