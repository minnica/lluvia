import "server-only";
import { z } from "zod";
import { pointSchema } from "@/domain/provider-common";
import { validateWeatherResponse } from "@/domain/weather/contracts";
import type { ProductCapability, ProviderError, WeatherProvider, WeatherRequest, WeatherResponse, WeatherValue } from "@/domain/weather/contracts";
import { amountToMeanRate, percentageToProbability } from "@/domain/weather/units";
import { WeatherProviderFailure } from "@/server/providers/weather/error";

const product = "forecast-hourly";
const adapterVersion = "1";
export const WEATHERBIT_CACHE_SECONDS = 300;
const apiSchema = z.object({
  lat: z.number().finite(),
  lon: z.number().finite(),
  data: z.array(z.object({
    timestamp_utc: z.string(),
    pop: z.number().min(0).max(100).nullable().optional(),
    precip: z.number().finite().nonnegative().nullable().optional(),
  })).min(1),
});

function failure(code: ProviderError["code"], message: string, retryable = true): WeatherProviderFailure {
  return new WeatherProviderFailure({ code, retryable, message });
}

function hourEnd(raw: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:00:00$/.test(raw)) throw failure("invalid-response", "Hora Weatherbit inválida", false);
  const time = Date.parse(`${raw}Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 19) !== raw) {
    throw failure("invalid-response", "Hora Weatherbit inválida", false);
  }
  return time;
}

export function normalizeWeatherbit(raw: unknown, request: WeatherRequest, pointId: string, retrievedAt: string): WeatherResponse["points"][number] {
  const parsed = apiSchema.safeParse(raw);
  if (!parsed.success) throw failure("invalid-response", "Respuesta de Weatherbit inválida", false);
  const requestedPoint = request.points.find((point) => point.id === pointId)?.position;
  if (!requestedPoint) throw failure("invalid-response", "Punto no solicitado", false);
  const resolvedPoint = pointSchema.parse({ lat: parsed.data.lat, lon: parsed.data.lon });
  const start = Date.parse(request.period.start);
  const end = Date.parse(request.period.end);
  const values: WeatherValue[] = [];
  const availablePeriods: WeatherResponse["points"][number]["availablePeriods"] = [];
  let previous = -Infinity;
  let missing = false;
  for (const hour of parsed.data.data) {
    const periodEnd = hourEnd(hour.timestamp_utc);
    if (periodEnd <= previous) throw failure("invalid-response", "Horas Weatherbit desordenadas", false);
    // Weatherbit's hourly accumulation FAQ assigns precipitation to the preceding hour.
    const periodStart = periodEnd - 3_600_000;
    const tail = availablePeriods.at(-1);
    if (tail && periodEnd - previous === 3_600_000) tail.period.end = new Date(periodEnd).toISOString();
    else availablePeriods.push({ product, period: { start: new Date(periodStart).toISOString(), end: new Date(periodEnd).toISOString() } });
    previous = periodEnd;
    if (periodEnd <= start || periodStart >= end) continue;
    const validPeriod = { start: new Date(periodStart).toISOString(), end: new Date(periodEnd).toISOString() };
    const base = { validPeriod, validAt: null, product, model: null, issuedAt: null, retrievedAt,
      outputStepMinutes: 60, nativeStepMinutes: null, spatialResolutionM: null, origin: "model" as const,
      flags: ["unknown-issue-time", "unknown-resolution"] as WeatherValue["flags"] };
    const probability = hour.pop === undefined ? null : hour.pop;
    const amount = hour.precip === undefined ? null : hour.precip;
    if (request.variables.includes("precipitationProbability")) {
      if (probability === null) missing = true;
      values.push({ ...base, variable: "precipitationProbability", value: probability === null ? null : percentageToProbability(probability),
        unit: "probability", temporalMeaning: "period-probability",
        probabilityEvent: { thresholdMm: null, comparison: "unknown", description: "Precipitación durante la hora; umbral no publicado" } });
    }
    if (request.variables.includes("precipitationAmount")) {
      if (amount === null) missing = true;
      values.push({ ...base, variable: "precipitationAmount", value: amount, unit: "mm", temporalMeaning: "period-total", probabilityEvent: null });
    }
    if (request.variables.includes("precipitationRate")) {
      if (amount === null) missing = true;
      values.push({ ...base, variable: "precipitationRate", value: amount === null ? null : amountToMeanRate(amount, 60),
        unit: "mm/h", temporalMeaning: "period-mean", probabilityEvent: null });
    }
  }
  const fullCoverage = availablePeriods.some(({ period }) => Date.parse(period.start) <= start && Date.parse(period.end) >= end);
  const warnings = ["Pronóstico horario Weatherbit; modelo, emisión, resolución nativa y umbral de probabilidad no informados.",
    "La hora de precipitación sigue el ejemplo de acumulación precedente de Weatherbit; su documentación también describe un intervalo siguiente. Confirmar antes de usar este proveedor para decisiones."];
  if (!fullCoverage) warnings.push("El horizonte solicitado no está cubierto de forma continua.");
  if (missing) warnings.push("Hay valores horarios ausentes.");
  return { pointId, requestedPoint, resolvedPoint,
    status: values.length === 0 ? "unavailable" : fullCoverage && !missing ? "ok" : "partial",
    values, availablePeriods,
    warnings, error: values.length === 0 ? { code: "unavailable", retryable: true, message: "Sin horas disponibles para el periodo" } : null };
}

export class WeatherbitProvider implements WeatherProvider {
  readonly id = "weatherbit" as const;

  async getCapabilities(): Promise<ProductCapability[]> {
    return [{ product, variables: ["precipitationProbability", "precipitationAmount", "precipitationRate"],
      horizonMinutes: null, outputStepMinutes: 60, nativeStepMinutes: null, spatialResolutionM: null, availability: "documented" }];
  }

  async getForecast(request: WeatherRequest): Promise<WeatherResponse> {
    const key = process.env.WEATHERBIT_API_KEY;
    if (!key) throw failure("configuration", "Falta WEATHERBIT_API_KEY", false);
    const loadPoint = async ({ id, position }: WeatherRequest["points"][number]): Promise<WeatherResponse["points"][number]> => {
      try {
        const url = new URL("https://api.weatherbit.io/v2.0/forecast/hourly");
        url.searchParams.set("lat", String(position.lat));
        url.searchParams.set("lon", String(position.lon));
        url.searchParams.set("units", "M");
        url.searchParams.set("hours", String(Math.min(48, Math.max(12, Math.ceil((Date.parse(request.period.end) - Date.now()) / 3_600_000) + 2))));
        url.searchParams.set("key", key);
        let response: Response;
        try { response = await fetch(url, { signal: request.signal, next: { revalidate: WEATHERBIT_CACHE_SECONDS } }); }
        catch (error) {
          if (request.signal?.aborted || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))) {
            throw failure("timeout", "La consulta Weatherbit agotó el tiempo de espera");
          }
          throw failure("unavailable", "Weatherbit no está disponible");
        }
        if (response.status === 204) throw failure("unavailable", "Weatherbit no devolvió datos para esta ubicación");
        if (!response.ok) {
          if (response.status === 429) throw failure("quota", "Weatherbit alcanzó su cuota");
          if (response.status === 401 || response.status === 403) throw failure("configuration", "Weatherbit rechazó la clave o el acceso al producto", false);
          throw failure("unavailable", `Weatherbit respondió con estado ${response.status}`);
        }
        let raw: unknown;
        try { raw = await response.json(); } catch { throw failure("invalid-response", "Weatherbit devolvió JSON inválido", false); }
        const serverDate = Date.parse(response.headers.get("date") ?? "");
        const retrievedAt = Number.isFinite(serverDate) && serverDate <= Date.now()
          ? new Date(serverDate).toISOString() : new Date().toISOString();
        return normalizeWeatherbit(raw, request, id, retrievedAt);
      } catch (error) {
        const detail = error instanceof WeatherProviderFailure ? error.detail :
          { code: "invalid-response" as const, retryable: false, message: "No se pudo interpretar la respuesta Weatherbit" };
        if (request.points.length === 1 || detail.code === "configuration") throw new WeatherProviderFailure(detail);
        return { pointId: id, requestedPoint: position, resolvedPoint: null, status: "unavailable", values: [],
          availablePeriods: [], warnings: [], error: detail };
      }
    };
    const points: WeatherResponse["points"] = [];
    for (let index = 0; index < request.points.length; index += 4) {
      points.push(...await Promise.all(request.points.slice(index, index + 4).map(loadPoint)));
    }
    return validateWeatherResponse({ schemaVersion: 1, provider: this.id, adapterVersion, requestId: crypto.randomUUID(), points }, request);
  }
}
