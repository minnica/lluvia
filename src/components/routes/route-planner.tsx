"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import SiteHeader from "@/components/site-header";
import type { Point } from "@/domain/provider-common";
import { routingResponseSchema, type Route } from "@/domain/routing/contracts";
import { formatCoordinates, parseCoordinates } from "@/domain/routing/coordinates";
import { mergeImportedRoutes, routeExportSchema, type SavedRoute } from "@/domain/routing/favorites";
import type { RouteAssessment } from "@/domain/routing/exposure";
import type { DepartureComparison, DepartureOffset } from "@/domain/routing/comparison";
import { distanceM } from "@/domain/routing/geometry";
import { loadLocalState, loadRoutes, saveLocation, saveRoute, deleteRoute, exportRoutes, importRoutes, type SavedLocation } from "@/client/storage/local";

const RouteMap = dynamic(() => import("@/components/routes/route-map"), { ssr: false });
type Entry = string;
type Draft = { name: string; origin: Entry; destination: Entry; via: Entry[]; profile: "motorcycle" | "car"; avoid: Array<"tolls" | "motorways" | "unpaved"> };
type Target = "origin" | "destination" | number;
type SearchResult = { label: string; point: Point };
type PlaceOption = { id: string; name: string; point: Point };
type Analysis = { route: Route; assessment: RouteAssessment; comparison: DepartureComparison; weatherError: string | null; source: string; probabilityEvent: string | null };
const homeLocation: SavedLocation = { id: "san-rafael", name: "San Rafael, Tlalmanalco",
  point: { lat: 19.213346433905848, lon: -98.75547014144284 }, createdAt: "2026-09-22T00:00:00Z" };
const initial: Draft = { name: "", origin: formatCoordinates(homeLocation.point), destination: "", via: [], profile: "motorcycle", avoid: [] };
const entry = formatCoordinates;
const pointOf = parseCoordinates;
const samePoint = (a: Point, b: Point) => a.lat === b.lat && a.lon === b.lon;
const shiftPointKeys = (current: Set<string>, removedIndex: number) => new Set([...current]
  .filter((item) => item !== String(removedIndex)).map((item) => {
    const number = Number(item);
    return Number.isInteger(number) && number > removedIndex ? String(number - 1) : item;
  }));
const formatTime = (time: number) => new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit" }).format(time);
const noSegments: RouteAssessment["segments"] = [];

