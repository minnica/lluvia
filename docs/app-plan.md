# Track A — Aplicación utilizable

Estado: **A0 implementada y verificada localmente**; A1–A5 pendientes. Contexto general en [README](../README.md); acuerdo técnico en [contratos de proveedores](provider-contracts.md).

## Objetivo y regla de independencia

Entregar cuanto antes una PWA que se pueda instalar y consultar diariamente en San Rafael, Tlalmanalco. El primer incremento debe dar información local real; el MVP completo añade rutas y comparación de salidas.

**La publicación y el desarrollo no dependen de que termine el benchmark meteorológico.** Un proveedor operativo, normalización correcta y comunicación honesta de sus límites bastan para avanzar. Track A no requiere recolectores, sensores, episodios de lluvia, informes comparativos ni los tres adaptadores implementados.

La calidad meteorológica local se considera todavía no validada. Eso condiciona los mensajes, no bloquea la interfaz ni los flujos. El estado «datos insuficientes para recomendar una espera» es un resultado válido y visible.

## Decisiones iniciales

- Next.js App Router, React, TypeScript, Tailwind y shadcn/ui con base Radix.
- MapLibre, cartografía y routing inicial de TomTom.
- **Open-Meteo provisional**, configuración `WEATHER_PROVIDER=open-meteo`; no se presenta como ganador ni definitivo.
- IndexedDB mediante `idb`, sin registro ni base de datos de servidor.
- Route Handlers Node.js para APIs, Zod para entradas y respuestas externas, `fetch` para proveedores.
- Recharts para gráficas y API de geolocalización del navegador.
- PWA con manifest y service worker pequeño, sin plugin PWA obligatorio.
- Vercel para el primer despliegue; secretos y límites configurados en el entorno correspondiente.
- Actualización bajo demanda; ninguna tarea programada para usar manualmente la app.

La funcionalidad con Open-Meteo se adapta a información horaria cuando sea la resolución efectiva. No se inventan minutos de inicio ni mejoras al esperar diez minutos mediante interpolación. Un adaptador minutely puede añadirse más adelante por disponibilidad técnica, sin esperar un informe final de precisión.

## Recorridos de usuario

### Consulta local

1. Abrir la app instalada o la web.
2. Elegir ubicación guardada, usar geolocalización o seleccionar manualmente.
3. Elegir próxima hora, próximas tres horas o fin de exposición.
4. Leer recomendación, probabilidad con intervalo, intensidad y ventanas de lluvia disponibles.
5. Consultar detalle y actualizar cuando los datos estén vencidos.

La ubicación inicial sugerida es San Rafael: `19.213346433905848, -98.75547014144284`. El usuario puede cambiarla. La geolocalización se solicita tras una acción explícita; una denegación no bloquea el flujo.

### Consulta de ruta

1. Abrir un favorito o introducir origen, destino y puntos intermedios.
2. Confirmar geometría y modo de transporte, incluidos límites del perfil de motocicleta.
3. Consultar cómo se prevé la lluvia en cada tramo a la hora de paso.
4. Comparar ahora, +10, +20 y +30 minutos.
5. Guardar la intención del recorrido para reutilizarla y recalcular tiempos/clima después.

La app se usa para decidir antes de salir. Navegación giro a giro y seguimiento continuo con pantalla apagada son evoluciones posteriores.

## Entregas y dependencias

| Fase | Entrega | Dependencia real | Criterio de salida |
| --- | --- | --- | --- |
| A0 ✅ | Base ejecutable y contratos | Entorno Node/npm y acceso a dependencias | Desarrollo/build funcionan; contratos validados con fixtures. Falta repetir `npm ci` con acceso al registro. |
| A1 | Primera PWA instalable con consulta local real | A0 y acceso Open-Meteo | Se instala en un teléfono y resuelve una consulta real con límites visibles. |
| A2 | Rutas y favoritos | A1 y credenciales/licencias geográficas | Se guarda y consulta un recorrido con horas de paso. |
| A3 | Comparación de salidas | A2 | Cuatro alternativas evaluadas o marcadas como insuficientes, sin precisión inventada. |
| A4 | MVP diario estabilizado | A1–A3 y comprobación funcional | Flujos críticos, errores, offline y consumo revisados; versión utilizable publicada. |
| A5 | Evoluciones y sustitución de proveedor | Necesidad concreta y adaptador/configuración disponibles | Cambio reversible con mismo contrato y sin migrar favoritos. |

