import type { Point } from "@/domain/provider-common";

export function distanceM(a: Point, b: Point): number {
  const radians = Math.PI / 180;
  const latitude = (b.lat - a.lat) * radians;
  const longitude = (b.lon - a.lon) * radians;
  const chord = Math.sin(latitude / 2) ** 2 +
    Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(longitude / 2) ** 2;
  return 12_742_000 * Math.asin(Math.min(1, Math.sqrt(chord)));
}
