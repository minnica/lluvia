import { z } from "zod";

// Los instantes del dominio son UTC; la zona local se aplica solo al presentar.
export const instantSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
  "Se requiere un instante ISO 8601 UTC",
).refine((value) => {
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) &&
    date.getUTCFullYear() === Number(value.slice(0, 4)) &&
    date.getUTCMonth() + 1 === Number(value.slice(5, 7)) &&
    date.getUTCDate() === Number(value.slice(8, 10)) &&
    date.getUTCHours() === Number(value.slice(11, 13)) &&
    date.getUTCMinutes() === Number(value.slice(14, 16)) &&
    date.getUTCSeconds() === Number(value.slice(17, 19));
}, "Instante inexistente");

export const pointSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  elevationM: z.number().finite().optional(),
}).strict();

export const periodSchema = z.object({
  start: instantSchema,
  end: instantSchema,
}).strict().refine(
  ({ start, end }) => Date.parse(end) > Date.parse(start),
  "El fin debe ser posterior al inicio",
);

export type Instant = z.infer<typeof instantSchema>;
export type Point = z.infer<typeof pointSchema>;
export type Period = z.infer<typeof periodSchema>;
