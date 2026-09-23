import "server-only";
import type { ProviderError } from "@/domain/weather/contracts";

export class WeatherProviderFailure extends Error {
  constructor(readonly detail: ProviderError) { super(detail.message); }
}
