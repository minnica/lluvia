"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { pointSchema, type Point } from "@/domain/provider-common";
import { routingResponseSchema, type Route } from "@/domain/routing/contracts";
import { mergeImportedRoutes, routeExportSchema, type SavedRoute } from "@/domain/routing/favorites";
import type { RouteAssessment } from "@/domain/routing/exposure";
import { distanceM } from "@/domain/routing/geometry";
import { loadRoutes, saveRoute, deleteRoute, exportRoutes, importRoutes } from "@/client/storage/local";

const RouteMap = dynamic(() => import("@/components/routes/route-map"), { ssr: false });
type Entry = { lat: string; lon: string };
type Draft = { name: string; origin: Entry; destination: Entry; via: Entry[]; profile: "motorcycle" | "car"; avoid: Array<"tolls" | "motorways" | "unpaved"> };
type Target = "origin" | "destination" | number;
type SearchResult = { label: string; point: Point };
type Analysis = { route: Route; assessment: RouteAssessment; weatherError: string | null; source: string };
const initial: Draft = { name: "", origin: { lat: "19.213346", lon: "-98.755470" }, destination: { lat: "", lon: "" }, via: [], profile: "motorcycle", avoid: [] };
const entry = (point: Point): Entry => ({ lat: String(point.lat), lon: String(point.lon) });
const pointOf = (value: Entry): Point | null => {
  if (!value.lat.trim() || !value.lon.trim()) return null;
  const parsed = pointSchema.safeParse({ lat: Number(value.lat), lon: Number(value.lon) });
  return parsed.success ? parsed.data : null;
};
const formatTime = (time: number) => new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit" }).format(time);
const noSegments: RouteAssessment["segments"] = [];

