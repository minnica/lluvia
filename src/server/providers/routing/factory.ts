import "server-only";
import type { RoutingProvider } from "@/domain/routing/contracts";

export type RoutingProviderRegistry = Record<string, (() => RoutingProvider) | undefined>;

export function createRoutingProvider(
  registry: RoutingProviderRegistry,
  selection: string | undefined = process.env.ROUTING_PROVIDER,
): RoutingProvider {
  const id = selection || "tomtom";
  const create = registry[id];
  if (!create) throw new Error(`Adaptador de rutas no registrado: ${id}`);
  const provider = create();
  if (provider.id !== id) throw new Error(`El adaptador de rutas no coincide con ${id}`);
  return provider;
}

