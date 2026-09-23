# Contratos compartidos de proveedores

Estado: diseño previo a implementación. Estos contratos sirven a la aplicación y al recolector independiente. No requieren que ninguno de los tracks haya terminado. Implementar módulos TypeScript sencillos, sin framework de plugins ni microservicios.

## Principios

1. El dominio consume estructuras propias; solo los adaptadores conocen el JSON de cada API.
2. Las capacidades dependen de coordenadas, producto y plan. Diferenciar capacidad anunciada de disponibilidad comprobada en la respuesta.
3. Conservar resolución, procedencia y limitaciones por variable: intensidad y probabilidad pueden venir de modelos diferentes.
4. Ausencia, cero y dato vencido son estados distintos. Un valor desconocido usa `null`, no un cero inventado.
5. Las conversiones de unidades son explícitas. Remuestrear no incrementa la información original.
6. Los datos crudos y credenciales nunca se devuelven al navegador. El archivo experimental autorizado se realiza mediante un capturador independiente.

## WeatherProvider

Contrato orientativo; se ajustará con pruebas de respuestas reales sin introducir dependencias de la UI:

```ts
type Instant = string; // ISO 8601 UTC, validado en runtime
type Point = { lat: number; lon: number; elevationM?: number };
type Period = { start: Instant; end: Instant }; // [start, end)
type WeatherId = "open-meteo" | "openweather" | "weatherbit";
type Variable = "precipitationProbability" | "precipitationRate" | "precipitationAmount";
type QualityFlag =
  | "interpolated" | "unknown-resolution" | "unknown-issue-time"
  | "stale" | "partial-horizon" | "outside-coverage";

interface ProductCapability {
  product: string;
  variables: Variable[];
  horizonMinutes: number | null;
  outputStepMinutes: number | null;
  nativeStepMinutes: number | null;
  spatialResolutionM: number | null;
  availability: "documented" | "verified" | "unavailable" | "unknown";
}

interface WeatherRequest {
  points: Array<{ id: string; position: Point }>;
  period: Period;
  variables: Variable[];
  products?: string[]; // usados por herramientas de evaluación, no por la UI
  signal?: AbortSignal;
}

interface WeatherValue {
  variable: Variable;
  value: number | null; // probabilidad normalizada 0..1
  unit: "probability" | "mm/h" | "mm";
  validPeriod: Period | null;
  validAt: Instant | null; // para datos instantáneos
  temporalMeaning: "instant" | "period-mean" | "period-total" | "period-probability";
  probabilityEvent: {
    thresholdMm: number | null;
    comparison: "gt" | "gte" | "unknown";
    description: string;
  } | null;
  product: string;
  model: string | null;
  issuedAt: Instant | null;
  retrievedAt: Instant;
  outputStepMinutes: number | null;
  nativeStepMinutes: number | null;
  spatialResolutionM: number | null;
  origin: "model" | "nowcast" | "interpolated" | "unknown";
  flags: QualityFlag[];
}

interface PointForecast {
  pointId: string;
  requestedPoint: Point;
  resolvedPoint: Point | null;
  status: "ok" | "partial" | "unavailable";
  values: WeatherValue[];
  availablePeriods: Array<{ product: string; period: Period }>;
  warnings: string[];
  error: ProviderError | null;
}

interface ProviderError {
  code: "configuration" | "quota" | "timeout" | "unavailable" | "invalid-response";
  retryable: boolean;
  retryAfterSeconds?: number;
  message: string; // saneado, sin claves ni URL con secretos
}

interface WeatherResponse {
  schemaVersion: 1;
  provider: WeatherId;
  adapterVersion: string;
  requestId: string;
  points: PointForecast[];
}

interface WeatherProvider {
  readonly id: WeatherId;
  getCapabilities(point: Point): Promise<ProductCapability[]>;
  getForecast(request: WeatherRequest): Promise<WeatherResponse>;
}
```

Usar Zod para validar coordenadas, rangos, unidades compatibles con la variable y periodos. Al menos uno de `validPeriod`/`validAt` debe ser válido según `temporalMeaning`. Los adaptadores convierten intervalos precedentes/siguientes a límites explícitos; cuando esa semántica no se pueda resolver, el dato no participa en cálculos temporales precisos.

