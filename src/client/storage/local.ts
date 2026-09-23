import { openDB, type DBSchema } from "idb";
import { pointSchema } from "@/domain/provider-common";
import type { Point } from "@/domain/provider-common";
import { weatherResponseSchema } from "@/domain/weather/contracts";
import type { WeatherResponse } from "@/domain/weather/contracts";
import { savedRouteSchema, routeExportSchema, mergeImportedRoutes } from "@/domain/routing/favorites";
import type { SavedRoute } from "@/domain/routing/favorites";

export type SavedLocation = { id: string; name: string; point: Point; createdAt: string };
export type Preferences = { selectedLocationId: string };
export type ForecastSnapshot = { id: string; period: { start: string; end: string }; forecast: WeatherResponse };

interface LocalDatabase extends DBSchema {
  locations: { key: string; value: SavedLocation };
  settings: { key: string; value: Preferences };
  snapshots: { key: string; value: ForecastSnapshot };
  routes: { key: string; value: SavedRoute };
}

const db = () => openDB<LocalDatabase>("lluvia-local", 2, {
  upgrade(database, oldVersion) {
    if (oldVersion < 1) {
      database.createObjectStore("locations", { keyPath: "id" });
      database.createObjectStore("settings");
      database.createObjectStore("snapshots", { keyPath: "id" });
    }
    if (oldVersion < 2) database.createObjectStore("routes", { keyPath: "id" });
  },
});

export async function loadLocalState() {
  const database = await db();
  const [locations, preferences] = await Promise.all([database.getAll("locations"), database.get("settings", "preferences")]);
  return {
    locations: locations.filter((location) => pointSchema.safeParse(location.point).success),
    preferences: preferences && typeof preferences.selectedLocationId === "string" ? preferences : null,
  };
}

export async function saveLocation(location: SavedLocation) { await (await db()).put("locations", location); }
export async function savePreferences(preferences: Preferences) { await (await db()).put("settings", preferences, "preferences"); }
export async function saveSnapshot(snapshot: ForecastSnapshot) { await (await db()).put("snapshots", snapshot); }
export async function loadSnapshot(id: string): Promise<ForecastSnapshot | null> {
  const snapshot = await (await db()).get("snapshots", id);
  if (!snapshot || !weatherResponseSchema.safeParse(snapshot.forecast).success) return null;
  return snapshot;
}

export async function loadRoutes(): Promise<SavedRoute[]> {
  return (await (await db()).getAll("routes")).filter((route) => savedRouteSchema.safeParse(route).success);
}

export async function saveRoute(route: SavedRoute) { await (await db()).put("routes", savedRouteSchema.parse(route)); }
export async function deleteRoute(id: string) { await (await db()).delete("routes", id); }

export async function exportRoutes(): Promise<string> {
  return JSON.stringify(routeExportSchema.parse({ format: "lluvia-routes", version: 1,
    exportedAt: new Date().toISOString(), routes: await loadRoutes() }), null, 2);
}

export async function importRoutes(json: string) {
  if (json.length > 250_000) throw new Error("El archivo es demasiado grande");
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new Error("El archivo no contiene JSON válido"); }
  const parsed = routeExportSchema.safeParse(raw);
  if (!parsed.success) throw new Error("El archivo no tiene un formato de rutas compatible");
  const current = await loadRoutes();
  const result = mergeImportedRoutes(current, parsed.data.routes, () => crypto.randomUUID());
  if (result.merged.length > 100) throw new Error("El dispositivo admite hasta 100 recorridos guardados");
  const database = await db();
  const transaction = database.transaction("routes", "readwrite");
  for (const route of result.merged.slice(current.length)) await transaction.store.put(route);
  await transaction.done;
  return { added: result.merged.length - current.length, skipped: result.skipped, renamed: result.renamed };
}
