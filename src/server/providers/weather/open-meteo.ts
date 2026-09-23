import "server-only";
import { z } from "zod";
import { pointSchema } from "@/domain/provider-common";
import { validateWeatherResponse } from "@/domain/weather/contracts";
import type { ProductCapability, ProviderError, WeatherProvider, WeatherRequest, WeatherResponse, WeatherValue, Variable } from "@/domain/weather/contracts";
import { amountToMeanRate, percentageToProbability } from "@/domain/weather/units";

const product = "forecast-hourly-best-match";
const adapterVersion = "1";
const apiSchema = z.object({
  latitude: z.number().finite(),
  longitude: z.number().finite(),
  elevation: z.number().finite().optional(),
  utc_offset_seconds: z.literal(0),
  hourly_units: z.object({
    precipitation_probability: z.literal("%").optional(),
    precipitation: z.literal("mm").optional(),
  }),
  hourly: z.object({
    time: z.array(z.string()),
    precipitation_probability: z.array(z.number().min(0).max(100).nullable()).optional(),
    precipitation: z.array(z.number().finite().nonnegative().nullable()).optional(),
  }),
});

export class WeatherProviderFailure extends Error {
  constructor(readonly detail: ProviderError) { super(detail.message); }
}

function endpoint(): URL {
  const url = new URL(process.env.OPEN_METEO_BASE_URL || "https://api.open-meteo.com/v1/forecast");
  if (url.protocol !== "https:" ||
      !["api.open-meteo.com", "customer-api.open-meteo.com"].includes(url.hostname) ||
      url.pathname !== "/v1/forecast" || url.port || url.search || url.hash) {
    throw new WeatherProviderFailure({ code: "configuration", retryable: false, message: "Endpoint Open-Meteo no permitido" });
  }
  return url;
}

function failure(code: ProviderError["code"], message: string, retryable = true): WeatherProviderFailure {
  return new WeatherProviderFailure({ code, retryable, message });
}