Ruta crítica: **A0 → A1 → A2 → A3 → A4**. La PWA de A1 se entrega antes del MVP completo. No hay una dependencia de finalización del benchmark en esta secuencia.

## A0 — Base ejecutable

**Estado al 22 de septiembre de 2026:** implementada. `src/app` contiene la página y estilos en español; `src/domain` contiene los esquemas Zod y conversiones básicas; `src/server/providers` contiene factorías sin adaptadores registrados; `tests/fixtures` contiene solo datos sintéticos. TypeScript estricto, ESLint flat, Tailwind/PostCSS, alias `@/*`, `.env.example` y `package-lock.json` están preparados. No se añadieron componentes shadcn/ui porque esta pantalla no los necesita. Mapas y gráficas se incorporarán bajo demanda cuando existan sus flujos.

Pasaron `npm run lint`, `npm run typecheck`, `npm test` (5 casos) y `npm run build`; `npm run dev` inició correctamente. El socket local no fue accesible desde el sandbox para una prueba HTTP. La instalación limpia con `npm ci` sigue sin verificarse por acceso intermitente al registro; npm 10.9.8 también presentó un fallo interno de resolución de peers. El lockfile se generó sin `--force` y los peers se comprobaron por separado con pnpm estricto. Repetir `npm ci` en un entorno con red estable al comenzar A1.

- Instalar/resolver las dependencias de `package.json`; comprobar peer dependencies y versiones publicadas. Generar y versionar `package-lock.json`, sin desactivar comprobaciones mediante `--force`.
- Crear TypeScript estricto, ESLint flat config, Tailwind/PostCSS y alias `@/*`.
- Crear `src/app/layout.tsx`, página inicial y estilos con idioma español.
- Incorporar solo los componentes shadcn/ui necesarios; cargar mapa y gráficas bajo demanda.
- Implementar los [contratos](provider-contracts.md), sus validadores y factorías de servidor.
- Crear fixtures explícitamente sintéticos para desarrollo. Nunca mostrar fixtures como pronóstico real.
- Separar código de navegador —IndexedDB, mapa y geolocalización— del código con claves privadas.
- Preparar `.gitignore`, `.env.example` sin secretos y scripts de comprobación.

Estructura orientativa futura, no creada aún:

```text
src/
  app/
    api/weather/route.ts
    api/routes/route.ts
    api/route-weather/route.ts
    api/geocode/route.ts
    manifest.ts
  components/
    ui/
    weather/
    routes/
  domain/
    weather/
    routing/
    exposure/
  server/
    providers/weather/
    providers/routing/
    geocoding/
    cache/
  client/
    storage/
    geolocation/
public/
  sw.js
```

No crear todos los endpoints o directorios por anticipado: añadirlos al entregar su funcionalidad. El dominio no importa componentes React ni formatos propios de TomTom/Open-Meteo.

## A1 — Consulta local instalable

- Implementar el adaptador Open-Meteo con `best_match`, probabilidad horaria y precipitación, conservando semántica temporal, unidades y resolución.
- Validar cobertura técnica para las coordenadas iniciales. Una respuesta de API confirma acceso, no precisión meteorológica local.
- Implementar ubicación manual y geolocalización con estados de permiso, error, timeout y precisión insuficiente.
- Crear recomendación principal y detalle de probabilidad por intervalo, acumulación/intensidad media y fuente.
- Mostrar ventana de inicio/final solo si los datos la respaldan; con datos horarios mostrar horas o intervalos amplios.
- Guardar ubicación y preferencias en IndexedDB con esquema versionado.
- Crear manifest, iconos, instalación y service worker para recursos estáticos. El clima usa actualización de red con comprobación de vigencia.
- Desplegar por HTTPS y comprobar instalación/apertura en un teléfono real. En iOS explicar el mecanismo disponible de añadir a inicio.

