import "server-only";
import { weatherIdSchema } from "@/domain/weather/contracts";
import type { WeatherId, WeatherProvider } from "@/domain/weather/contracts";
import { OpenMeteoProvider } from "@/server/providers/weather/open-meteo";
import { WeatherbitProvider } from "@/server/providers/weather/weatherbit";
import { WeatherProviderFailure } from "@/server/providers/weather/error";

export type WeatherProviderRegistry = Partial<Record<WeatherId, () => WeatherProvider>>;

export function createWeatherProvider(
  registry: WeatherProviderRegistry,
  selection: string | undefined = process.env.WEATHER_PROVIDER,
): WeatherProvider {
  const parsed = weatherIdSchema.safeParse(selection || "open-meteo");
  if (!parsed.success) throw new WeatherProviderFailure({ code: "configuration", retryable: false, message: "Proveedor meteorológico no admitido" });
  const id = parsed.data;
  const create = registry[id];
  if (!create) throw new WeatherProviderFailure({ code: "configuration", retryable: false, message: `Adaptador meteorológico no registrado: ${id}` });
  const provider = create();
  if (provider.id !== id) throw new Error(`El adaptador meteorológico no coincide con ${id}`);
  return provider;
}

export function operationalWeatherProvider(): WeatherProvider {
  return createWeatherProvider({
    "open-meteo": () => new OpenMeteoProvider(),
    weatherbit: () => new WeatherbitProvider(),
  });
}

export function selectedWeatherId(): WeatherId {
  const parsed = weatherIdSchema.safeParse(process.env.WEATHER_PROVIDER || "open-meteo");
  if (!parsed.success) throw new WeatherProviderFailure({ code: "configuration", retryable: false, message: "Proveedor meteorológico no admitido" });
  return parsed.data;
}
