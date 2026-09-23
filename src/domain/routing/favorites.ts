import { z } from "zod";
import { instantSchema, pointSchema } from "@/domain/provider-common";

export const savedRouteSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  name: z.string().trim().min(1).max(80),
  origin: pointSchema,
  destination: pointSchema,
  via: z.array(pointSchema).max(4),
  profile: z.enum(["motorcycle", "car"]),
  avoid: z.array(z.enum(["tolls", "motorways", "unpaved"])).max(3),
  createdAt: instantSchema,
  updatedAt: instantSchema,
}).strict();

export const routeExportSchema = z.object({
  format: z.literal("lluvia-routes"), version: z.literal(1),
  exportedAt: instantSchema,
  routes: z.array(savedRouteSchema).max(100),
}).strict();

export type SavedRoute = z.infer<typeof savedRouteSchema>;

export function mergeImportedRoutes(existing: SavedRoute[], incoming: SavedRoute[], makeId: () => string) {
  const merged = [...existing];
  let skipped = 0;
  let renamed = 0;
  const signature = (route: SavedRoute) => JSON.stringify([route.name, route.origin, route.destination,
    route.via, route.profile, [...route.avoid].sort()]);
  for (const route of incoming) {
    const duplicate = merged.find((item) => signature(item) === signature(route));
    if (duplicate) { skipped++; continue; }
    let next = route;
    if (merged.some((item) => item.id === route.id)) { next = { ...route, id: makeId() }; renamed++; }
    merged.push(next);
  }
  return { merged, skipped, renamed };
}
