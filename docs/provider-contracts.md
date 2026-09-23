# Contratos compartidos de proveedores

Estado: tipos y validadores Zod de A0 implementados en `src/domain/provider-common.ts`, `src/domain/weather/contracts.ts` y `src/domain/routing/contracts.ts`; factorías de servidor en `src/server/providers`. A1 añadió el adaptador HTTP Open-Meteo; la API de producción devolvió respuestas reales normalizadas para San Rafael con periodos de 30, 60 y 180 minutos y estado `ok`, lo que confirma cobertura técnica, no precisión meteorológica local. A2 añadió el adaptador TomTom y evaluación por tramo; A3 añadió la comparación de cuatro salidas y reutilización de series meteorológicas. A5 añadió localmente Weatherbit Hourly como adaptador alternativo; solo tiene pruebas sintéticas. Las pruebas de A2/A3 también son sintéticas; falta comprobar respuestas TomTom reales. Las interfaces siguen compartidas con el futuro recolector independiente. No se añadió framework de plugins ni microservicios.

## Principios

1. El dominio consume estructuras propias; solo los adaptadores conocen el JSON de cada API.
2. Las capacidades dependen de coordenadas, producto y plan. Diferenciar capacidad anunciada de disponibilidad comprobada en la respuesta.
3. Conservar resolución, procedencia y limitaciones por variable: intensidad y probabilidad pueden venir de modelos diferentes.
4. Ausencia, cero y dato vencido son estados distintos. Un valor desconocido usa `null`, no un cero inventado.
5. Las conversiones de unidades son explícitas. Remuestrear no incrementa la información original.
6. Los datos crudos y credenciales nunca se devuelven al navegador. El archivo experimental autorizado se realiza mediante un capturador independiente.

## WeatherProvider

Contrato implementado como base; se ajustará con pruebas de respuestas reales sin introducir dependencias de la UI:

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

Zod valida coordenadas, rangos, unidades compatibles con la variable, periodos UTC y su relación con `temporalMeaning`. `validAt` se usa para instantes; las demás clases requieren `validPeriod`. Un `issuedAt: null` exige la marca `unknown-issue-time`. `validateWeatherResponse` también verifica que cada punto solicitado tenga una respuesta correspondiente. Los futuros adaptadores convertirán intervalos precedentes/siguientes a límites explícitos; cuando esa semántica no se pueda resolver, el dato no participará en cálculos temporales precisos.

Las excepciones globales se traducen a `ProviderError`; fallos de una ubicación no eliminan las respuestas válidas del lote. A1 impone timeout de 10 s a la consulta local. A2 limita a cuatro las consultas concurrentes de Open-Meteo por ruta y a 30 s la solicitud coordinada. A3 reutiliza los puntos repetidos de las cuatro rutas en un único lote por decisión. A4 añade tope de 64 puntos meteorológicos distintos por comparación, caché de servidor de 300 s para Forecast horario mediante `fetch` de Next.js y guardias de ráfagas por instancia. Estos guardias no sustituyen límites globales ni cuotas/gasto del proveedor; una llamada por lotes puede consumir varias unidades de cuota. [Detalle operativo](operations.md).

### Adaptador Open-Meteo de A1