**Aceptación:** desde el icono instalado se obtiene una consulta real sin cuenta; una respuesta horaria no se convierte en un aviso de inicio al minuto. Sin conexión se puede abrir la interfaz y leer favoritos, con pronóstico previo claramente fechado y sin recomendación actual de salida.

## A2 — Recorridos y favoritos

- Implementar `TomTomRoutingProvider`, geometría y tiempos acumulados. Verificar si el perfil de moto solicitado es efectivo y exponer cualquier aproximación.
- Añadir mapa MapLibre con atribuciones, geocodificación y selección de puntos sobre el mapa.
- Permitir origen, destino, puntos intermedios y preferencias necesarias del recorrido.
- Muestrear inicialmente cada 3–5 minutos de viaje, con ajustes por distancia y curvas/cambios de terreno relevantes. No confundir densidad de muestreo con resolución de la fuente.
- Calcular `horaDePaso = salida + tiempoAcumulado` y consultar series para esos lugares y periodos.
- Colorear tramos con etiquetas; gris o patrón para datos ausentes, nunca un color de bajo riesgo por defecto.
- Mostrar exposición estimada por tramo y una línea temporal sincronizada con el mapa.
- Guardar favoritos independientes de proveedor y recalcular tiempos/clima al abrirlos.
- Añadir exportación/importación JSON versionada, validada y con manejo de duplicados y archivos incorrectos.

**Aceptación:** se puede crear, guardar, reabrir y analizar un recorrido aproximado de 40 minutos. Se consideran puntos intermedios y horas de paso; no solo salida y destino. Si falta la clave de routing, la consulta local de A1 sigue funcionando.

## A3 — Comparación de salida

- Evaluar ahora, +10, +20 y +30 minutos desde un mismo instante de decisión.
- Mantener ruta/preferencias comparables. Si el proveedor cambia ruta o tiempos por la hora de salida, incorporar esa diferencia explícitamente y consultar ubicaciones nuevas.
- Reutilizar series meteorológicas que cubran el periodo necesario; no repetir todas las llamadas por cada alternativa.
- Calcular horizonte requerido con duración, demora, antigüedad y margen de tiempo de viaje.
- Conservar probabilidad por periodo sin fabricar una probabilidad conjunta del trayecto.
- Comparar exposición estimada y sensibilidad a cambios iniciales de ±5–10 minutos en el tiempo de paso. Esos márgenes son escenarios de sensibilidad, no intervalos estadísticos calibrados.
- No afirmar una mejora si solo procede de interpolar datos horarios, una cobertura parcial o un cambio de fuente no comparable.
- Diferenciar «lluvia en este lugar durante X» de «circulación bajo lluvia durante X».
- Cuando no haya evidencia suficiente, mostrar las alternativas y su limitación, sin seleccionar artificialmente una como mejor.

**Aceptación:** el caso de esperar 30 minutos para un viaje de 40 exige al menos 70 minutos de cobertura, más margen. Si no se dispone de ella, la app lo explica. Los resultados sintéticos de prueba incluyen lluvia al inicio, al final, nula, fuera del horizonte y series horarias que no distinguen salidas.

## A4 — MVP diario y operación

- Revisar los recorridos completos en móvil: consulta local, permisos denegados, ruta, guardado, reapertura y comparación.
- Comprobar accesibilidad básica, tamaños táctiles, contraste, navegación por teclado y alternativas textuales a mapa/color.
- Usar caché de servidor explícita con TTL por producto. No suponer persistencia compartida de variables globales serverless.
- Limitar puntos, horizonte y frecuencia por solicitud. Añadir timeout, concurrencia limitada, deduplicación y manejo de cuotas.
- Registrar errores, latencia y consumo sin claves ni historial innecesario de ubicaciones personales.
- Configurar límites de uso/gasto y claves geográficas restringidas. Comprobar licencia para guardar resultados externos.
- Verificar que actualizar el service worker no deje una versión incompatible de IndexedDB ni un pronóstico viejo presentado como nuevo.
- Documentar configuración y operación real, publicar una versión y verificarla por HTTPS.

**Aceptación:** uso diario sin sesión; no hay errores críticos en los flujos esenciales; los fallos meteorológicos o de routing generan estados comprensibles; cada recomendación identifica periodo, fuente y limitaciones. La precisión local sigue siendo provisional si todavía no se ha evaluado.

