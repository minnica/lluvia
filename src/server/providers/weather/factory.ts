import "server-only";
import { weatherIdSchema } from "@/domain/weather/contracts";
import type { WeatherId, WeatherProvider } from "@/domain/weather/contracts";

export type WeatherProviderRegistry = Partial<Record<WeatherId, () => WeatherProvider>>;

export function createWeatherProvider(
  registry: WeatherProviderRegistry,
  selection: string | undefined = process.env.WEATHER_PROVIDER,
): WeatherProvider {
  const id = weatherIdSchema.parse(selection || "open-meteo");
  const create = registry[id];
  if (!create) throw new Error(`Adaptador meteorológico no registrado: ${id}`);
  const provider = create();
  if (provider.id !== id) throw new Error(`El adaptador meteorológico no coincide con ${id}`);
  return provider;
}

