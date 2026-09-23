import { z } from "zod";
import { instantSchema, periodSchema, pointSchema } from "@/domain/provider-common";
import type { Point } from "@/domain/provider-common";

export const weatherIdSchema = z.enum(["open-meteo", "openweather", "weatherbit"]);
export const variableSchema = z.enum([
  "precipitationProbability", "precipitationRate", "precipitationAmount",
]);
export const qualityFlagSchema = z.enum([
  "interpolated", "unknown-resolution", "unknown-issue-time", "stale",
  "partial-horizon", "outside-coverage",
]);

const nonNegative = z.number().finite().nonnegative();
const positiveMinutes = z.number().finite().positive();

export const productCapabilitySchema = z.object({
  product: z.string().min(1),
  variables: z.array(variableSchema),
  horizonMinutes: nonNegative.nullable(),
  outputStepMinutes: positiveMinutes.nullable(),
  nativeStepMinutes: positiveMinutes.nullable(),
  spatialResolutionM: nonNegative.nullable(),
  availability: z.enum(["documented", "verified", "unavailable", "unknown"]),
}).strict();

export const weatherRequestSchema = z.object({
  points: z.array(z.object({ id: z.string().min(1), position: pointSchema }).strict()).min(1),
  period: periodSchema,
  variables: z.array(variableSchema).min(1),
  products: z.array(z.string().min(1)).optional(),
}).strict().superRefine((request, ctx) => {
  if (new Set(request.points.map((point) => point.id)).size !== request.points.length) {
    ctx.addIssue({ code: "custom", path: ["points"], message: "Los IDs de puntos deben ser únicos" });
  }
});

export const providerErrorSchema = z.object({
  code: z.enum(["configuration", "quota", "timeout", "unavailable", "invalid-response"]),
  retryable: z.boolean(),
  retryAfterSeconds: nonNegative.optional(),
  message: z.string().min(1),
}).strict();

export const weatherValueSchema = z.object({
  variable: variableSchema,
  value: z.number().finite().nonnegative().nullable(),
  unit: z.enum(["probability", "mm/h", "mm"]),
  validPeriod: periodSchema.nullable(),
  validAt: instantSchema.nullable(),
  temporalMeaning: z.enum(["instant", "period-mean", "period-total", "period-probability"]),
  probabilityEvent: z.object({
    thresholdMm: nonNegative.nullable(),
    comparison: z.enum(["gt", "gte", "unknown"]),
    description: z.string().min(1),
  }).strict().nullable(),
  product: z.string().min(1),
  model: z.string().min(1).nullable(),
  issuedAt: instantSchema.nullable(),
  retrievedAt: instantSchema,
  outputStepMinutes: positiveMinutes.nullable(),
  nativeStepMinutes: positiveMinutes.nullable(),
  spatialResolutionM: nonNegative.nullable(),
  origin: z.enum(["model", "nowcast", "interpolated", "unknown"]),
  flags: z.array(qualityFlagSchema),
}).strict().superRefine((datum, ctx) => {
  const unitByVariable = {
    precipitationProbability: "probability",
    precipitationRate: "mm/h",
    precipitationAmount: "mm",
  } as const;
  if (datum.unit !== unitByVariable[datum.variable]) {
    ctx.addIssue({ code: "custom", path: ["unit"], message: "Unidad incompatible con la variable" });
  }
  if (datum.variable === "precipitationProbability") {
    if (datum.value !== null && datum.value > 1) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "La probabilidad debe estar entre 0 y 1" });
    }
    if (datum.temporalMeaning !== "period-probability" || datum.probabilityEvent === null) {
      ctx.addIssue({ code: "custom", path: ["probabilityEvent"], message: "La probabilidad requiere evento y periodo" });
    }
  } else if (datum.probabilityEvent !== null || datum.temporalMeaning === "period-probability") {
    ctx.addIssue({ code: "custom", path: ["probabilityEvent"], message: "Solo la probabilidad describe un evento" });
  }
  if (datum.variable === "precipitationAmount" && datum.temporalMeaning !== "period-total") {
    ctx.addIssue({ code: "custom", path: ["temporalMeaning"], message: "La acumulación requiere un periodo total" });
  }
  if (datum.variable === "precipitationRate" &&
      !["instant", "period-mean"].includes(datum.temporalMeaning)) {
    ctx.addIssue({ code: "custom", path: ["temporalMeaning"], message: "La tasa requiere un instante o media de periodo" });
  }
  const hasPeriod = datum.validPeriod !== null;
  const hasInstant = datum.validAt !== null;
  if (datum.temporalMeaning === "instant" ? (hasPeriod || !hasInstant) : (!hasPeriod || hasInstant)) {
    ctx.addIssue({ code: "custom", path: ["validPeriod"], message: "El periodo o instante no corresponde al significado temporal" });
  }
  if (datum.issuedAt === null && !datum.flags.includes("unknown-issue-time")) {
    ctx.addIssue({ code: "custom", path: ["flags"], message: "Debe marcarse la hora de emisión desconocida" });
  }
});

