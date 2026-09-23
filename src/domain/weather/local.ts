import type { Period } from "@/domain/provider-common";
import type { PointForecast, WeatherValue } from "@/domain/weather/contracts";

export type LocalAssessment = {
  state: "rain-signal" | "no-rain-signal" | "insufficient-data";
  message: string;
  reason: string;
  rows: Array<{ period: Period; probability: number | null; amountMm: number | null; meanRateMmH: number | null }>;
  covered: boolean;
};

function covers(period: Period, values: WeatherValue[], variable: WeatherValue["variable"]): boolean {
  const targetStart = Date.parse(period.start);
  const targetEnd = Date.parse(period.end);
  const intervals = values.filter((value) => value.variable === variable && value.value !== null && value.validPeriod)
    .map((value) => value.validPeriod!).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  let cursor = targetStart;
  for (const interval of intervals) {
    const start = Date.parse(interval.start);
    const end = Date.parse(interval.end);
    if (start > cursor) break;
    cursor = Math.max(cursor, end);
    if (cursor >= targetEnd) return true;
  }
  return false;
}

export function assessLocalForecast(point: PointForecast, period: Period, now: number): LocalAssessment {
  const rows = new Map<string, LocalAssessment["rows"][number]>();
  for (const value of point.values) {
    if (!value.validPeriod) continue;
    const key = value.validPeriod.start;
    const row = rows.get(key) ?? { period: value.validPeriod, probability: null, amountMm: null, meanRateMmH: null };
    if (value.variable === "precipitationProbability") row.probability = value.value;
    if (value.variable === "precipitationAmount") row.amountMm = value.value;
    if (value.variable === "precipitationRate") row.meanRateMmH = value.value;
    rows.set(key, row);
  }
  const ordered = [...rows.values()].sort((a, b) => Date.parse(a.period.start) - Date.parse(b.period.start));
  const covered = covers(period, point.values, "precipitationProbability") && covers(period, point.values, "precipitationAmount");
  const latestRetrieval = Math.max(0, ...point.values.map((value) => Date.parse(value.retrievedAt)));
  if (!covered || latestRetrieval + 20 * 60_000 < now || point.status === "unavailable") {
    return { state: "insufficient-data", message: "Faltan datos para recomendar", reason: !covered
      ? "No hay datos completos para las próximas horas."
      : "El pronóstico está vencido; actualiza con conexión.", rows: ordered, covered };
  }
  const rainSignal = ordered.some((row) => Date.parse(row.period.end) > Date.parse(period.start) &&
    Date.parse(row.period.start) < Date.parse(period.end) &&
    ((row.amountMm ?? 0) > 0 || (row.probability ?? 0) >= 0.5));
  return rainSignal
    ? { state: "rain-signal", message: "Considera llevar impermeable", reason: "Hay lluvia prevista o una hora con probabilidad de al menos 50 %.", rows: ordered, covered }
    : { state: "no-rain-signal", message: "Sin señal clara de lluvia", reason: "Sin acumulación prevista y con probabilidades menores de 50 %. Puede llover localmente.", rows: ordered, covered };
}
