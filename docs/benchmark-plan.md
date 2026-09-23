# Track B — Benchmark meteorológico local

Estado: protocolo propuesto, sin capturas ni resultados. Ubicación principal: **19.213346433905848, -98.75547014144284**, San Rafael, Tlalmanalco, Estado de México. Zona horaria de presentación: `America/Mexico_City`; archivo y cálculo en UTC.

## Objetivo y autonomía

Evaluar primero **Open-Meteo** con episodios reales para cuantificar utilidad local en lluvia durante los próximos 60 minutos, probabilidad horaria, inicio, cantidad/intensidad, recorridos de unos 40 minutos y alternativas de salida. **OpenWeather y Weatherbit quedan como comparadores posibles**, no como contrataciones o integraciones activas. El usuario pospuso Weatherbit el 23 de septiembre de 2026; retomarlo requiere evidencia de imprecisiones de Open-Meteo y comprobar que otro producto aporta una mejora.

Este trabajo puede ejecutarse con un recolector local sin interfaz web. Produce evidencia y recomendaciones sobre proveedores; no es requisito para entregar ni utilizar la aplicación. Consume los [contratos compartidos](provider-contracts.md) y puede implementar sus adaptadores de forma independiente. No requiere esperar a que estén listas las pantallas ni los endpoints de la app.

No se presume un ganador. Un resultado válido es que ninguno permita distinguir con confianza esperas de diez minutos en determinados episodios.

## Preguntas de evaluación

1. ¿Anticipa lluvia real durante 0–15, 15–30 y 30–60 minutos sin demasiadas falsas alarmas?
2. ¿Sus probabilidades horarias corresponden a frecuencias observadas compatibles?
3. ¿Con cuánto error anticipa inicio y final de lluvia, y cuántos episodios omite?
4. ¿Subestima o sobreestima acumulación e intensidad media local?
5. ¿Describe la lluvia encontrada a lo largo de un recorrido y a la hora de paso?
6. ¿Recomendar esperar reduce exposición o provoca esperas inútiles/empeoramientos?
7. ¿Qué disponibilidad, antigüedad, cobertura y coste tiene cada producto?

## Alcance geográfico y relieve

- Comenzar en la ubicación habitual, sin extender sus resultados automáticamente a todo Tlalmanalco.
- Elegir una ruta real de aproximadamente 40 minutos; destino y puntos de paso pendientes.
- Registrar elevación y posición de puntos de consulta y de observación cuando sean conocidas, junto con diferencias frente a la celda devuelta.
- Añadir puntos que representen diferentes tramos/entornos del corredor, evitando elegirlos exclusivamente por distancia uniforme.
- No atribuir diferencias a la altura sin evidencia ni aplicar correcciones de precipitación arbitrarias.
- Radar, estaciones cercanas y satélite son referencias auxiliares cuya representatividad debe verificarse.