export const pointForecastSchema = z.object({
  pointId: z.string().min(1),
  requestedPoint: pointSchema,
  resolvedPoint: pointSchema.nullable(),
  status: z.enum(["ok", "partial", "unavailable"]),
  values: z.array(weatherValueSchema),
  availablePeriods: z.array(z.object({ product: z.string().min(1), period: periodSchema }).strict()),
  warnings: z.array(z.string()),
  error: providerErrorSchema.nullable(),
}).strict().superRefine((point, ctx) => {
  if (point.status === "unavailable" && point.values.length > 0) {
    ctx.addIssue({ code: "custom", path: ["values"], message: "Un punto no disponible no contiene valores" });
  }
  if (point.status === "ok" && point.error !== null) {
    ctx.addIssue({ code: "custom", path: ["error"], message: "Un punto sin fallos no contiene error" });
  }
});

export const weatherResponseSchema = z.object({
  schemaVersion: z.literal(1),
  provider: weatherIdSchema,
  adapterVersion: z.string().min(1),
  requestId: z.string().min(1),
  points: z.array(pointForecastSchema),
}).strict().superRefine((response, ctx) => {
  if (new Set(response.points.map((point) => point.pointId)).size !== response.points.length) {
    ctx.addIssue({ code: "custom", path: ["points"], message: "Los IDs de respuesta deben ser únicos" });
  }
});

export type WeatherId = z.infer<typeof weatherIdSchema>;
export type Variable = z.infer<typeof variableSchema>;
export type QualityFlag = z.infer<typeof qualityFlagSchema>;
export type ProductCapability = z.infer<typeof productCapabilitySchema>;
export type WeatherRequest = z.infer<typeof weatherRequestSchema> & { signal?: AbortSignal };
export type WeatherValue = z.infer<typeof weatherValueSchema>;
export type PointForecast = z.infer<typeof pointForecastSchema>;
export type ProviderError = z.infer<typeof providerErrorSchema>;
export type WeatherResponse = z.infer<typeof weatherResponseSchema>;

export interface WeatherProvider {
  readonly id: WeatherId;
  getCapabilities(point: Point): Promise<ProductCapability[]>;
  getForecast(request: WeatherRequest): Promise<WeatherResponse>;
}

// Comprueba que el lote responde exactamente a los puntos solicitados.
export function validateWeatherResponse(response: unknown, request: WeatherRequest): WeatherResponse {
  const parsed = weatherResponseSchema.parse(response);
  const requested = new Map(request.points.map(({ id, position }) => [id, position]));
  if (parsed.points.length !== requested.size || parsed.points.some((point) => {
    const position = requested.get(point.pointId);
    return !position || position.lat !== point.requestedPoint.lat ||
      position.lon !== point.requestedPoint.lon ||
      position.elevationM !== point.requestedPoint.elevationM;
  })) {
    throw new Error("La respuesta meteorológica no corresponde a los puntos solicitados");
  }
  return parsed;
}