export default function RoutePlanner() {
  const [draft, setDraft] = useState<Draft>(initial);
  const [saved, setSaved] = useState<SavedRoute[]>([]);
  const [places, setPlaces] = useState<SavedLocation[]>([homeLocation]);
  const [savePlaceTarget, setSavePlaceTarget] = useState<Target | null>(null);
  const [placeName, setPlaceName] = useState("");
  const [placeError, setPlaceError] = useState("");
  const [placeNotice, setPlaceNotice] = useState<{ target: Target; message: string } | null>(null);
  const [touchedCoordinates, setTouchedCoordinates] = useState<Set<string>>(() => new Set());
  const [manualTargets, setManualTargets] = useState<Set<string>>(() => new Set());
  const [saveRouteAttempted, setSaveRouteAttempted] = useState(false);
  const [routeSaveNotice, setRouteSaveNotice] = useState("");
  const [target, setTarget] = useState<Target>("destination");
  const [geocoded, setGeocoded] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<string | null>(null);
  const [selectedOffset, setSelectedOffset] = useState<DepartureOffset>(0);
  const [clock, setClock] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const requestNumber = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    void loadRoutes().then(setSaved).catch(() => setStatus("No se pudieron abrir los recorridos guardados."));
    void loadLocalState().then(({ locations }) => setPlaces((current) =>
      [...new Map([homeLocation, ...locations, ...current].map((item) => [item.id, item])).values()]))
      .catch(() => setStatus("No se pudieron abrir los lugares guardados."));
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => { window.clearInterval(timer); activeRequest.current?.abort(); };
  }, []);
  const update = (next: Draft) => {
    requestNumber.current++;
    activeRequest.current?.abort();
    setBusy(false); setDraft(next); setAnalysis(null); setSelectedSegment(null); setSelectedOffset(0); setRouteSaveNotice("");
  };
  const setEntry = (which: Target, value: Entry, source: "manual" | "geocoded" | "saved" = "manual") => {
    setPlaceNotice(null);
    setRouteSaveNotice("");
    setManualTargets((current) => {
      const next = new Set(current);
      if (source === "saved") next.delete(String(which)); else next.add(String(which));
      return next;
    });
    setGeocoded((current) => {
      const next = new Set(current);
      if (source === "geocoded") next.add(String(which)); else next.delete(String(which));
      return next;
    });
    if (which === "origin" || which === "destination") update({ ...draft, [which]: value });
    else update({ ...draft, via: draft.via.map((item, index) => index === which ? value : item) });
  };
  const validPoints = useMemo(() => [draft.origin, ...draft.via, draft.destination].map(pointOf)
    .filter((point): point is Point => point !== null), [draft.origin, draft.via, draft.destination]);
  const routePlaces = useMemo(() => {
    const options: PlaceOption[] = [];
    for (const route of saved) {
      for (const [role, point] of [["Origen", route.origin], ["Destino", route.destination]] as const) {
        if (places.some((place) => samePoint(place.point, point)) || options.some((option) => samePoint(option.point, point))) continue;
        options.push({ id: `${route.id}:${role}`, name: `${route.name} · ${role.toLowerCase()}`, point });
      }
    }
    return options;
  }, [places, saved]);
  const placeOptions: PlaceOption[] = [...places, ...routePlaces];
  const outdated = analysis ? Date.parse(analysis.route.retrievedAt) + 20 * 60_000 < clock : false;
  const displayed = analysis?.comparison.alternatives.find((item) => item.offsetMinutes === selectedOffset);
  const displayRoute = displayed?.route ?? analysis?.route;
  const displayAssessment = displayed?.assessment ?? analysis?.assessment;

  async function analyze(value: Draft = draft) {
    const origin = pointOf(value.origin);
    const destination = pointOf(value.destination);
    const via = value.via.map(pointOf);
    if (!origin || !destination || via.some((point) => !point)) {
      setTouchedCoordinates(new Set(["origin", "destination", ...value.via.map((_, index) => String(index))]));
      setStatus("Revisa las coordenadas del recorrido."); return;
    }
    const currentRequest = ++requestNumber.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy(true); setStatus("Comparando salidas…"); setAnalysis(null); setSelectedOffset(0);
    try {
      const response = await fetch("/api/route-weather", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin, destination, via, profile: value.profile, avoid: value.avoid }), cache: "no-store", signal: controller.signal });
      const json = await response.json();
      if (currentRequest !== requestNumber.current) return;
      if (!response.ok) throw new Error(json.error ?? "No se pudo analizar el recorrido");
      const routing = routingResponseSchema.parse(json.routing);
      const route = routing.routes[0];
      if (!route || !json.assessment || !Array.isArray(json.assessment.segments) || !json.comparison ||
          !Array.isArray(json.comparison.alternatives) || json.comparison.alternatives.length !== 4) throw new Error("Respuesta de recorrido incompleta");
      setAnalysis({ route, assessment: json.assessment as RouteAssessment, comparison: json.comparison as DepartureComparison, weatherError: json.weatherError,
        source: json.forecast?.provider ?? "desconocida",
        probabilityEvent: json.forecast?.points?.[0]?.values?.find((value: { variable: string }) => value.variable === "precipitationProbability")?.probabilityEvent?.description ?? null });
      setClock(Date.parse(route.retrievedAt));
      setStatus("Listo. Elige una hora de salida.");
    } catch (error) { if (currentRequest === requestNumber.current) setStatus(error instanceof Error ? error.message : "No se pudo analizar el recorrido"); }
    finally { if (currentRequest === requestNumber.current) { setBusy(false); activeRequest.current = null; } }
  }

  async function searchAddress() {
    if (search.trim().length < 3) { setStatus("Escribe al menos 3 caracteres."); return; }
    setSearchBusy(true); setSearchResults([]);
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(search.trim())}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Búsqueda no disponible");
      setSearchResults(json.results as SearchResult[]);
      setStatus(json.results.length ? "Elige una dirección." : "No se encontraron direcciones.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Búsqueda no disponible"); }
    finally { setSearchBusy(false); }
  }

  async function saveFavorite() {
    const report = (message: string) => { setStatus(message); setRouteSaveNotice(message); };
    if (saved.length >= 100) { report("Límite de 100 recorridos. Elimina uno para guardar otro."); return; }
    if (geocoded.size) { report("Confirma en el mapa los puntos encontrados por búsqueda antes de guardar."); return; }
    setSaveRouteAttempted(true);
    const origin = pointOf(draft.origin);
    const destination = pointOf(draft.destination);
    const via = draft.via.map(pointOf);
    if (!origin || !destination || via.some((point) => !point) || !draft.name.trim()) {
      setTouchedCoordinates(new Set(["origin", "destination", ...draft.via.map((_, index) => String(index))]));
      report("Pon un nombre y completa el recorrido."); return;
    }
    const now = new Date().toISOString();
    const route: SavedRoute = { schemaVersion: 1, id: crypto.randomUUID(), name: draft.name.trim().slice(0, 80),
      origin, destination, via: via as Point[], profile: draft.profile, avoid: draft.avoid, createdAt: now, updatedAt: now };
    if (mergeImportedRoutes(saved, [route], () => crypto.randomUUID()).skipped) {
      report("Este recorrido ya está guardado."); return;
    }
    try { await saveRoute(route); setSaved(await loadRoutes()); setSaveRouteAttempted(false); report("Recorrido guardado."); }
    catch { report("No se pudo guardar el recorrido en este dispositivo."); }
  }

  async function openFavorite(route: SavedRoute) {
    const next: Draft = { name: route.name, origin: entry(route.origin), destination: entry(route.destination),
      via: route.via.map(entry), profile: route.profile, avoid: route.avoid };
    setDraft(next); setTarget("destination");
    setGeocoded(new Set());
    setManualTargets(new Set());
    setTouchedCoordinates(new Set());
    setSaveRouteAttempted(false);
    setRouteSaveNotice("");
    setSavePlaceTarget(null); setPlaceError(""); setPlaceNotice(null);
    await analyze(next);
  }

  async function downloadExport() {
    try {
      const json = await exportRoutes();
      routeExportSchema.parse(JSON.parse(json));
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "lluvia-recorridos-v1.json"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("Archivo listo para descargar.");
    } catch { setStatus("No se pudieron exportar los recorridos."); }
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

  async function saveCurrentPlace(which: Target, value: Entry) {
    const point = pointOf(value);
    const name = placeName.trim();
    if (!point) { setPlaceError("Escribe latitud y longitud válidas."); return; }
    if (!name) { setPlaceError("Ponle un nombre al lugar."); return; }
    if (geocoded.has(String(which))) { setPlaceError("Confirma el punto en el mapa o ajusta las coordenadas antes de guardarlo."); return; }
    const existing = places.find((place) => samePoint(place.point, point));
    if (existing) { setPlaceError(`Ya está guardado como ${existing.name}.`); return; }
    if (places.some((place) => place.name.toLocaleLowerCase("es-MX") === name.toLocaleLowerCase("es-MX"))) {
      setPlaceError("Ese nombre ya existe. Elige otro."); return;
    }
    try {
      const location: SavedLocation = { id: crypto.randomUUID(), name: name.slice(0, 60), point, createdAt: new Date().toISOString() };
      await saveLocation(location);
      setPlaces((current) => [...current, location]);
      setManualTargets((current) => new Set([...current].filter((item) => item !== String(which))));
      setSavePlaceTarget(null); setPlaceName(""); setPlaceError("");
      setPlaceNotice({ target: which, message: `Lugar guardado: ${location.name}.` });
    } catch { setPlaceError("No se pudo guardar el lugar en este dispositivo."); }
  }

  const pointFields = (label: string, which: Target, value: Entry) => {
    const point = pointOf(value);
    const savedPlace = point && places.find((place) => samePoint(place.point, point));
    const selectedOption = !manualTargets.has(String(which)) && point
      ? placeOptions.find((option) => samePoint(option.point, point)) : null;
    return <div className="route-point" key={String(which)}>
    <div className="route-point-title"><strong>{label}</strong><button type="button" className="text-button" aria-pressed={target === which}
      onClick={() => setTarget(which)}>{target === which ? "Editando en mapa" : "Elegir en mapa"}</button></div>
    <label htmlFor={`${which}-saved`}>Lugar guardado</label>
    <select id={`${which}-saved`} value={selectedOption?.id ?? ""}
      onChange={(event) => {
        const option = placeOptions.find((item) => item.id === event.target.value);
        if (option) setEntry(which, entry(option.point), "saved");
        else setManualTargets((current) => new Set(current).add(String(which)));
        setSavePlaceTarget(null);
        setTouchedCoordinates((current) => new Set([...current].filter((item) => item !== String(which))));
      }}>
      <option value="">Editar coordenadas</option>
      <optgroup label="Mis lugares">{places.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</optgroup>
      {routePlaces.length > 0 && <optgroup label="De recorridos guardados">{routePlaces.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</optgroup>}
    </select>
    <label htmlFor={`${which}-coords`}>Coordenadas (latitud, longitud)</label>
    <input id={`${which}-coords`} inputMode="text" autoComplete="off" value={value} disabled={Boolean(selectedOption)}
      onChange={(event) => setEntry(which, event.target.value)} onBlur={() => setTouchedCoordinates((current) => new Set(current).add(String(which)))}
      placeholder="19.20487325043874, -98.87037416564777" aria-invalid={touchedCoordinates.has(String(which)) && !point} />
    {touchedCoordinates.has(String(which)) && !point && <p className="route-point-error" role="alert">Usa el formato latitud, longitud.</p>}
    {point && !savedPlace && !geocoded.has(String(which)) && savePlaceTarget !== which &&
      <button type="button" className="text-button route-place-save" onClick={() => { setSavePlaceTarget(which); setPlaceName(""); setPlaceError(""); }}>Guardar lugar</button>}
    {savePlaceTarget === which && <form className="route-place-form" onSubmit={(event) => { event.preventDefault(); void saveCurrentPlace(which, value); }}>
      <label htmlFor={`${which}-place-name`}>Nombre del lugar</label>
      <div className="route-place-form-row"><input id={`${which}-place-name`} autoFocus maxLength={60} value={placeName} onChange={(event) => { setPlaceName(event.target.value); setPlaceError(""); }} placeholder="Casa, trabajo…" />
        <button type="submit" className="secondary-button">Guardar</button></div>
      {placeError && <p className="route-point-error" role="alert">{placeError}</p>}
    </form>}
    {placeNotice?.target === which && <p className="route-point-notice" role="status">{placeNotice.message}</p>}
  </div>;
  };

  return <main className="app-shell route-shell">
    <SiteHeader section="route" />
    <section className="hero route-hero"><h1>¿Cuándo salir?</h1><p>Compara la lluvia durante tu recorrido.</p></section>
    <div className="route-grid">
      <section className="panel" aria-labelledby="route-form-title"><div className="section-heading"><h2 id="route-form-title">Tu recorrido</h2></div>
        {pointFields("Origen", "origin", draft.origin)}
        {draft.via.map((value, index) => <div key={index}>{pointFields(`Parada ${index + 1}`, index, value)}<button className="text-button" type="button"
          onClick={() => {
            update({ ...draft, via: draft.via.filter((_, item) => item !== index) });
            setTarget((current) => typeof current !== "number" ? current : current === index ? "destination" : current > index ? current - 1 : current);
            setSavePlaceTarget(null); setPlaceError(""); setPlaceNotice(null);
            setTouchedCoordinates((current) => shiftPointKeys(current, index));
            setGeocoded((current) => shiftPointKeys(current, index));
            setManualTargets((current) => shiftPointKeys(current, index));
          }}>Quitar parada</button></div>)}
        {draft.via.length < 4 && <button type="button" className="secondary-button add-via" onClick={() => update({ ...draft, via: [...draft.via, ""] })}>Añadir parada</button>}
        {pointFields("Destino", "destination", draft.destination)}
        <details className="route-options"><summary>Opciones de ruta · {draft.profile === "motorcycle" ? "Moto" : "Auto"}</summary>
          <label htmlFor="route-profile">Viajas en</label><select id="route-profile" value={draft.profile}
            onChange={(event) => update({ ...draft, profile: event.target.value as Draft["profile"] })}><option value="motorcycle">Moto</option><option value="car">Auto</option></select>
          <fieldset className="avoid-options"><legend>Evitar si es posible</legend>{(["tolls", "motorways", "unpaved"] as const).map((item) => <label key={item}><input type="checkbox" checked={draft.avoid.includes(item)} onChange={(event) => update({ ...draft,
            avoid: event.target.checked ? [...draft.avoid, item] : draft.avoid.filter((value) => value !== item) })} />{item === "tolls" ? "Peajes" : item === "motorways" ? "Autopistas" : "Vías sin pavimentar"}</label>)}</fieldset>
        </details>
        <button type="button" className="primary-button" disabled={busy} onClick={() => void analyze()}>{busy ? "Analizando…" : "Comparar salidas"}</button>
        <div className="route-save-controls"><label htmlFor="route-name">Nombre para guardar el recorrido</label><input id="route-name" maxLength={80} value={draft.name} aria-invalid={saveRouteAttempted && !draft.name.trim()}
          onChange={(event) => { setDraft((current) => ({ ...current, name: event.target.value })); setRouteSaveNotice(""); }} placeholder="Casa al trabajo" />
          {saveRouteAttempted && !draft.name.trim() && <p className="route-point-error" role="alert">Ponle un nombre al recorrido.</p>}
          <button type="button" className="secondary-button route-save" onClick={() => void saveFavorite()}>Guardar recorrido</button>
          {routeSaveNotice && <p className="route-point-notice" role="status">{routeSaveNotice}</p>}</div>
      </section>
      <div className="route-main"><section className="panel" aria-labelledby="route-map-title"><div className="section-heading"><h2 id="route-map-title">Mapa</h2></div>
        <p className="helper">Editando {target === "origin" ? "origen" : target === "destination" ? "destino" : `parada ${target + 1}`}. Toca el mapa o busca una dirección.</p>
        <div className="search-row"><input aria-label="Buscar dirección en México" value={search} onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void searchAddress(); }} placeholder="Buscar dirección" />
          <button type="button" className="secondary-button" disabled={searchBusy} onClick={() => void searchAddress()}>Buscar</button></div>
        {searchResults.length > 0 && <ul className="search-results">{searchResults.map((item, index) => <li key={index}><button type="button" onClick={() => {
          setEntry(target, entry(item.point), "geocoded"); setSearchResults([]); setStatus("Dirección elegida. Confirma el punto en el mapa antes de guardarlo.");
        }}>{item.label}</button></li>)}</ul>}
        <RouteMap keyValue={process.env.NEXT_PUBLIC_TOMTOM_MAP_KEY ?? ""} points={validPoints} segments={displayAssessment?.segments ?? noSegments}
          selectedId={selectedSegment} onPick={(point) => { setEntry(target, entry(point)); setStatus("Punto elegido en el mapa."); }} onSelect={setSelectedSegment} />
        <p className="footnote">Mapa © TomTom. El color indica lluvia prevista, ausencia de señal o falta de datos.</p>
      </section>
      <section className="panel route-analysis" aria-labelledby="analysis-title"><div className="section-heading"><h2 id="analysis-title">Resultado</h2></div>
        <p className="status-line" role="status">{status}</p>
        {analysis && displayRoute && displayAssessment ? <>
          <div className={`recommendation ${outdated || displayAssessment.state === "insufficient-data" ? "insufficient-data" : displayAssessment.rainSignalMinutes ? "rain-signal" : ""}`}>
            <h3>{outdated ? "Vuelve a consultar antes de salir" : displayAssessment.state === "insufficient-data" ? "Faltan datos para algunos tramos" : displayAssessment.rainSignalMinutes > 0
              ? `${displayAssessment.rainSignalMinutes} min con señal de lluvia` : "Sin señal clara de lluvia"}</h3>
            <p>{outdated ? "Resultado anterior." : displayAssessment.unknownMinutes > 0 ? `${displayAssessment.unknownMinutes} min sin datos.` : "Señal basada en pronóstico horario."}</p>
          </div>
          <p className="meta">{(displayRoute.distanceM / 1000).toFixed(1)} km · {Math.round(displayRoute.durationSeconds / 60)} min de viaje · salida {formatTime(Date.parse(displayRoute.requestedDepartureAt))}</p>
          <section className="departure-comparison" aria-labelledby="comparison-title">
            <h3 id="comparison-title">Hora de salida</h3>
            <p>{outdated ? "Actualiza para comparar." : analysis.comparison.state === "insufficient-data" ? "Faltan datos para comparar todas las salidas." :
              analysis.comparison.bestOffsetMinutes === null ? "No hay una hora claramente mejor con estos datos." :
                analysis.comparison.bestOffsetMinutes === 0 ? "Salir ahora muestra menos señal de lluvia." :
                  `Esperar ${analysis.comparison.bestOffsetMinutes} min muestra menos señal de lluvia.`}</p>
            <div className="departure-options">{analysis.comparison.alternatives.map((option) => {
              return <button type="button" key={option.offsetMinutes} className="departure-option" aria-pressed={selectedOffset === option.offsetMinutes}
                disabled={!option.route || !option.assessment} onClick={() => { setSelectedOffset(option.offsetMinutes); setSelectedSegment(null); }}>
                <strong>{option.offsetMinutes === 0 ? "Ahora" : `+${option.offsetMinutes} min`}</strong>
                <span>{option.route ? `${formatTime(Date.parse(option.route.requestedDepartureAt))} · ${Math.round(option.route.durationSeconds / 60)} min` : "Ruta no disponible"}</span>
                <span>{option.assessment ? option.assessment.state === "insufficient-data" || option.sensitivity.some((scenario) => !scenario.complete)
                  ? "Datos incompletos" : `${option.assessment.rainSignalMinutes} min con señal` : option.routingError}</span>
                {option.routeChanged && <small>Ruta distinta</small>}
                {option.timingChanged && <small>Tiempos distintos</small>}
                {option.durationDeltaMinutes !== null && option.durationDeltaMinutes !== 0 && <small>{option.durationDeltaMinutes > 0 ? "+" : ""}{option.durationDeltaMinutes} min vs. ahora</small>}
              </button>;
            })}</div>
            <p className="footnote">La señal indica tramos que coinciden con horas de posible lluvia; no son minutos reales bajo lluvia.</p>
          </section>
          {analysis.weatherError && <p className="helper" role="alert">Pronóstico: {analysis.weatherError}</p>}
          <ol className="route-timeline" aria-label="Línea temporal de la ruta">{displayAssessment.segments.map((item) => {
            const start = Date.parse(displayRoute.requestedDepartureAt) + item.segment.start.seconds * 1000;
            const end = Date.parse(displayRoute.requestedDepartureAt) + item.segment.end.seconds * 1000;
            return <li key={item.segment.id}><button type="button" aria-pressed={selectedSegment === item.segment.id}
              onClick={() => setSelectedSegment(item.segment.id)} className={`timeline-item ${item.state}`}>
              <span className="timeline-time">{formatTime(start)}–{formatTime(end)}</span><strong>{item.state === "unknown" ? "Sin datos" : item.state === "rain-signal" ? "Señal de lluvia" : "Sin señal clara"}</strong>
              <span>Prob. {item.probability === null ? "—" : `${Math.round(item.probability * 100)} %`} · {item.amountMm === null ? "Lluvia —" : `${item.amountMm.toFixed(1)} mm`}</span>
              {selectedSegment === item.segment.id && item.validPeriods.length > 0 && <small>Horas meteorológicas: {item.validPeriods.map((period) => `${formatTime(Date.parse(period.start))}–${formatTime(Date.parse(period.end))}`).join(", ")}.</small>}
              {selectedSegment === item.segment.id && item.resolvedPoint && <small>Cuadrícula a unos {(distanceM(item.segment.midpoint.position, item.resolvedPoint) / 1000).toFixed(1)} km del punto de paso.</small>}
              {item.warning && <small>{item.warning}</small>}</button></li>;
          })}</ol>
          <details className="route-method"><summary>Cómo se calculó</summary>
            <p>{analysis.comparison.reason}</p>
            <p>Ruta: TomTom ({displayRoute.effectiveProfile}); clima: {analysis.source}. Calculado a las {formatTime(Date.parse(displayRoute.retrievedAt))}. Se requieren al menos {analysis.comparison.requiredHorizonMinutes} min de cobertura; el pronóstico más antiguo tiene {analysis.comparison.forecastAgeMinutes} min.</p>
            <p>El margen ±5/10 min prueba cambios en la hora de paso; no es un intervalo estadístico. Cada probabilidad corresponde a {analysis.probabilityEvent?.toLowerCase() ?? "un evento de precipitación no especificado"}. Los valores son horarios y no se suman al cruzar dos horas.</p>
            {displayRoute.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            {displayAssessment.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </details>
        </> : <div className="empty-state">Compara salidas para ver el resultado.</div>}
      </section></div>
    </div>
    <section className="panel saved-routes" aria-labelledby="saved-title"><div className="section-heading"><h2 id="saved-title">Recorridos guardados</h2></div>
      {saved.length ? <ul>{saved.map((route) => <li key={route.id}><div><strong>{route.name}</strong><small>{route.via.length} paradas · {route.profile === "motorcycle" ? "Moto" : "Auto"}</small></div>
        <div><button type="button" className="secondary-button" disabled={busy} onClick={() => void openFavorite(route)}>Abrir</button>
          <button type="button" className="text-button" onClick={() => void deleteRoute(route.id).then(() => loadRoutes().then(setSaved)).catch(() => setStatus("No se pudo borrar el favorito."))}>Eliminar</button></div></li>)}</ul>
        : <p className="helper">Aún no hay recorridos guardados.</p>}
      <details className="route-transfer"><summary>Importar o exportar recorridos</summary><div className="route-import-export"><button type="button" className="secondary-button" onClick={() => void downloadExport()}>Exportar JSON</button>
        <label htmlFor="route-import">Importar JSON</label><input ref={fileInput} id="route-import" type="file" accept=".json,application/json" onChange={(event) => void upload(event.target.files?.[0])} /></div></details>
      <p className="footnote">Al abrir un recorrido, se actualizan la ruta y el pronóstico.</p>
    </section>
    <footer className="app-footer"><p>El pronóstico no sustituye tu evaluación del camino.</p></footer>
  </main>;
}