## API y configuración previstas

Los Route Handlers reciben peticiones del dominio y devuelven estructuras normalizadas, nunca JSON crudo del proveedor. Separar `/api/routes` y `/api/weather` permite que `/api/route-weather` coordine sin acoplar UI a servicios externos. Mantener las claves y la selección del proveedor en servidor.

| Variable | Uso |
| --- | --- |
| `WEATHER_PROVIDER` | `open-meteo` inicialmente. |
| `ROUTING_PROVIDER` | `tomtom` inicialmente. |
| `TOMTOM_API_KEY` | Servidor: routing/geocodificación. Requerida solo al habilitar esos flujos. |
| `NEXT_PUBLIC_TOMTOM_MAP_KEY` | Cartografía de navegador, con restricciones por dominio/servicio. |
| `OPENWEATHER_API_KEY` | Solo necesaria si se activa su adaptador. |
| `WEATHERBIT_API_KEY` | Solo necesaria si se activa su adaptador. |
| `OPEN_METEO_API_KEY` | Opcional para acceso gratuito personal; necesaria si se contrata endpoint correspondiente. |
| `OPEN_METEO_BASE_URL` | Endpoint compatible con la licencia; validar contra una lista permitida del servidor. |

No exponer un selector público que permita consumir arbitrariamente las claves de todos los proveedores. La configuración de despliegue selecciona el proveedor operativo. Errores de un adaptador no seleccionado no bloquean el arranque.

## Pruebas proporcionadas al riesgo

- Unitarias: conversiones mm/mm/h, probabilidad 0..1, alineación UTC, intervalos precedentes, datos ausentes, sensibilidad e insuficiencia de horizonte.
- Contratos: los adaptadores producen la misma estructura y conservan metadatos; fixtures de errores y respuestas parciales.
- Integración: una consulta por proveedor habilitado y cuotas controladas; las pruebas ordinarias no consumen APIs externas.
- E2E: consulta local, selección manual tras denegar permiso, ruta guardada y comparación. Verificación manual de instalación en el teléfono objetivo.
- Ejecutar lint, tipos, pruebas relevantes y build al estar configurados. No publicar mientras esos controles funcionales fallen; el benchmark no es un control de publicación.

## A5 — Cambios posteriores sin rehacer la aplicación

### Sustituir el proveedor meteorológico

1. Disponer de adaptador compatible, licencia y credenciales; implementarlo aquí si todavía no existe.
2. Verificar capacidades del producto y pasar las pruebas de contrato.
3. Activar mediante configuración en preview y comprobar consulta local/ruta.
4. Cambiar configuración operativa e invalidar la caché que corresponda.
5. Mantener rollback al proveedor anterior; favoritos y pantallas no cambian.

Esto puede hacerse por disponibilidad, coste o evidencia suficiente de una función concreta. No requiere que finalice toda la comparación meteorológica. La aplicación puede continuar indefinidamente con un proveedor provisional.

### Funciones que sí necesitan evidencia específica

Calibrar porcentajes locales, anunciar un error de inicio esperado, asignar confianza estadística o promocionar «esperar 20 minutos reduce considerablemente el riesgo» requiere evidencia del producto y contexto al que se aplique. Se posponen esas afirmaciones o ajustes, no la entrega general. Añadir un endpoint minutely solo requiere primero acceso y contrato; sostener afirmaciones de precisión requiere después validación.

### Evoluciones opcionales

- Sincronización con PostgreSQL/Supabase y autenticación cuando aporten valor.
- Avisos programados y Web Push, con persistencia de suscripciones y ejecución en servidor.
- Radar licenciado, rutas alternativas y preferencias personales.
- Navegación/seguimiento nativo si se necesita funcionamiento continuo en segundo plano.

## Definición de terminado del Track A inicial

Una PWA instalada permite consultar lluvia local, guardar y evaluar rutas frecuentes y comparar salidas con datos reales del proveedor provisional. Comunica incertidumbre, fallos y límites del horizonte. Es posible cambiar de proveedor por configuración/adaptador sin modificar arquitectura general ni favoritos. **No se exige haber elegido un proveedor definitivo.**