export default function RoutePlanner() {
  const [draft, setDraft] = useState<Draft>(initial);
  const [saved, setSaved] = useState<SavedRoute[]>([]);
  const [target, setTarget] = useState<Target>("destination");
  const [geocoded, setGeocoded] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const requestNumber = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    void loadRoutes().then(setSaved).catch(() => setStatus("No se pudieron abrir los recorridos guardados."));
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => { window.clearInterval(timer); activeRequest.current?.abort(); };
  }, []);
  const update = (next: Draft) => {
    requestNumber.current++;
    activeRequest.current?.abort();
    setBusy(false); setDraft(next); setAnalysis(null); setSelectedSegment(null);
  };
  const setEntry = (which: Target, value: Entry, fromGeocode = false) => {
    setGeocoded((current) => {
      const next = new Set(current);
      if (fromGeocode) next.add(String(which)); else next.delete(String(which));
      return next;
    });
    if (which === "origin" || which === "destination") update({ ...draft, [which]: value });
    else update({ ...draft, via: draft.via.map((item, index) => index === which ? value : item) });
  };
  const validPoints = useMemo(() => [draft.origin, ...draft.via, draft.destination].map(pointOf)
    .filter((point): point is Point => point !== null), [draft.origin, draft.via, draft.destination]);
  const outdated = analysis ? Date.parse(analysis.route.retrievedAt) + 20 * 60_000 < clock : false;

  async function analyze(value: Draft = draft) {
    const origin = pointOf(value.origin);
    const destination = pointOf(value.destination);
    const via = value.via.map(pointOf);
    if (!origin || !destination || via.some((point) => !point)) { setStatus("Introduce coordenadas válidas para origen, destino y cada parada."); return; }
    const currentRequest = ++requestNumber.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy(true); setStatus("Calculando ruta y pronóstico para cada tramo…"); setAnalysis(null);
    try {
      const response = await fetch("/api/route-weather", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin, destination, via, profile: value.profile, avoid: value.avoid }), cache: "no-store", signal: controller.signal });
      const json = await response.json();
      if (currentRequest !== requestNumber.current) return;
      if (!response.ok) throw new Error(json.error ?? "No se pudo analizar el recorrido");
      const routing = routingResponseSchema.parse(json.routing);
      const route = routing.routes[0];
      if (!route || !json.assessment || !Array.isArray(json.assessment.segments)) throw new Error("Respuesta de recorrido incompleta");
      setAnalysis({ route, assessment: json.assessment as RouteAssessment, weatherError: json.weatherError,
        source: json.forecast?.provider ?? "desconocida" });
      setClock(Date.parse(route.retrievedAt));
      setStatus("Recorrido actualizado. Las horas de paso se calculan desde la salida actual.");
    } catch (error) { if (currentRequest === requestNumber.current) setStatus(error instanceof Error ? error.message : "No se pudo analizar el recorrido"); }
    finally { if (currentRequest === requestNumber.current) { setBusy(false); activeRequest.current = null; } }
  }

  async function searchAddress() {
    if (search.trim().length < 3) { setStatus("Escribe al menos 3 caracteres para buscar una dirección."); return; }
    setSearchBusy(true); setSearchResults([]);
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(search.trim())}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Búsqueda no disponible");
      setSearchResults(json.results as SearchResult[]);
      setStatus(json.results.length ? "Selecciona una dirección para usar sus coordenadas." : "No se encontraron direcciones.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Búsqueda no disponible"); }
    finally { setSearchBusy(false); }
  }

  async function saveFavorite() {
    if (saved.length >= 100) { setStatus("El dispositivo admite hasta 100 recorridos. Exporta o elimina alguno antes de guardar otro."); return; }
    if (geocoded.size) { setStatus("Para guardar, confirma cada punto obtenido de la búsqueda tocando el mapa o ajustando sus coordenadas. No se archivan resultados de geocodificación."); return; }
    const origin = pointOf(draft.origin);
    const destination = pointOf(draft.destination);
    const via = draft.via.map(pointOf);
    if (!origin || !destination || via.some((point) => !point) || !draft.name.trim()) { setStatus("Pon un nombre y completa todos los puntos antes de guardar."); return; }
    const now = new Date().toISOString();
    const route: SavedRoute = { schemaVersion: 1, id: crypto.randomUUID(), name: draft.name.trim().slice(0, 80),
      origin, destination, via: via as Point[], profile: draft.profile, avoid: draft.avoid, createdAt: now, updatedAt: now };
    if (mergeImportedRoutes(saved, [route], () => crypto.randomUUID()).skipped) {
      setStatus("Este recorrido ya está guardado."); return;
    }
    try { await saveRoute(route); setSaved(await loadRoutes()); setStatus("Recorrido guardado. Se volverá a calcular al abrirlo."); }
    catch { setStatus("No se pudo guardar el recorrido en este dispositivo."); }
  }

  async function openFavorite(route: SavedRoute) {
    const next: Draft = { name: route.name, origin: entry(route.origin), destination: entry(route.destination),
      via: route.via.map(entry), profile: route.profile, avoid: route.avoid };
    setDraft(next); setTarget("destination");
    setGeocoded(new Set());
    await analyze(next);
  }

  async function downloadExport() {
    try {
      const json = await exportRoutes();
      routeExportSchema.parse(JSON.parse(json));
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "lluvia-recorridos-v1.json"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("Archivo de recorridos preparado.");
    } catch { setStatus("No se pudo exportar los recorridos."); }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 250_000) throw new Error("El archivo es demasiado grande");
      const result = await importRoutes(await file.text());
      setSaved(await loadRoutes());
      setStatus(`Importación: ${result.added} añadidos, ${result.skipped} duplicados omitidos, ${result.renamed} IDs renovados.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "No se pudo importar el archivo"); }
    if (fileInput.current) fileInput.current.value = "";
  }

  const pointFields = (label: string, which: Target, value: Entry) => <div className="route-point" key={String(which)}>
    <div className="route-point-title"><strong>{label}</strong><button type="button" className="text-button" aria-pressed={target === which}
      onClick={() => { setTarget(which); setStatus(`Toca el mapa o busca una dirección para ${label.toLowerCase()}.`); }}>Elegir en mapa/búsqueda</button></div>
    <div className="field-pair"><div><label htmlFor={`${which}-lat`}>Latitud</label><input id={`${which}-lat`} inputMode="decimal" value={value.lat}
      onChange={(event) => setEntry(which, { ...value, lat: event.target.value })} placeholder="19.2133" /></div>
      <div><label htmlFor={`${which}-lon`}>Longitud</label><input id={`${which}-lon`} inputMode="decimal" value={value.lon}
        onChange={(event) => setEntry(which, { ...value, lon: event.target.value })} placeholder="-98.7555" /></div></div>
  </div>;

  return <main className="app-shell route-shell">
    <header className="site-header"><Link href="/" className="brand"><span className="brand-mark" aria-hidden="true">◉</span><span>LLUVIA</span></Link>
      <Link href="/" className="text-button">Consulta local</Link></header>
    <section className="hero route-hero"><p className="eyebrow">Antes del trayecto</p><h1>Lluvia durante<br /><em>tu recorrido.</em></h1>
      <p>Traza la ruta, revisa la hora de paso por cada tramo y guarda tus recorridos habituales. La señal meteorológica es horaria y su precisión local sigue sin validar.</p></section>
    <div className="route-grid">
      <section className="panel" aria-labelledby="route-form-title"><div className="section-heading"><span className="section-number">01</span><h2 id="route-form-title">Recorrido</h2></div>
        <label htmlFor="route-name">Nombre para guardarlo</label><input id="route-name" maxLength={80} value={draft.name} onChange={(event) => update({ ...draft, name: event.target.value })} placeholder="Trabajo, escuela…" />
        {pointFields("Origen", "origin", draft.origin)}
        {draft.via.map((value, index) => <div key={index}>{pointFields(`Parada ${index + 1}`, index, value)}<button className="text-button" type="button"
          onClick={() => {
            update({ ...draft, via: draft.via.filter((_, item) => item !== index) });
            setGeocoded((current) => new Set([...current].filter((item) => item !== String(index)).map((item) => {
              const number = Number(item);
              return Number.isInteger(number) && number > index ? String(number - 1) : item;
            })));
          }}>Quitar parada</button></div>)}
        {draft.via.length < 4 && <button type="button" className="secondary-button add-via" onClick={() => update({ ...draft, via: [...draft.via, { lat: "", lon: "" }] })}>Añadir parada</button>}
        {pointFields("Destino", "destination", draft.destination)}
        <label htmlFor="route-profile">Modo de transporte</label><select id="route-profile" value={draft.profile}
          onChange={(event) => update({ ...draft, profile: event.target.value as Draft["profile"] })}><option value="motorcycle">Motocicleta (beta en TomTom)</option><option value="car">Automóvil</option></select>
        <fieldset className="avoid-options"><legend>Evitar si es posible</legend>{(["tolls", "motorways", "unpaved"] as const).map((item) => <label key={item}><input type="checkbox" checked={draft.avoid.includes(item)} onChange={(event) => update({ ...draft,
          avoid: event.target.checked ? [...draft.avoid, item] : draft.avoid.filter((value) => value !== item) })} />{item === "tolls" ? "Peajes" : item === "motorways" ? "Autopistas" : "Vías sin pavimentar"}</label>)}</fieldset>
        <button type="button" className="primary-button" disabled={busy} onClick={() => void analyze()}>{busy ? "Analizando…" : "Analizar recorrido ahora"}</button>
        <button type="button" className="secondary-button route-save" onClick={() => void saveFavorite()}>Guardar como favorito</button>
      </section>
      <div className="route-main"><section className="panel" aria-labelledby="route-map-title"><div className="section-heading"><span className="section-number">02</span><h2 id="route-map-title">Mapa y dirección</h2></div>
        <p className="helper">Punto activo: {target === "origin" ? "origen" : target === "destination" ? "destino" : `parada ${target + 1}`}. Toca el mapa para fijarlo; si tocas la ruta calculada, se selecciona ese tramo.</p>
        <div className="search-row"><input aria-label="Buscar dirección en México" value={search} onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void searchAddress(); }} placeholder="Buscar dirección en México" />
          <button type="button" className="secondary-button" disabled={searchBusy} onClick={() => void searchAddress()}>Buscar</button></div>
        {searchResults.length > 0 && <ul className="search-results">{searchResults.map((item, index) => <li key={index}><button type="button" onClick={() => {
          setEntry(target, entry(item.point), true); setSearchResults([]); setStatus("Coordenadas seleccionadas. Para guardarlas como favorito, confirma el punto en el mapa o ajusta sus coordenadas.");
        }}>{item.label}</button></li>)}</ul>}
        <RouteMap keyValue={process.env.NEXT_PUBLIC_TOMTOM_MAP_KEY ?? ""} points={validPoints} segments={analysis?.assessment.segments ?? noSegments}
          selectedId={selectedSegment} onPick={(point) => { setEntry(target, entry(point)); setStatus("Punto elegido en el mapa."); }} onSelect={setSelectedSegment} />
        <p className="footnote">Mapa © TomTom. Verde: sin señal de lluvia; ocre: señal horaria; gris: sin datos suficientes. El color no describe seguridad vial.</p>
      </section>
      <section className="panel route-analysis" aria-labelledby="analysis-title"><div className="section-heading"><span className="section-number">03</span><h2 id="analysis-title">Exposición por tramo</h2></div>
        <p className="status-line" role="status">{status}</p>
        {analysis ? <>
          <div className={`recommendation ${outdated || analysis.assessment.state === "insufficient-data" ? "insufficient-data" : analysis.assessment.rainSignalMinutes ? "rain-signal" : ""}`}>
            <span className="recommendation-kicker">{outdated ? "Consulta anterior" : analysis.assessment.state === "insufficient-data" ? "Cobertura incompleta" : "Señal horaria del recorrido"}</span>
            <h3>{outdated ? "Vuelve a consultar antes de salir" : analysis.assessment.state === "insufficient-data" ? "Faltan datos para algunos tramos" : analysis.assessment.rainSignalMinutes > 0
              ? `Señal de lluvia en ${analysis.assessment.rainSignalMinutes} min de trayecto` : "Sin señal clara de lluvia en la ruta"}</h3>
            <p>{outdated ? "La ruta y el pronóstico tienen más de 20 minutos; el detalle siguiente es histórico." :
              `Son minutos de trayecto que cruzan horas con señal, no minutos reales de lluvia. ${analysis.assessment.unknownMinutes > 0 ? `${analysis.assessment.unknownMinutes} min no evaluables.` : "La lluvia local aún es posible."}`}</p>
          </div>
          <p className="meta">Ruta: {(analysis.route.distanceM / 1000).toFixed(1)} km · {Math.round(analysis.route.durationSeconds / 60)} min · salida {formatTime(Date.parse(analysis.route.requestedDepartureAt))}. Routing: TomTom ({analysis.route.effectiveProfile}); clima: {analysis.source}, horario. Calculado: {formatTime(Date.parse(analysis.route.retrievedAt))}.</p>
          {analysis.weatherError && <p className="helper" role="alert">Pronóstico: {analysis.weatherError}</p>}
          {analysis.route.warnings.map((warning) => <p className="footnote" key={warning}>{warning}</p>)}
          {analysis.assessment.warnings.map((warning) => <p className="footnote" key={warning}>{warning}</p>)}
          <ol className="route-timeline" aria-label="Línea temporal de la ruta">{analysis.assessment.segments.map((item) => {
            const start = Date.parse(analysis.route.requestedDepartureAt) + item.segment.start.seconds * 1000;
            const end = Date.parse(analysis.route.requestedDepartureAt) + item.segment.end.seconds * 1000;
            return <li key={item.segment.id}><button type="button" aria-pressed={selectedSegment === item.segment.id}
              onClick={() => setSelectedSegment(item.segment.id)} className={`timeline-item ${item.state}`}>
              <span className="timeline-time">{formatTime(start)}–{formatTime(end)}</span><strong>{item.state === "unknown" ? "Sin datos" : item.state === "rain-signal" ? "Señal de lluvia" : "Sin señal clara"}</strong>
              <span>{item.probability === null ? "Prob. sin dato" : `Prob. horaria hasta ${Math.round(item.probability * 100)} %`} · {item.amountMm === null ? "mm sin dato" : `hasta ${item.amountMm.toFixed(1)} mm en hora`}</span>
              {selectedSegment === item.segment.id && item.validPeriods.length > 0 && <small>Horas meteorológicas: {item.validPeriods.map((period) => `${formatTime(Date.parse(period.start))}–${formatTime(Date.parse(period.end))}`).join(", ")}.</small>}
              {item.resolvedPoint && <small>Cuadrícula a unos {(distanceM(item.segment.midpoint.position, item.resolvedPoint) / 1000).toFixed(1)} km del punto de paso.</small>}
              {item.warning && <small>{item.warning}</small>}</button></li>;
          })}</ol>
          <p className="footnote">Cada probabilidad se refiere a más de 0.1 mm en la hora indicada. Cada porcentaje y acumulación pertenece a su hora original; cuando un tramo cruza dos horas se muestra el valor horario mayor, sin sumarlos. Hora de paso calculada con tiempos acumulados de TomTom. El muestreo no aumenta la resolución del pronóstico.</p>
        </> : <div className="empty-state">Analiza un recorrido para ver sus tramos y horas de paso.</div>}
      </section></div>
    </div>
    <section className="panel saved-routes" aria-labelledby="saved-title"><div className="section-heading"><span className="section-number">04</span><h2 id="saved-title">Favoritos en este dispositivo</h2></div>
      {saved.length ? <ul>{saved.map((route) => <li key={route.id}><div><strong>{route.name}</strong><small>{route.via.length} paradas · {route.profile === "motorcycle" ? "Moto" : "Auto"}</small></div>
        <div><button type="button" className="secondary-button" disabled={busy} onClick={() => void openFavorite(route)}>Abrir y actualizar</button>
          <button type="button" className="text-button" onClick={() => void deleteRoute(route.id).then(() => loadRoutes().then(setSaved)).catch(() => setStatus("No se pudo borrar el favorito."))}>Eliminar</button></div></li>)}</ul>
        : <p className="helper">Aún no hay recorridos guardados.</p>}
      <div className="route-import-export"><button type="button" className="secondary-button" onClick={() => void downloadExport()}>Exportar JSON</button>
        <label htmlFor="route-import">Importar JSON versionado</label><input ref={fileInput} id="route-import" type="file" accept=".json,application/json" onChange={(event) => void upload(event.target.files?.[0])} /></div>
      <p className="footnote">Se guardan tus puntos y preferencias, no la geometría ni el pronóstico de TomTom u Open-Meteo. Un favorito siempre se vuelve a consultar.</p>
    </section>
    <footer className="app-footer"><p>La información meteorológica local es provisional. Pavimento mojado, visibilidad y viento requieren tu propia evaluación.</p></footer>
  </main>;
}