El relieve puede bloquear haces de radar y limitar su representatividad. Esto justifica verificar observaciones locales, pero no demuestra que un radar concreto tenga un bloqueo en San Rafael. [NOAA: ejemplo documentado en montaña](https://inside.nssl.noaa.gov/nsslnews/2009/09/nssls-mobile-radar-collects-data-on-summer-storms-in-the-colorado-mountains/).

## B0 — Auditoría técnica de acceso y cobertura

Duración orientativa: 1–2 días desde que estén disponibles las credenciales y productos necesarios.

| Proveedor | Productos iniciales | Comprobación |
| --- | --- | --- |
| Open-Meteo | `best_match`, precipitación y probabilidad horarias; intervalos de 15 minutos si están disponibles | Identificar modelo/configuración, semántica de acumulación e interpolación. No asumir HRRR local. |
| OpenWeather | One Call: minutely, hourly y 15 minutos si lo requiere la comparación extendida | Horizonte real, variables, actualización, cuotas por endpoint y datos faltantes. |
| Weatherbit | `/forecast/minutely` y `/forecast/hourly` | Acceso del plan, 60 minutos efectivos, cambios entre consultas y fuente/resolución local si se puede conocer. |

Acciones:

- Consultar las mismas coordenadas y registrar respuestas válidas, vacías, errores, latencia y unidades facturables.
- Separar tiempo de consulta, emisión y validez; `issuedAt` desconocido permanece desconocido.
- Verificar qué porcentaje de la ventana solicitada se devuelve y si existe rezago.
- Comprobar diferencias espaciales sin interpretar respuestas idénticas como un error por sí mismas: pueden compartir celda.
- Confirmar derechos de archivo de pronósticos y duración de conservación, incluidos términos del trial.
- Registrar versión del adaptador y configuración. No cambiar modelos/configuración silenciosamente durante el ensayo.

Entregable: matriz de capacidades documentadas y verificadas. La prueba de acceso no constituye prueba de precisión. Las capacidades desconocidas se declaran; no es necesario resolverlas todas para iniciar las capturas que sí sean válidas.

Weatherbit documenta 60 minutos, refresco típico de 5–10 minutos y resolución típica de aproximadamente 1 km dependiente del radar. Open-Meteo diferencia datos regionales de intervalos interpolados y documenta probabilidades horarias de mayor escala espacial. Se comprobará cada variable por producto. [Weatherbit Minutely](https://www.weatherbit.io/api/weather-forecast-minutely), [Open-Meteo](https://open-meteo.com/en/docs), [cobertura HRRR](https://open-meteo.com/en/docs/gfs-api), [OpenWeather](https://openweathermap.org/api/one-call-4).

## B1 — Observaciones independientes y definiciones previas

### Referencia principal

Preferir un pluviómetro automático fijo con resolución conocida, reloj sincronizado y emplazamiento adecuado. Documentar calibración, obstrucciones, incidencias y resolución mínima. Agregar registros de un minuto a ventanas de 5–10 minutos para intensidad media; la discretización del instrumento puede distorsionar picos de un minuto.

Acompañar con observaciones de primeras gotas, interrupciones y final. El primer vuelco del pluviómetro puede retrasarse respecto a las primeras gotas, especialmente con llovizna.

Si inicialmente solo hay registro manual:

- Evaluar lluvia/seco e inicio/final con precisión temporal declarada.
- Registrar hora observada y hora de anotación por separado.
- Tratar intensidad ligera/moderada/fuerte como apreciación cualitativa.
- No inferir mm/h exactos ni acumulaciones a partir de esas etiquetas.
- Mantener cantidad/intensidad cuantitativa como pendiente, sin detener las demás evaluaciones.

### Referencias auxiliares

Explorar [SMN/CONAGUA SIVEA](https://smn.conagua.gob.mx/tools/PHP/sivea_v3/div.php). Confirmar ubicación, elevación, sensor, frecuencia, latencia, huecos y acceso al archivo antes de considerar una estación representativa. Aún no hay una estación local seleccionada.

No usar el «tiempo actual» o histórico del proveedor evaluado como verdad principal. Un producto histórico rellenado con modelos no equivale a una observación independiente. Un acumulado diario no valida inicio al minuto.

### Definiciones antes de puntuar

- Fijar lluvia medible según resolución del instrumento; registrar umbral y operador exactos.
- Registrar primeras gotas como evento separado de acumulación medible.
- Definir separación entre episodios; propuesta inicial: 30 minutos comprobados sin lluvia, ajustada antes de la evaluación final.
- Especificar inicio/final y tratamiento de episodios que cruzan límites de ventana.
- Conservar definición del evento de probabilidad de cada proveedor. Si no son equivalentes, no presentar sus Brier scores como comparación estricta del mismo evento.
- Los periodos sin observación se marcan desconocidos, no secos; excluirlos de métricas que exijan observación.

## B2 — Captura prospectiva

Duración inicial: 3–6 semanas. Buscar 15–20 episodios independientes y periodos secos suficientes, incluidos casos de falsa alarma. Extender si faltan eventos o variedad. La muestra sirve para selección preliminar, no para una garantía anual ni una calibración fina.

| Captura | Frecuencia inicial | Cobertura |
| --- | --- | --- |
| Nowcast puntual | Cada 10 minutos | Próximos 60 minutos disponibles. |
| Pronóstico horario | Cada 30 minutos | Próximas 6 horas. |
| Corredor de ruta | Cada 10 minutos en ventanas fijadas previamente | Puntos compartidos; horizonte al menos 70 minutos más margen cuando exista. |
| Pluviómetro | Un minuto si el dispositivo lo admite | Agregación a 5, 10, 15 y 60 minutos. |
| Observaciones manuales | Inicio, final, cambios y verificaciones secas | Solo periodos realmente observados. |

Capturar en horarios prefijados aunque los proveedores no anuncien lluvia. No iniciar el registro únicamente cuando llueve o cuando una API dispara una alerta. Mantener el calendario de observación para no sesgar la muestra hacia episodios llamativos.

Consultar proveedores con diferencia temporal pequeña y registrada. Agrupar por un instante de decisión común; una respuesta que llega después de esa decisión no puede utilizarse retrospectivamente. Una emisión repetida no cuenta como información meteorológica nueva.

### Archivo mínimo

Un proceso local Node/TypeScript y archivos JSONL/CSV bastan inicialmente. El programador de tareas requiere un equipo encendido; si se suspende, registrar el hueco. El archivo no depende de IndexedDB, del navegador ni del filesystem efímero de Vercel.

| Archivo/dataset | Contenido |
| --- | --- |
| `requests` | Instantes de envío/recepción, proveedor, producto, configuración, resultado, latencia y cuota. |
| `raw-forecasts` | Respuesta original autorizada, sin claves ni URL con secretos; ID o hash para trazabilidad. |
| `normalized-forecasts` | Esquema común, versión del adaptador y referencia al original. |
| `observations` | Ubicación, instrumento/método, intervalo, valor, resolución y calidad. |
| `episodes` | Inicio/final, contexto, huecos y criterios usados. |
| `route-decisions` | Geometría y tiempos congelados, instante de decisión, salidas y pronósticos disponibles. |

Archivos experimentales y coordenadas personales no se suben al repositorio público por defecto. Separar fixtures sintéticos de capturas reales y respetar retención/licencias. La captura es inmutable; corregir normalización genera otra versión, sin sobrescribir el original.

## B3 — Métricas y comparación justa

| Pregunta | Métrica | Limitación que debe acompañarla |
| --- | --- | --- |
| ¿Lloverá en 60 minutos? | Detección, omisiones y falsas alarmas para 0–15, 15–30 y 30–60 minutos | No usar exactitud global dominada por horas secas. |
| ¿Son útiles las probabilidades? | Brier score y frecuencia observada por grupos de probabilidad | Mismo evento, periodo y anticipación; muestra pequeña implica incertidumbre. |
| ¿Cuándo empieza/termina? | Error absoluto, sesgo y porcentaje dentro de ±10 minutos | Medir omisiones aparte; no puntuar solo episodios acertados. Fin fuera de horizonte queda censurado. |
| ¿Cuánto y con qué intensidad? | Error absoluto y sesgo en mm/15 min y mm/60 min; tasas medias a 5–10 min | Agregar datos finos, no inventar picos desde acumulados horarios. |
| ¿Qué ocurre en ruta? | Tramos afectados, primer contacto y minutos bajo lluvia | Solo segmentos/horas con observación representativa. |
| ¿Ayuda esperar? | Cambios de exposición y demoras sin beneficio; recomendaciones perjudiciales | Requiere observación de las alternativas, no solo de un viaje. |
| ¿Es operativo? | Disponibilidad, cobertura temporal, latencia, antigüedad y coste por decisión | Informar también fallos excluidos de comparaciones pareadas. |

Normalizar intervalos UTC y sus extremos antes de sumar. Las acumulaciones precedentes y siguientes no son intercambiables. Comparar datos finos agregados a una ventana común cuando sea necesario; evaluar aparte el detalle adicional de los productos minutely.

Usar métricas meteorológicas sobre pares de casos con datos y observación comparables, junto con una evaluación operativa que conserve faltantes/fallos. Así no gana un proveedor por devolver datos solo en casos fáciles.

Referencias de comparación: persistencia de la condición/intensidad observada, siempre que esa observación esté disponible al decidir, y salir inmediatamente para las decisiones de espera. Una referencia «siempre seco» permite detectar resultados engañosos por predominio de tiempo seco.

Reservar los últimos episodios/días como evaluación final temporal. Ajustar umbrales solo en la parte inicial y congelarlos antes del periodo reservado. Las consultas solapadas de una misma tormenta no son muestras independientes: resumir por episodio/día y, si se estiman intervalos, remuestrear por bloques de episodios, no por minuto.

El Brier score mide error probabilístico; los diagramas de fiabilidad muestran correspondencia entre porcentajes y frecuencias. Con pocos episodios las conclusiones serán provisionales. [ECMWF: verificación](https://www.ecmwf.int/en/elibrary/81662-forecast-verification-using-information-and-noise).

## B4 — Recorrido y alternativas de salida

### Validación sobre viajes realizados

- Seleccionar una ruta habitual y 8–12 puntos iniciales de consulta; aumentar o reducir según distancia y resolución.
- Congelar la misma geometría y tiempos previstos para todos los proveedores meteorológicos.
- Registrar trayectoria/horas reales de paso y observaciones de lluvia de forma que no requiera operar el teléfono conduciendo.
- Evaluar primero con tiempos previstos —utilidad real— y después con tiempos observados —diagnóstico del error meteorológico frente al error de routing—.
- Las anotaciones realizadas al terminar el viaje incluyen margen de incertidumbre. Un recuerdo de un tramo no produce una observación por minuto exacta.

### Evaluación de esperar

Un viaje de 40 minutos requiere 40, 50, 60 o 70 minutos desde la consulta para salidas ahora/+10/+20/+30. Añadir margen por datos antiguos y variación del viaje. El nowcast de 60 minutos no cubre por sí solo la última opción.

Congelar las cuatro recomendaciones usando solo datos recibidos al instante de decisión. Las consultas posteriores se evalúan como nuevas decisiones. Si un producto completa el horizonte con datos horarios, etiquetar esa parte; no presentarla como nowcast equivalente.

**Un viaje realizado no observa las otras tres alternativas.** Para verificar qué habría ocurrido al salir después hacen falta observaciones continuas a lo largo del corredor o un campo observado independiente validado localmente. Tres puntos —inicio, intermedio y destino— constituyen evidencia parcial, no cobertura completa.

Cuando exista observación suficiente, reconstruir exposición de cada salida con su trayectoria temporal y comparar la opción recomendada con salir ahora y con la mejor opción observable. Incluir coste de espera mediante una regla fijada antes de evaluar; no seleccionar siempre la menor lluvia ignorando 30 minutos de demora.

Separar la reconstrucción con tiempos de viaje supuestos de una observación efectiva. Si faltan observaciones espaciales o tiempos para alternativas, el resultado se clasifica exploratorio y no demuestra una reducción del riesgo. No usar el propio pronóstico para fabricar la lluvia «observada» de las alternativas.

## B5 — Criterio de selección y entregables

Priorizar reducción de omisiones de lluvia relevante para moto, manteniendo un nivel aceptable de falsas alarmas y esperas innecesarias. Comparar curvas/umbrales con la parte de ajuste y congelar el criterio antes de la evaluación final. Evitar una puntuación única arbitraria que oculte fallos críticos.

Entregar:

1. Matriz de cobertura real, resolución conocida, disponibilidad, licencias y coste.
2. Tabla de métricas por tarea y anticipación, con número de episodios y observaciones válidas.
3. Ejemplos completos de aciertos, falsas alarmas, lluvia omitida e inicios desplazados.
4. Limitaciones por ubicación, relieve, temporada, instrumento y cobertura de la ruta.
5. Recomendación provisional por función: proveedor único, dos productos con funciones distintas, continuar evaluación o capacidad no suficientemente respaldada.
6. Informe reproducible con configuración, versiones y referencias a datos cuya conservación esté permitida.

Se puede emitir evidencia suficiente para una función antes de terminar las demás. La selección no es definitiva: revisar cuando cambie el producto o exista información adicional. Desacuerdo entre proveedores no se convierte automáticamente en un intervalo de confianza, y sus probabilidades no se promedian sin evaluación.

## Presupuesto y límites del ensayo

En un punto, nowcast cada 10 minutos supone 144 consultas/día; hourly cada 30 minutos, 48 adicionales. Esa suma de 192 es una estimación por proveedor con dos endpoints; productos extra, ubicaciones y reglas de facturación pueden cambiarla.

El corredor se captura solo en ventanas prefijadas, reutilizando respuestas válidas y limitando concurrencia. Presupuestar por puntos × productos × capturas, no solo solicitudes HTTP: un batch puede facturarse por ubicación. Detener o reducir capturas según un límite predefinido, registrando el cambio de calendario.

Weatherbit publica una prueba de 21 días y hasta 1.500 solicitudes/día. Su plan Free permanente no incluye pronósticos minutely/hourly, y la [FAQ de almacenamiento](https://help.weatherbit.io/faq/can-i-store-data-retrieved-from-the-api-locally/) permite guardar datos solo con una suscripción de pago activa. La captura propuesta puede durar más que la prueba: usar un plan/licencia que permita conservar el archivo experimental u obtener permiso expreso antes de hacerlo. [Planes Weatherbit](https://www.weatherbit.io/pricing).

OpenWeather publica 1.000 llamadas/día gratuitas en One Call; Open-Meteo tiene límites y condiciones de uso no comercial. Fijar límites y comprobar planes vigentes antes del ensayo. [OpenWeather](https://openweathermap.org/price), [Open-Meteo](https://open-meteo.com/en/pricing).

## Pendientes propios del benchmark

- Definir destino y recorrido habitual aproximado de 40 minutos.
- Confirmar si habrá pluviómetro automático o solo observación manual inicialmente.
- Conseguir acceso a los productos necesarios y confirmar retención permitida.
- Seleccionar puntos auxiliares de observación y comprobar posibles estaciones locales.
- Fijar calendario de captura, umbrales observables y criterio de coste de espera.

Si falta instrumentación o cobertura de ruta, avanzar con las tareas que tengan observación válida y declarar las demás pendientes. No sustituir evidencia ausente por conclusiones de precisión.
