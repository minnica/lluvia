# Operación del MVP (A4)

Estado al 22 de septiembre de 2026: endurecimiento A4 implementado en la copia local. La aceptación móvil de A2–A4 y la publicación de A4 siguen pendientes. En Vercel, el proyecto `minnicas-projects/lluvia` (`prj_zwc1D30xrA4xkxGGQA3BkKmcbC7E`) solo tiene registradas `WEATHER_PROVIDER` y `ROUTING_PROVIDER`; no se encontraron claves TomTom. La producción actual es `dpl_9AiLJZTMJZvEVk73nKjm1sxd77WJ` (`READY`, commit `9ae1bd0`, A3); no contiene A4.

El intento de publicar A4 mediante la conexión de Vercel fue rechazado por la revisión automática: la herramienta exige aprobación y la política de esta sesión no permite concederla. No se creó un despliegue A4. El servidor local tampoco pudo iniciarse (`listen EPERM`), por lo que la revisión visual y la prueba móvil siguen pendientes. Los controles locales sí pasan: lint, tipos, 20 pruebas y build Webpack.

## Configuración

1. Usar Node.js 22.13+ o 24 y npm 10+. Instalar con `npm ci` cuando el registro esté disponible. Ejecutar `npm run lint`, `npm run typecheck`, `npm test` y `npm run build` **en secuencia**; el build regenera `.next/types` y puede interferir con un `tsc` simultáneo.
2. Configurar `WEATHER_PROVIDER=open-meteo` y `ROUTING_PROVIDER=tomtom`. `OPEN_METEO_API_KEY` y `OPEN_METEO_BASE_URL` son opcionales según licencia. El endpoint Open-Meteo solo admite los dos hosts permitidos y `/v1/forecast` bajo HTTPS.
3. Configurar `TOMTOM_API_KEY` como secreto de servidor para Routing y Geocoding. Configurar `NEXT_PUBLIC_TOMTOM_MAP_KEY` como clave separada para Map Display; es visible en el navegador y debe restringirse a los dominios de producción/preview que se usen y al producto de teselas. Revisar licencias y presupuestos en las cuentas de TomTom y Open-Meteo antes de activar rutas públicas. No introducir secretos en el repositorio ni en logs.
4. Establecer límites de gasto/cuota del proveedor y protección por tasa en el borde de Vercel si el proyecto se expone a terceros. El guardia en memoria de la función solo frena ráfagas en **una instancia** y no garantiza un límite global ni un techo de gasto. No activar persistencia de coordenadas obtenidas de geocodificación sin confirmar licencia; los favoritos actuales requieren confirmación manual y conservan la intención del usuario.

## Límites de la aplicación

| Flujo | Límite y respuesta |
| --- | --- |
| Consulta local | 30–360 minutos, una ubicación, 10 s; hasta 20 solicitudes/min por cliente e instancia. |
| Routing individual | Hasta cuatro paradas, cuerpo JSON de 16 KB, 15 s; hasta 12 solicitudes/min por cliente e instancia. |
| Comparación | Cuatro salidas, cada ruta hasta 4 h, 24 tramos por ruta, máximo 64 ubicaciones meteorológicas distintas entre todas; 30 s y hasta 4 solicitudes/min por cliente e instancia. Superar el tope da `422` con explicación. |
| Geocodificación | 3–100 caracteres, cinco resultados de México, 8 s; hasta 20 solicitudes/min por cliente e instancia. |

El guardia de ráfagas usa un hash salado por proceso de la dirección indicada por el proxy, lo retiene hasta un minuto y devuelve `429` con `Retry-After`. Una dirección no verificada o varias instancias reducen su eficacia; no sustituye los controles del proveedor y de Vercel. Las cuatro rutas pueden implicar hasta cuatro llamadas a Routing y 64 a Open-Meteo antes de aciertos de caché. La consulta meteorológica mantiene concurrencia máxima de cuatro puntos y deduplica coordenadas repetidas dentro de la comparación.

Open-Meteo usa la caché persistente de `fetch` de Next.js con `revalidate: 300` segundos para el producto horario. La clave incluye endpoint, coordenadas, variables, ventana de Forecast y credencial del servidor en la solicitud interna; el JSON público no expone esa clave. Solo respuestas HTTP `200` entran en esa caché. Routing con tráfico y Geocoding mantienen TTL cero (`no-store`) para evitar una ruta vencida y archivar resultados de búsqueda sin licencia confirmada. El adaptador meteorológico usa la cabecera HTTP `Date` como hora de recuperación cuando está disponible. El navegador recibe siempre `Cache-Control: no-store` en `/api/` y su copia en IndexedDB se considera anterior al fallar una actualización. La evaluación exige datos de menos de 20 minutos. El service worker `lluvia-shell-v4` solo guarda la interfaz y recursos estáticos; nunca respuestas de API. IndexedDB permanece en esquema v2 y la migración desde v1 ocurre al abrirlo.

Los Route Handlers escriben eventos `lluvia.api` con nombre de flujo, duración, resultado, código de error y cota de llamadas potenciales. `maxProviderCalls` es una cota antes de aciertos de caché, **no** consumo facturado. Los eventos no incluyen coordenadas, búsquedas, URL externas, IP ni claves. Para investigar un fallo, filtrar por `event`, `name`, `outcome` y `code`; los errores `quota`, `timeout`, `configuration` y `invalid-response` se muestran con estados comprensibles. Verificar las cuotas efectivas y facturación en los paneles de los proveedores.

## Aceptación pendiente

1. Con claves y licencias configuradas, comprobar por HTTPS una ruta real de unos 40 minutos con parada en San Rafael: mapa, perfil efectivo, horas de paso, cuatro salidas y cobertura. Probar cuota agotada y ausencia de clave sin afectar la consulta local.
2. En el teléfono objetivo, probar permisos de ubicación denegados y coordenadas manuales; crear, abrir y borrar un favorito; exportar/importar JSON; comparar alternativas mediante mapa y lista; usar teclado o lector de pantalla para controles y textos alternativos al color.
3. Instalar y abrir con conexión, actualizar la PWA, cerrar y reabrir sin red. Confirmar que IndexedDB v1 migra a v2 sin perder ubicaciones y que un pronóstico anterior aparece fechado y sin recomendación actual.
4. Publicar la versión validada y verificar por HTTPS `/`, `/routes`, manifest, `sw.js`, iconos, `/api/weather` y `/api/route-weather`. Consultar errores de runtime, latencia y cuotas. Registrar ID del despliegue y commit en este documento.

La precisión meteorológica local sigue sin validar y no forma parte de esta aceptación operativa.