`OpenMeteoProvider` usa el endpoint Forecast, selección automática `best_match`, zona UTC, unidades mm y series horarias `precipitation_probability`/`precipitation`. La hora publicada cierra el intervalo precedente `[H−1 h, H)` para ambas variables. La probabilidad se normaliza de 0–100 % a 0–1 y el evento es más de 0.1 mm en esa hora. `precipitation` es acumulación `mm`; `precipitationRate` se deriva como media de la misma hora en `mm/h`. No se interpola a minutos. El `resolvedPoint` procede de la cuadrícula devuelta. `model`, `issuedAt`, `nativeStepMinutes` y `spatialResolutionM` quedan `null` cuando la respuesta no los informa, con las marcas de calidad correspondientes. [Semántica oficial de las variables](https://open-meteo.com/en/docs#hourly_parameter_definition).

El adaptador valida estructura, unidades, longitud de series y orden temporal. En lotes, conserva resultados de puntos válidos si falla otro punto; la UI de A1 solicita uno solo. `GET /api/weather` expone el contrato normalizado y limita a 30–360 minutos. Tiene timeout de 10 s y `Cache-Control: no-store`; el navegador conserva la última respuesta en IndexedDB, nunca como vigente sin comprobar los 20 minutos de vigencia. La evaluación local exige cobertura continua y valores no nulos de probabilidad y acumulación. El origen `model` indica pronóstico, no una verificación de precisión.

En la comprobación real de A1, la API resolvió el punto inicial `19.213346, -98.755470` a una cuadrícula en torno a `19.156414, -98.804350`, aproximadamente **8,2 km** de distancia. La respuesta informó probabilidad y precipitación horarias con `outputStepMinutes: 60`; no informó la resolución espacial ni la hora de emisión. La interfaz muestra la distancia para hacer visible el límite geográfico; se incluyó en la publicación de A3.

No añadir métodos como `willRain()` que oculten umbrales o incertidumbre. La estimación de inicio, la comparación de salidas y las recomendaciones pertenecen al dominio. Si faltan minutos, se conserva el dato horario y se publica la limitación.

### Adaptador Weatherbit Hourly de A5

`WeatherbitProvider` consulta `https://api.weatherbit.io/v2.0/forecast/hourly` con `units=M`, entre 12 y 48 horas solicitadas según el horizonte y `WEATHERBIT_API_KEY` solo en servidor. Convierte `pop` de porcentaje a 0–1 y `precip` a acumulación `mm` y media `mm/h` de una hora; un campo ausente queda `null`. La respuesta conserva la coordenada resuelta, el nombre `forecast-hourly`, paso de salida de 60 minutos y `issuedAt`, modelo, paso nativo y resolución espacial desconocidos. El umbral del evento de `pop` no está publicado en la documentación consultada, así que se marca `thresholdMm: null`, `comparison: unknown`. No se mezclan porcentajes de eventos posiblemente distintos con Open-Meteo.

El adaptador asigna `timestamp_utc` a la hora precedente `[H−1 h, H)` según el [ejemplo explícito de Weatherbit sobre acumulaciones](https://help.weatherbit.io/faq/when-is-data-valid-and-how-are-accumulated-values-computed/). La [página del endpoint horario](https://www.weatherbit.io/api/weather-forecast-hourly) también contiene un resumen que habla del intervalo siguiente; hay que contrastar esta discrepancia con una respuesta real o soporte antes de promover Weatherbit. La probabilidad se muestra como horaria con umbral desconocido; su alineación exacta con `precip` requiere la misma comprobación. Los huecos, valores nulos y errores por punto generan cobertura parcial o indisponible. `403`/`401`, `429` y timeout se convierten a errores saneados. La caché de servidor dura 300 s y las respuestas públicas mantienen `no-store`. No existe prueba de acceso ni licencia real en este entorno.

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

**Implementación A2 local:** `TomTomRoutingProvider` solicita Routing v1 con `extendedRouteRepresentation=distance` y `travelTime`, conserva los puntos intermedios y valida el progreso. Si TomTom omite tiempos de vértices, se interpolan únicamente entre dos puntos de progreso conocidos usando longitud de la polilínea; esto se advierte en la ruta. `effectiveProfile` procede de secciones `TRAVEL_MODE`: si faltan, es `unknown`, no se presupone moto. El perfil de motocicleta figura beta en la [documentación de TomTom](https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/calculate-route). La respuesta normalizada y los errores quedan detrás de `/api/routes`. Las pruebas de contrato usan datos sintéticos; falta contrastar una respuesta real local con credenciales.

## Evaluación y cambio de proveedor

La evaluación de A2 devuelve tramos con intervalo de paso, valores horarios originales etiquetados, señal de exposición, cobertura espacio-temporal y estado `limited` o `insufficient-data`. A3 añade `comparison` a `/api/route-weather`: cuatro alternativas con ruta propia, evaluación, sensibilidad de paso ±5/10 minutos, cambios de geometría/tiempos y error de routing individual; estado global `insufficient-data`, `limited` o `comparable`, horizonte requerido y motivo. El estado `comparable` exige cobertura completa en todos los escenarios, mismo producto/modelo/origen y resolución nativa y de salida conocida de hasta 15 minutos; Open-Meteo horario queda `limited` y no produce mejor salida. El resultado no contiene una probabilidad agregada inventada. La confianza en los datos no es `1 - probabilidad de lluvia`.

- Factoría del servidor seleccionada por `WEATHER_PROVIDER` y `ROUTING_PROVIDER`; ningún condicional del proveedor dentro de componentes visuales.
- Configuración inicial: `open-meteo` y `tomtom`. Las claves de adaptadores no seleccionados son opcionales.
- Todos los adaptadores comparten fixtures de contratos y casos de unidades, intervalos, datos parciales y errores.
- Un adaptador alternativo puede incorporarse y activarse sin migrar IndexedDB ni cambiar endpoints de la aplicación.
- Las claves de caché HTTP incluyen endpoint/producto y parámetros; cambiar proveedor no reutiliza resultados anteriores como actuales. La versión del adaptador se informa en la respuesta normalizada.
- Mostrar la fuente efectiva y su resolución. No mezclar proveedores silenciosamente ni promediar sus porcentajes.
- En un cambio: verificar contrato, cobertura básica del uso previsto, cuotas y respuesta real; cambiar configuración; comprobar flujo crítico y conservar posibilidad de revertir.
- No es necesario declarar un proveedor definitivo para operar. Una futura calibración local sí requiere evidencia del producto específico al que se aplique.

## Persistencia independiente del proveedor

Un favorito conserva ID propio, nombre elegido, puntos introducidos por el usuario, preferencias de ruta, fechas y versión de esquema. Los IDs externos son referencias opcionales con su procedencia, no claves primarias del dominio. Las coordenadas o geometrías obtenidas de servicios de terceros solo se conservan según licencia; los datos introducidos por GPS/selección del usuario se distinguen de resultados licenciados.

Separar `savedRoute` de `routeSnapshot` y `forecastSnapshot`. Los últimos dos llevan fuente, antigüedad y caducidad; la PWA no los presenta como vigentes sin una actualización válida.

En A2 se implementó solo `savedRoute` persistente en IndexedDB v2; el resultado de ruta y el pronóstico por tramo viven en memoria durante la sesión y se recalculan al abrir. La exportación `lluvia-routes` v1 incluye coordenadas y preferencias introducidas o confirmadas por el usuario. Una búsqueda geocodificada no se puede guardar directamente como favorito hasta confirmar el punto sobre el mapa o ajustar sus coordenadas manualmente. No se archivan etiquetas, IDs, polilíneas ni respuestas crudas de TomTom. Falta verificar la licencia aplicable antes de considerar persistir directamente coordenadas derivadas de búsqueda.