Las excepciones globales se traducen a `ProviderError`; fallos de una ubicación no eliminan las respuestas válidas del lote. El orquestador impone timeout y concurrencia limitada. Una llamada por lotes puede consumir varias unidades de cuota.

No añadir métodos como `willRain()` que oculten umbrales o incertidumbre. La estimación de inicio, la comparación de salidas y las recomendaciones pertenecen al dominio. Si faltan minutos, se conserva el dato horario y se publica la limitación.

## RoutingProvider

```ts
interface RoutingRequest {
  origin: Point;
  destination: Point;
  via: Point[];
  departureAt: Instant;
  profile: "motorcycle" | "car";
  avoid: Array<"tolls" | "motorways" | "unpaved">;
  signal?: AbortSignal;
}

interface RoutePoint {
  position: Point;
  distanceFromStartM: number;
  durationFromStartSeconds: number;
}

interface Route {
  id: string;
  geometry: GeoJSON.LineString; // orden [longitud, latitud]
  progress: RoutePoint[];
  durationSeconds: number;
  distanceM: number;
  requestedDepartureAt: Instant;
  retrievedAt: Instant;
  requestedProfile: "motorcycle" | "car";
  effectiveProfile: "motorcycle" | "car" | "mixed" | "unknown";
  traffic: "live-and-historical" | "historical" | "none" | "unknown";
  warnings: string[];
}

interface RoutingProvider {
  readonly id: string;
  getCapabilities(point: Point): Promise<{
    profiles: Array<"motorcycle" | "car">;
    departureTimeSupported: boolean;
    cumulativeTimesSupported: boolean;
    warnings: string[];
  }>;
  getRoutes(request: RoutingRequest): Promise<{
    schemaVersion: 1;
    provider: string;
    adapterVersion: string;
    routes: Route[];
  }>;
}
```

Validar tiempos/distancias acumulados monótonos y correspondencia con la geometría. No sustituir silenciosamente moto por coche. Si se ofrece una aproximación, mostrarla y conservar `effectiveProfile`. La geocodificación usa un módulo propio; cambiar routing no debe obligar a cambiar los favoritos.

## Evaluación y cambio de proveedor

La evaluación devolverá cada salida con intervalos de paso, valores originales etiquetados, categoría de exposición, cobertura espacio-temporal y estado `comparable`, `limited` o `insufficient-data`. El resultado no contiene una probabilidad agregada inventada. La confianza en los datos no es `1 - probabilidad de lluvia`.

- Factoría del servidor seleccionada por `WEATHER_PROVIDER` y `ROUTING_PROVIDER`; ningún condicional del proveedor dentro de componentes visuales.
- Configuración inicial: `open-meteo` y `tomtom`. Las claves de adaptadores no seleccionados son opcionales.
- Todos los adaptadores comparten fixtures de contratos y casos de unidades, intervalos, datos parciales y errores.
- Un adaptador alternativo puede incorporarse y activarse sin migrar IndexedDB ni cambiar endpoints de la aplicación.
- Las claves de caché incluyen proveedor/producto y versión; cambiar proveedor no reutiliza resultados anteriores como actuales.
- Mostrar la fuente efectiva y su resolución. No mezclar proveedores silenciosamente ni promediar sus porcentajes.
- En un cambio: verificar contrato, cobertura básica del uso previsto, cuotas y respuesta real; cambiar configuración; comprobar flujo crítico y conservar posibilidad de revertir.
- No es necesario declarar un proveedor definitivo para operar. Una futura calibración local sí requiere evidencia del producto específico al que se aplique.

## Persistencia independiente del proveedor

Un favorito conserva ID propio, nombre elegido, puntos introducidos por el usuario, preferencias de ruta, fechas y versión de esquema. Los IDs externos son referencias opcionales con su procedencia, no claves primarias del dominio. Las coordenadas o geometrías obtenidas de servicios de terceros solo se conservan según licencia; los datos introducidos por GPS/selección del usuario se distinguen de resultados licenciados.

Separar `savedRoute` de `routeSnapshot` y `forecastSnapshot`. Los últimos dos llevan fuente, antigüedad y caducidad; la PWA no los presenta como vigentes sin una actualización válida.
