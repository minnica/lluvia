import { pointSchema, type Point } from "@/domain/provider-common";

export function parseCoordinates(value: string): Point | null {
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length !== 2 || parts.some((part) => !part || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(part))) return null;
  const parsed = pointSchema.safeParse({ lat: Number(parts[0]), lon: Number(parts[1]) });
  return parsed.success ? parsed.data : null;
}

export const formatCoordinates = (point: Point) => `${point.lat}, ${point.lon}`;
