import type { Point } from "@/domain/provider-common";
import type { Route } from "@/domain/routing/contracts";
import { distanceM } from "@/domain/routing/geometry";

export type PassagePoint = { position: Point; seconds: number; distanceM: number; afterVertex: number };
export type RouteSegment = { id: string; start: PassagePoint; end: PassagePoint; midpoint: PassagePoint; geometry: [number, number][] };

function atSeconds(route: Route, seconds: number): PassagePoint {
  const progress = route.progress;
  const next = progress.findIndex((point) => point.durationFromStartSeconds >= seconds);
  if (next <= 0) return { position: progress[0].position, seconds: 0, distanceM: 0, afterVertex: 0 };
  const left = progress[next - 1];
  const right = progress[next];
  const span = right.durationFromStartSeconds - left.durationFromStartSeconds;
  const fraction = span === 0 ? 1 : (seconds - left.durationFromStartSeconds) / span;
  return {
    position: { lat: left.position.lat + (right.position.lat - left.position.lat) * fraction,
      lon: left.position.lon + (right.position.lon - left.position.lon) * fraction },
    seconds,
    distanceM: left.distanceFromStartM + (right.distanceFromStartM - left.distanceFromStartM) * fraction,
    afterVertex: next - 1,
  };
}

export function sampleRoute(route: Route): RouteSegment[] {
  if (route.durationSeconds <= 0) return [];
  const steps = Math.ceil(route.durationSeconds / 240);
  if (steps > 24) throw new Error("El recorrido requiere demasiados puntos para una sola consulta");
  const seconds = Array.from({ length: steps + 1 }, (_, index) => route.durationSeconds * index / steps);
  // Split fast sections until no sampled span is longer than about 3 km.
  for (let index = 0; index < seconds.length - 1; index++) {
    const left = atSeconds(route, seconds[index]);
    const right = atSeconds(route, seconds[index + 1]);
    if (right.distanceM - left.distanceM > 3000) {
      if (seconds.length - 1 >= 24) throw new Error("El recorrido requiere demasiados puntos para una sola consulta");
      seconds.splice(index + 1, 0, (left.seconds + right.seconds) / 2);
      index--;
    }
  }
  // Add a few substantial bends when their passage time is distinct from existing samples.
  const bends = route.progress.slice(1, -1).map((point, index) => {
    const previous = route.progress[index].position;
    const current = point.position;
    const next = route.progress[index + 2].position;
    const scale = Math.cos(current.lat * Math.PI / 180);
    const ax = (current.lon - previous.lon) * scale;
    const ay = current.lat - previous.lat;
    const bx = (next.lon - current.lon) * scale;
    const by = next.lat - current.lat;
    const magnitude = Math.hypot(ax, ay) * Math.hypot(bx, by);
    return { seconds: point.durationFromStartSeconds,
      cosine: magnitude ? (ax * bx + ay * by) / magnitude : 1,
      longEnough: distanceM(previous, current) > 70 && distanceM(current, next) > 70 };
  }).filter((bend) => bend.longEnough && bend.cosine < Math.cos(60 * Math.PI / 180))
    .sort((a, b) => a.cosine - b.cosine);
  for (const bend of bends) {
    if (seconds.length - 1 >= 24) break;
    if (seconds.every((value) => Math.abs(value - bend.seconds) >= 75)) seconds.push(bend.seconds);
  }
  seconds.sort((a, b) => a - b);
  const boundaries = seconds.map((value) => atSeconds(route, value));
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const midpoint = atSeconds(route, (start.seconds + end.seconds) / 2);
    const geometry: [number, number][] = [[start.position.lon, start.position.lat]];
    for (let vertex = start.afterVertex + 1; vertex <= end.afterVertex; vertex++) {
      const point = route.progress[vertex].position;
      geometry.push([point.lon, point.lat]);
    }
    geometry.push([end.position.lon, end.position.lat]);
    return { id: `s${index + 1}`, start, end, midpoint, geometry };
  });
}
