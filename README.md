# Lluvia

Aplicación web móvil para decidir si llevar paraguas o impermeable y cuándo salir en motocicleta según la lluvia prevista durante el recorrido.

**Prioridad: disponer pronto de una aplicación instalable y útil a diario. El benchmark meteorológico se realiza en paralelo y no bloquea su desarrollo ni publicación.**

## Estado del repositorio

**A1 aceptada y desplegada en Vercel (22 de septiembre de 2026):** la app consulta Open-Meteo desde `/api/weather`, conserva los intervalos horarios y ofrece ubicación guardada, entrada manual, geolocalización, recomendación prudente, detalle horario y PWA con lectura de la última consulta sin conexión. Pasan lint, tipos, 10 pruebas y build. El despliegue de producción [lluvia-steel.vercel.app](https://lluvia-steel.vercel.app/) figura `READY` en Vercel y corresponde al commit `028a972` de `main`. Tras reautorizar la conexión, se verificaron `GET /`, manifest, service worker e iconos con `200`, y consultas reales de `/api/weather` de 30, 60 y 180 minutos con datos normalizados y cobertura `ok`; no aparecieron errores de runtime en la consulta de Vercel. El usuario verificó en un teléfono la consulta vigente y la reapertura desde la app instalada sin Wi-Fi ni datos móviles: el pronóstico guardado permaneció visible, fechado y sin recomendación actual. La cuadrícula devuelta para las coordenadas iniciales está a unos 8,2 km del punto solicitado. Se añadió localmente una indicación de esa distancia, aún sin desplegar. La precisión meteorológica local sigue sin validar.

## Contexto y necesidades

- Zona inicial: **San Rafael, Tlalmanalco, Estado de México, México**.
- Ubicación habitual aproximada: **19.213346433905848, -98.75547014144284**.
- Zona horaria de presentación: `America/Mexico_City`; fechas internas en UTC.
- Terreno montañoso: la representatividad de las celdas meteorológicas, elevación, observaciones y cobertura de radar requiere atención especial.
- Uso cotidiano: consultar probabilidad, inicio, duración e intensidad estimada de lluvia para un periodo elegido.
- Motocicleta: analizar una ruta de aproximadamente 40 minutos en el lugar y momento de paso por cada tramo.
- Comparar salir ahora o esperar 10, 20 o 30 minutos.
- Guardar ubicaciones y rutas frecuentes y recuperarlas rápidamente.
- Experiencia principal en celular mediante web instalable como PWA.

El resultado debe ser breve y explicable. Ejemplos de mensajes, no pronósticos actuales:

> «Probabilidad baja durante la próxima hora; puedes salir sin paraguas».
>
> «Conviene llevar impermeable: se prevé lluvia en la segunda mitad del recorrido».
>
> «Esperar 20 minutos podría reducir la exposición».
>
> «Los datos disponibles no permiten distinguir claramente entre estas horas de salida».

Las recomendaciones comunicarán incertidumbre y se generarán mediante reglas verificables. No se necesita un modelo de lenguaje para redactarlas.

## Plan maestro: dos líneas independientes

| Línea | Objetivo | Plan | Dependencias |
| --- | --- | --- | --- |
| **Track A — Aplicación utilizable** | Entregar una PWA diaria con consulta local, rutas, favoritos y comparación de salidas. | [Desarrollo completo de la aplicación](docs/app-plan.md) | Un proveedor provisional operativo y los servicios requeridos por cada funcionalidad. No depende de terminar Track B. |
| **Track B — Benchmark meteorológico** | Evaluar Open-Meteo, OpenWeather y Weatherbit frente a observaciones reales locales. | [Validación meteorológica](docs/benchmark-plan.md) | Acceso a APIs, archivo de pronósticos y observaciones. Puede ejecutarse sin la interfaz de la app. |

Los [contratos de proveedores](docs/provider-contracts.md) son el acuerdo técnico compartido. Track A consume datos normalizados; Track B evalúa adaptadores sin modificar la experiencia de uso. Compartir contratos no impone una secuencia entre tracks.

**Proveedor provisional de Track A: Open-Meteo.** Permite comenzar el piloto personal sin una clave de pago y obtener información horaria. Esta decisión prioriza disponibilidad inicial; no declara que sea el más preciso ni que proporcione nowcast fiable en San Rafael. `WEATHER_PROVIDER` seleccionará el adaptador en el servidor. El selector inicial de routing será `ROUTING_PROVIDER=tomtom`.

La UI debe funcionar con datos horarios y explicar cuándo no puede estimar inicio exacto o una ventaja por esperar. Los adaptadores OpenWeather y Weatherbit se podrán activar cuando estén disponibles; no es necesario implementarlos todos antes de entregar la app.

## Stack y decisiones

| Área | Recomendación | Motivo y límites | Alternativas / etapa |
| --- | --- | --- | --- |
| Frontend | Next.js App Router + React + TypeScript | Un proyecto para interfaz y API; tipos compartidos. Requiere respetar límites servidor/cliente. | Vite + API separada o SvelteKit. MVP. |
| UI | Tailwind CSS + componentes seleccionados de shadcn/ui, base Radix | Controles accesibles y adaptables; los componentes copiados requieren mantenimiento propio. | CSS Modules. MVP. |
| Mapa | MapLibre GL JS + cartografía TomTom | Capas y tramos coloreados; MapLibre no incluye alojamiento de mapas ni cálculo de rutas. | MapTiler, Mapbox o Leaflet. MVP. |
| Routing | TomTom detrás de `RoutingProvider` | Geometría y tiempos acumulados; validar cobertura y perfil de moto, documentado como beta. | Mapbox Directions u openrouteservice. MVP. |
| Direcciones | TomTom Geocoding y selección manual | Un proveedor geográfico inicial; comprobar calidad y licencia de almacenamiento. | Otros geocodificadores; Places Search si hace falta buscar negocios. MVP. |
| Geolocalización | API del navegador | HTTPS y permiso explícito; alternativa manual si falla o es imprecisa. | SDK nativo si cambia el alcance. MVP. |
| Clima | `WeatherProvider` intercambiable | Open-Meteo provisional; comparar también OpenWeather y Weatherbit. | Selección basada en evidencia posterior. MVP. |
| Backend | Route Handlers de Next.js, runtime Node.js, `fetch` y Zod | Claves privadas, validación de respuestas, límites y evaluación del recorrido. | FastAPI/NestJS solo si surge una necesidad independiente. MVP. |
| Persistencia | IndexedDB mediante `idb` | Favoritos y preferencias locales, sin cuentas; no sincroniza y puede borrarse. Incluir exportación/importación. | PostgreSQL/Supabase para sincronización futura. MVP local. |
| Autenticación | Ninguna en el MVP | Menos fricción; no es necesaria para favoritos en un dispositivo. | Supabase Auth cuando exista sincronización. |
| Instalación | Manifest y service worker pequeño | Una PWA para consulta antes de salir; capacidades e instalación varían por navegador. | Capacitor/React Native si se necesita seguimiento con pantalla apagada. MVP. |
| Visualización | Recharts y capas GeoJSON de MapLibre | Series pequeñas y relación mapa/tiempo; acompañar colores con texto. | SVG simple o ECharts. MVP. |
| Hosting | Vercel | HTTPS y despliegue integrado de Next.js; revisar condiciones y consumo. | Node.js en Render/Railway o Cloudflare con su integración. MVP. |
| Procesamiento periódico | Ninguno para consultas manuales | Actualización bajo demanda y caché explícita. | Alertas futuras con programador y, solo si hace falta, cola. Recolector independiente para Track B. |
| Verificación | Vitest + Playwright | Pruebas de contratos, unidades, tiempo y flujos críticos en móvil. | Las pruebas no demostrarán precisión meteorológica. Durante implementación. |

`package.json` y `package-lock.json` declaran la base técnica; shadcn/ui se integrará copiando solo los componentes necesarios con su CLI. A0 no necesita todavía componentes shadcn/ui, mapas ni gráficas. No existe una dependencia de runtime llamada «shadcn/ui». PWA, routing y meteorología utilizarán APIs web/HTTP, sin SDKs obligatorios ni paquetes de base de datos o autenticación.

## Arquitectura del flujo de datos

```mermaid
flowchart TD
    UI[Web / PWA] <--> LOCAL[IndexedDB: favoritos y preferencias]
    UI --> API[Next.js Route Handlers]
    UI --> MAP[Cartografía TomTom / MapLibre]
    API --> RP[RoutingProvider: TomTom inicial]
    RP --> S[Puntos y tiempos acumulados]
    API --> WP[WeatherProvider seleccionado]
    WP --> N[Normalización y caché con caducidad]
    S --> E[Evaluación por ubicación y hora de paso]
    N --> E
    E --> R[Comparación de salidas y reglas de recomendación]
    R --> UI
```

1. Obtener origen, destino, puntos intermedios y hora de salida.
2. Consultar la geometría real y los tiempos acumulados; no asumir velocidad constante.
3. Muestrear inicialmente cada 3–5 minutos de viaje y ajustar por distancia, relieve y resolución disponible.
4. Asignar a cada punto la hora de salida más su tiempo acumulado.
5. Consultar series que cubran las ubicaciones y las alternativas; reutilizarlas cuando sea válido.
6. Calcular exposición estimada y sensibilidad a cambios en el tiempo de viaje.
7. Mostrar recomendación, mapa, gráfica, probabilidades del proveedor, fuente, antigüedad y limitaciones.

La caché distinguirá proveedor, producto, versión del adaptador, coordenadas, variables y ventana temporal. Su TTL respetará frecuencia de actualización y licencia. La memoria de una función serverless no será almacenamiento compartido garantizado. Redis no es una dependencia inicial.

## Reglas de interpretación meteorológica

- Un intervalo de salida de un minuto no demuestra precisión de un minuto ni de una calle.
- Probabilidad, intensidad y acumulación son variables distintas. Conservar unidades y periodo de validez.
- No sumar probabilidades de tramos ni aplicar `1 - producto(1 - p)` asumiendo independencia: una tormenta puede afectar varios tramos.
- Una categoría propia de exposición no se publicará como porcentaje de «probabilidad de mojarse».
- La probabilidad horaria no se copiará como si fuera probabilidad por minuto.
- La duración de la lluvia en un punto y los minutos de exposición durante un recorrido son resultados distintos.
- Datos ausentes o vencidos nunca significan «no va a llover». Tampoco se anunciará fin de lluvia fuera del horizonte.
- Usar UTC internamente; distinguir intervalos precedentes y siguientes de cada API.
- No reducir diferencias de relieve a una corrección arbitraria por elevación.
- Menor exposición prevista a lluvia no equivale a una ruta segura: pavimento mojado, inundación y viento requieren información adicional.

| Salida para un viaje de 40 minutos | Horizonte mínimo desde la consulta |
| --- | --- |
| Ahora | 40 minutos |
| +10 minutos | 50 minutos |
| +20 minutos | 60 minutos |
| +30 minutos | 70 minutos |

Estos valores no incluyen antigüedad del pronóstico ni retrasos. Un nowcast de 60 minutos no cubre toda la última alternativa. Si se usa información horaria para completar el recorrido, se señalará el cambio de resolución y podrá omitirse la recomendación de espera.

## Proveedores candidatos y limitaciones conocidas

| Proveedor | Datos a evaluar | Condición relevante |
| --- | --- | --- |
| Open-Meteo | Probabilidad, acumulación e intensidad media horarias; `best_match` inicial | Los 15 minutos pueden ser interpolación de horas. No asumir HRRR en San Rafael; comprobar modelo y variable. La probabilidad documentada puede proceder de ensembles de unos 27 km. |
| OpenWeather One Call | Minutos para 60 minutos, series de 15 minutos y horarias según producto | Intensidad minutely no equivale a probabilidad minutely. Validar disponibilidad local y costes por punto/endpoint. |
| Weatherbit | Nowcast de 60 minutos y pronóstico horario | Publica refresco típico de 5–10 minutos y resolución típica próxima a 1 km dependiente del radar; no es una cobertura local comprobada. |

La comparación se hará frente a lluvia observada, no frente al «tiempo actual» del propio proveedor. El diseño completo, métricas y archivo experimental están exclusivamente en [Track B](docs/benchmark-plan.md).

Tomorrow.io queda como alternativa futura si estos candidatos no bastan; su pronóstico minutely requiere acceso premium en Forecast. RainViewer no será el proveedor de pronóstico futuro: retiró ese producto de su API el 1 de enero de 2026.

## MVP y evolución

El MVP incluye consulta local, recomendaciones prudentes, rutas de 40 minutos, comparación de cuatro salidas con estado «sin diferencia evaluable», favoritos, exportación/importación y PWA móvil. Debe gestionar permisos denegados, falta de cobertura, cuotas, fallos y datos antiguos.

Después se podrán añadir sincronización con PostgreSQL/Supabase, autenticación, alertas, radar con licencia adecuada, rutas alternativas, personalización y capacidades nativas. Una promoción de proveedor puede ocurrir antes o después de esas mejoras; no obliga a rehacer la UI, el almacenamiento ni el motor del recorrido.

## Servicios, cuotas y presupuesto

Referencias consultadas el **22 de septiembre de 2026**, sujetas a cambios. No son garantías de gasto ni de disponibilidad.

| Servicio | Referencia | Consecuencia |
| --- | --- | --- |
| Vercel | Hobby personal no comercial; Pro desde 20 USD/mes más consumo aplicable | Prototipo personal potencialmente gratuito; revisar plan al cambiar uso. |
| TomTom | Publica 20.000 consultas/mes gratuitas de rutas y de geocodificación, y 200.000 tiles para productos indicados | Una vista del mapa carga varios tiles. Comprobar producto y condiciones al contratar. |
| Open-Meteo | Acceso gratuito no comercial hasta 10.000 llamadas/día, con otros límites | Adecuado para inicio personal; uso comercial requiere plan/licencia correspondiente. |
| OpenWeather | One Call publica 1.000 llamadas/día gratuitas y exceso facturable | Varios puntos y endpoints multiplican consumo. Configurar límite de gasto. |
| Weatherbit | Trial publicado de 21 días y hasta 1.500 solicitudes/día | Confirmar acceso a hourly/minutely y retención de datos del ensayo; no asumir que el plan gratuito basta. |
| Supabase futuro | Free; Pro desde 25 USD/mes | No necesario para el MVP. |

Ejemplo: 12 puntos por 3 endpoints son 36 llamadas por análisis antes de caché; 100 análisis serían 3.600 llamadas. Comparar salidas puede reutilizar series, pero consultar actualizaciones vuelve a consumir cuota. Los lotes HTTP no garantizan una sola unidad facturable.

Guardar rutas significa conservar intención del usuario: nombre, origen, destino, puntos intermedios y preferencias. Las geometrías y resultados de geocodificación de terceros se almacenarán solo según licencia. Los mapas también requieren atribución. Las claves privadas permanecerán en servidor; una clave pública de cartografía debe restringirse al dominio y servicio permitido.

## Consulta local de A1

- `npm run dev` abre la app; `GET /api/weather?lat=19.213346&lon=-98.755470&minutes=60` devuelve el contrato meteorológico normalizado y el periodo solicitado. Acepta 30–360 minutos; la pantalla ofrece 1, 3 y 6 horas o una duración personalizada hasta el fin de exposición. `WEATHER_PROVIDER=open-meteo` es la selección inicial.
- El adaptador usa el pronóstico horario automático `best_match`, `timezone=UTC`, probabilidad de más de 0.1 mm en la hora precedente y acumulación de esa hora. La tasa `mm/h` es la media derivada de la acumulación horaria. No se conocen la hora de emisión, el modelo efectivo por variable ni la resolución espacial de la respuesta; la app lo comunica. [Definición oficial de variables horarias](https://open-meteo.com/en/docs#hourly_parameter_definition).
- IndexedDB `lluvia-local`, versión 1, guarda ubicaciones, preferencia de periodo y último pronóstico por ubicación/periodo. Una consulta anterior se muestra fechada y nunca da una recomendación actual. El límite de vigencia usado por A1 es de 20 minutos; el navegador consulta la red para actualizar. La geolocalización requiere un gesto explícito y se rechaza si declara precisión peor que ±500 m.
- El manifest, iconos PNG y `public/sw.js` permiten la instalación. El service worker guarda la interfaz y recursos estáticos, pero excluye `/api/`. En iPhone se usa **Compartir → Añadir a pantalla de inicio**. La instalación y reapertura sin conexión se comprobaron en el teléfono del usuario para aceptar A1.
- Variables opcionales: `OPEN_METEO_API_KEY` y `OPEN_METEO_BASE_URL`. El endpoint solo admite HTTPS y los hosts `api.open-meteo.com` o `customer-api.open-meteo.com` con ruta `/v1/forecast`; la clave permanece en el servidor. El uso comercial requiere el endpoint y la licencia que correspondan.

### Validación de A1 y seguimientos

1. **Comprobado en producción:** la API devolvió datos horarios reales para San Rafael con `status: ok`, `Cache-Control: no-store` y sin claves en el JSON normalizado; esto confirma cobertura técnica, no precisión local. El proyecto Vercel es `minnicas-projects/lluvia` (`prj_zwc1D30xrA4xkxGGQA3BkKmcbC7E`); el despliegue verificado es `dpl_73WbB2Pmyxck28bS2xnqFJ3HiDfc` del commit `028a972`.
2. **Comprobado por el usuario en Android:** tras una consulta en línea, cerró la app, apagó Wi-Fi y datos móviles y la reabrió desde el icono. Las capturas muestran la consulta inicial con recomendación y, después, «Pronóstico anterior, sin recomendación actual», con fecha de consulta y detalle horario aún visible. Esto satisface la aceptación móvil de A1; las capturas fueron compartidas en la conversación y no se guardan en el repositorio.
3. **Seguimientos:** repetir `npm ci` con acceso estable al registro; desplegar la mejora local que muestra la distancia a la cuadrícula; revisar en teléfono la alternativa de coordenadas manuales tras denegar geolocalización y la persistencia de ubicaciones guardadas. Estas comprobaciones adicionales pueden realizarse durante A2/A4.

## Preparación técnica

- Entorno previsto: Node.js 22.13+ de la rama 22 o Node.js 24, npm 10+.
- `package-lock.json` fija las dependencias. En este entorno, npm 10.9.8 falló internamente al resolver peers; se generó el lockfile en un directorio limpio con `--legacy-peer-deps` y se comprobó la compatibilidad de peers por separado con `pnpm install --strict-peer-dependencies --frozen-lockfile`. La red impidió completar una instalación limpia con `npm ci`; repetirla en un entorno con acceso estable al registro.
- `npm run dev` arranca, y `npm run lint`, `npm run typecheck`, `npm test` (10 casos) y `npm run build` pasan con dependencias locales. Build usa `next build --webpack`: Turbopack falló en este sandbox al intentar abrir un puerto interno para procesar CSS; la opción Webpack de Next 16 compiló correctamente. `npm ci --offline` no terminó porque falta `picomatch` en caché; repetir con red. El sandbox impide abrir sockets locales, por lo que la automatización de navegador sigue pendiente; la prueba manual en Android sí se completó.
- Los contratos y factorías están en `src/domain` y `src/server/providers`; el adaptador Open-Meteo está en `src/server/providers/weather/open-meteo.ts`. Los fixtures de prueba son sintéticos y nunca se presentan como pronóstico real.
- Siguiente trabajo funcional: [A2 — recorridos y favoritos](docs/app-plan.md#a2--recorridos-y-favoritos); desplegar la mejora local de distancia cuando corresponda al próximo despliegue.

Las variables y contratos previstos se describen en [Track A](docs/app-plan.md) y [contratos compartidos](docs/provider-contracts.md). La ruta habitual y el tipo de observación local del benchmark siguen pendientes; no impiden comenzar la consulta local ni un editor genérico de rutas.

## Fuentes

- [Next.js: instalación](https://nextjs.org/docs/app/getting-started/installation), [PWA](https://nextjs.org/docs/app/guides/progressive-web-apps) y [shadcn/ui](https://ui.shadcn.com/docs/installation/manual).
- [MapLibre](https://maplibre.org/maplibre-gl-js/docs/), [TomTom Routing](https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/calculate-route) y [precios TomTom](https://docs.tomtom.com/pricing).
- [Open-Meteo: variables](https://open-meteo.com/en/docs), [GFS/HRRR](https://open-meteo.com/en/docs/gfs-api) y [planes](https://open-meteo.com/en/pricing).
- [OpenWeather One Call](https://openweathermap.org/api/one-call-4) y [precios](https://openweathermap.org/price).
- [Weatherbit Minutely](https://www.weatherbit.io/api/weather-forecast-minutely), [Hourly](https://www.weatherbit.io/api/weather-forecast-hourly) y [planes/retención](https://www.weatherbit.io/pricing).
- [Tomorrow.io Forecast](https://docs.tomorrow.io/reference/weather-forecast) y [cambios de RainViewer](https://www.rainviewer.com/api/transition-faq.html).
- [Vercel](https://vercel.com/pricing), [Hobby](https://vercel.com/docs/plans/hobby), [Supabase](https://supabase.com/pricing).
- [SMN SIVEA](https://smn.conagua.gob.mx/tools/PHP/sivea_v3/div.php), [NOAA: radar y relieve](https://inside.nssl.noaa.gov/nsslnews/2009/09/nssls-mobile-radar-collects-data-on-summer-storms-in-the-colorado-mountains/).
- [Geolocalización](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API), [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API), [licencias de geocodificación: ejemplo Mapbox](https://docs.mapbox.com/api/search/geocoding/).