function hourlyInstant(raw: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) throw failure("invalid-response", "Hora meteorológica inválida", false);
  const time = Date.parse(`${raw}:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 16) !== raw) {
    throw failure("invalid-response", "Hora meteorológica inválida", false);
  }
  return time;
}

export function normalizeOpenMeteo(raw: unknown, request: WeatherRequest, pointId: string, retrievedAt: string): WeatherResponse["points"][number] {
  const parsed = apiSchema.safeParse(raw);
  if (!parsed.success) throw failure("invalid-response", "Respuesta de Open-Meteo inválida", false);
  const data = parsed.data;
  const { time } = data.hourly;
  if (!time.length || (!data.hourly.precipitation_probability && !data.hourly.precipitation) ||
      (data.hourly.precipitation_probability && data.hourly_units.precipitation_probability !== "%") ||
      (data.hourly.precipitation && data.hourly_units.precipitation !== "mm") ||
      (data.hourly.precipitation_probability && time.length !== data.hourly.precipitation_probability.length) ||
      (data.hourly.precipitation && time.length !== data.hourly.precipitation.length)) {
    throw failure("invalid-response", "Series horarias incompletas de Open-Meteo", false);
  }
  const probabilities = data.hourly.precipitation_probability ?? time.map(() => null);
  const amounts = data.hourly.precipitation ?? time.map(() => null);
  const requestedPoint = request.points.find((point) => point.id === pointId)?.position;
  if (!requestedPoint) throw failure("invalid-response", "Punto no solicitado", false);
  const resolvedPoint = pointSchema.parse({ lat: data.latitude, lon: data.longitude, ...(data.elevation === undefined ? {} : { elevationM: data.elevation }) });
  const start = Date.parse(request.period.start);
  const end = Date.parse(request.period.end);
  const flags = ["unknown-issue-time", "unknown-resolution"] as const;
  const values: WeatherValue[] = [];
  let first = Infinity;
  let last = -Infinity;
  let previous = -Infinity;
  for (let index = 0; index < time.length; index++) {
    const periodEnd = hourlyInstant(time[index]);
    if (periodEnd <= previous) throw failure("invalid-response", "Horas meteorológicas desordenadas", false);
    previous = periodEnd;
    const periodStart = periodEnd - 3_600_000;
    first = Math.min(first, periodStart);
    last = Math.max(last, periodEnd);
    if (periodEnd <= start || periodStart >= end) continue;
    const validPeriod = { start: new Date(periodStart).toISOString(), end: new Date(periodEnd).toISOString() };
    const base = { validPeriod, validAt: null, product, model: null, issuedAt: null, retrievedAt,
      outputStepMinutes: 60, nativeStepMinutes: null, spatialResolutionM: null, origin: "model" as const, flags: [...flags] };
    if (request.variables.includes("precipitationProbability")) values.push({
      ...base, variable: "precipitationProbability", value: probabilities[index] === null ? null : percentageToProbability(probabilities[index]!),
      unit: "probability", temporalMeaning: "period-probability", probabilityEvent: {
        thresholdMm: 0.1, comparison: "gt", description: "Más de 0.1 mm durante la hora precedente",
      },
    });
    if (request.variables.includes("precipitationAmount")) values.push({
      ...base, variable: "precipitationAmount", value: amounts[index], unit: "mm", temporalMeaning: "period-total", probabilityEvent: null,
    });
    if (request.variables.includes("precipitationRate")) values.push({
      ...base, variable: "precipitationRate", value: amounts[index] === null ? null : amountToMeanRate(amounts[index]!, 60),
      unit: "mm/h", temporalMeaning: "period-mean", probabilityEvent: null,
    });
  }
  const fullCoverage = first <= start && last >= end;
  const missing = values.some((value) => value.value === null);
  const warnings = ["Modelo automático best_match; modelo y hora de emisión de cada variable no expuestos por esta respuesta.",
    "La cuadrícula meteorológica puede diferir de la ubicación indicada."];
  if (!fullCoverage) warnings.push("El horizonte solicitado no está cubierto por completo.");
  if (missing) warnings.push("Hay valores horarios ausentes.");
  return {
    pointId, requestedPoint, resolvedPoint,
    status: values.length === 0 ? "unavailable" : fullCoverage && !missing ? "ok" : "partial",
    values,
    availablePeriods: [{ product, period: { start: new Date(first).toISOString(), end: new Date(last).toISOString() } }],
    warnings,
    error: values.length === 0 ? { code: "unavailable", retryable: true, message: "Sin horas disponibles para el periodo" } : null,
  };
}

export class OpenMeteoProvider implements WeatherProvider {
  readonly id = "open-meteo" as const;

  async getCapabilities(): Promise<ProductCapability[]> {
    return [{ product, variables: ["precipitationProbability", "precipitationAmount", "precipitationRate"],
      horizonMinutes: null, outputStepMinutes: 60, nativeStepMinutes: null, spatialResolutionM: null, availability: "documented" }];
  }

  async getForecast(request: WeatherRequest): Promise<WeatherResponse> {
    const variables: Variable[] = ["precipitationProbability", "precipitationAmount", "precipitationRate"];
    if (request.variables.some((variable) => !variables.includes(variable))) throw failure("configuration", "Variable meteorológica no admitida", false);
    const loadPoint = async ({ id, position }: WeatherRequest["points"][number]): Promise<WeatherResponse["points"][number]> => {
      try {
        const url = endpoint();
        url.searchParams.set("latitude", String(position.lat));
        url.searchParams.set("longitude", String(position.lon));
        url.searchParams.set("hourly", "precipitation_probability,precipitation");
        url.searchParams.set("timezone", "UTC");
        url.searchParams.set("precipitation_unit", "mm");
        url.searchParams.set("past_days", "1");
        url.searchParams.set("forecast_days", "2");
        if (position.elevationM !== undefined) url.searchParams.set("elevation", String(position.elevationM));
        if (process.env.OPEN_METEO_API_KEY) url.searchParams.set("apikey", process.env.OPEN_METEO_API_KEY);
        let response: Response;
        try { response = await fetch(url, { cache: "no-store", signal: request.signal }); }
        catch (error) {
          if (request.signal?.aborted || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))) throw failure("timeout", "La consulta meteorológica agotó el tiempo de espera");
          throw failure("unavailable", "Open-Meteo no está disponible");
        }
        if (!response.ok) {
          if (response.status === 429) throw failure("quota", "Open-Meteo alcanzó su cuota");
          throw failure("unavailable", `Open-Meteo respondió con estado ${response.status}`);
        }
        let raw: unknown;
        try { raw = await response.json(); } catch { throw failure("invalid-response", "Open-Meteo devolvió JSON inválido", false); }
        return normalizeOpenMeteo(raw, request, id, new Date().toISOString());
      } catch (error) {
        const detail = error instanceof WeatherProviderFailure ? error.detail :
          { code: "invalid-response" as const, retryable: false, message: "No se pudo interpretar la respuesta meteorológica" };
        if (request.points.length === 1 || detail.code === "configuration") throw new WeatherProviderFailure(detail);
        return { pointId: id, requestedPoint: position, resolvedPoint: null, status: "unavailable", values: [],
          availablePeriods: [], warnings: [], error: detail };
      }
    };
    const points: WeatherResponse["points"] = [];
    // Concurrency is bounded to avoid one long serial route query or a request burst.
    for (let index = 0; index < request.points.length; index += 4) {
      points.push(...await Promise.all(request.points.slice(index, index + 4).map(loadPoint)));
    }
    return validateWeatherResponse({ schemaVersion: 1, provider: this.id, adapterVersion, requestId: crypto.randomUUID(), points }, request);
  }
}
