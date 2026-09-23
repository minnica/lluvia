import { openDB, type DBSchema } from "idb";
import { pointSchema } from "@/domain/provider-common";
import type { Point } from "@/domain/provider-common";
import { weatherResponseSchema } from "@/domain/weather/contracts";
import type { WeatherResponse } from "@/domain/weather/contracts";

export type SavedLocation = { id: string; name: string; point: Point; createdAt: string };
export type Preferences = { selectedLocationId: string; minutes: number };
export type ForecastSnapshot = { id: string; period: { start: string; end: string }; forecast: WeatherResponse };

interface LocalDatabase extends DBSchema {
  locations: { key: string; value: SavedLocation };
  settings: { key: string; value: Preferences };
  snapshots: { key: string; value: ForecastSnapshot };
}

const db = () => openDB<LocalDatabase>("lluvia-local", 1, {
  upgrade(database) {
    database.createObjectStore("locations", { keyPath: "id" });
    database.createObjectStore("settings");
    database.createObjectStore("snapshots", { keyPath: "id" });
  },
});

export async function loadLocalState() {
  const database = await db();
  const [locations, preferences] = await Promise.all([database.getAll("locations"), database.get("settings", "preferences")]);
  return {
    locations: locations.filter((location) => pointSchema.safeParse(location.point).success),
    preferences: preferences && Number.isInteger(preferences.minutes) && preferences.minutes >= 30 && preferences.minutes <= 360 ? preferences : null,
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
