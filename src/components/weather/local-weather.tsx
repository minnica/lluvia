"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pointSchema, periodSchema } from "@/domain/provider-common";
import type { Period } from "@/domain/provider-common";
import { weatherResponseSchema } from "@/domain/weather/contracts";
import type { WeatherResponse } from "@/domain/weather/contracts";
import { assessLocalForecast } from "@/domain/weather/local";
import { loadLocalState, loadSnapshot, saveLocation, savePreferences, saveSnapshot } from "@/client/storage/local";
import type { SavedLocation } from "@/client/storage/local";

const home: SavedLocation = {
  id: "san-rafael", name: "San Rafael, Tlalmanalco",
  point: { lat: 19.213346433905848, lon: -98.75547014144284 }, createdAt: "2026-09-22T00:00:00Z",
};
type Result = { forecast: WeatherResponse; period: Period; previous: boolean };
const formatTime = (value: string) => new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const formatHour = (value: string) => new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const snapshotId = (locationId: string, minutes: number) => `${locationId}:${minutes}`;

export default function LocalWeather() {
  const [locations, setLocations] = useState<SavedLocation[]>([home]);
  const [selectedId, setSelectedId] = useState(home.id);
  const [minutes, setMinutes] = useState(60);
  const [customMinutes, setCustomMinutes] = useState("90");
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState("Preparando consulta…");
  const [pending, setPending] = useState(false);
  const [manual, setManual] = useState({ name: "", lat: "", lon: "" });
  const [geoStatus, setGeoStatus] = useState("La ubicación del dispositivo se solicita solo al pulsar el botón.");
  const [storageStatus, setStorageStatus] = useState("");
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [clock, setClock] = useState(0);
  const requestNumber = useRef(0);

  const fetchForecast = useCallback(async (location: SavedLocation, duration: number) => {
    const currentRequest = ++requestNumber.current;
    setPending(true);
    setStatus("Actualizando pronóstico…");
    try {
      const query = new URLSearchParams({ lat: String(location.point.lat), lon: String(location.point.lon), minutes: String(duration) });
      const response = await fetch(`/api/weather?${query}`, { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(typeof body === "object" && body !== null && "error" in body ? String(body.error) : "No se pudo consultar el clima");
      if (typeof body !== "object" || body === null || !("forecast" in body) || !("period" in body)) throw new Error("La respuesta meteorológica es inválida");
      const forecast = weatherResponseSchema.parse(body.forecast);
      const period = periodSchema.parse(body.period);
      if (currentRequest !== requestNumber.current) return;
      setResult({ forecast, period, previous: false });
      setClock(Date.now());
      setStatus(forecast.points[0]?.status === "ok" ? "Pronóstico actualizado" : "Pronóstico recibido con datos incompletos");
      try { await saveSnapshot({ id: snapshotId(location.id, duration), forecast, period }); } catch { setStatus("Pronóstico actualizado; no se pudo guardar para abrir sin conexión."); }
    } catch (error) {
      const snapshot = await loadSnapshot(snapshotId(location.id, duration)).catch(() => null);
      if (currentRequest !== requestNumber.current) return;
      setResult(snapshot ? { forecast: snapshot.forecast, period: snapshot.period, previous: true } : null);
      setClock(Date.now());
      setStatus(`${error instanceof Error ? error.message : "No se pudo consultar el clima"}. ${snapshot ? "Se muestra la consulta anterior, sin recomendación actual." : "Intenta de nuevo con conexión."}`);
    } finally { if (currentRequest === requestNumber.current) setPending(false); }
  }, []);

  useEffect(() => {
    let active = true;
    void loadLocalState().then(({ locations: stored, preferences }) => {
      if (!active) return;
      const available = [home, ...stored.filter((location) => location.id !== home.id)];
      const selected = available.find((location) => location.id === preferences?.selectedLocationId) ?? home;
      const duration = preferences?.minutes ?? 60;
      setLocations(available); setSelectedId(selected.id); setMinutes(duration); setCustomMinutes(String(duration));
      void fetchForecast(selected, duration);
    }).catch(() => { if (active) { setStatus("No se pudo abrir el almacenamiento local."); void fetchForecast(home, 60); } });
    return () => { active = false; };
  }, [fetchForecast]);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    }
    const capture = (event: Event) => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener("beforeinstallprompt", capture);
    const interval = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => { window.removeEventListener("beforeinstallprompt", capture); window.clearInterval(interval); };
  }, []);

  const selected = locations.find((location) => location.id === selectedId) ?? home;
  const point = result?.forecast.points[0];
  const assessment = result && point ? assessLocalForecast(point, result.period, clock) : null;
  const safeAssessment = result?.previous && assessment ? { ...assessment, state: "insufficient-data" as const,
    message: "Pronóstico anterior, sin recomendación actual", reason: "Se necesita una consulta nueva para decidir la salida." } : assessment;
  const retrievedAt = point?.values[0]?.retrievedAt;

  async function selectLocation(id: string, duration = minutes) {
    const location = locations.find((item) => item.id === id) ?? home;
    setSelectedId(id); setResult(null);
    await savePreferences({ selectedLocationId: id, minutes: duration }).catch(() => setStorageStatus("No se pudo guardar la preferencia en este dispositivo."));
    void fetchForecast(location, duration);
  }

  async function selectDuration(duration: number) {
    setMinutes(duration); setCustomMinutes(String(duration)); setResult(null);
    await savePreferences({ selectedLocationId: selected.id, minutes: duration }).catch(() => setStorageStatus("No se pudo guardar la preferencia en este dispositivo."));
    void fetchForecast(selected, duration);
  }

  async function addLocation(location: SavedLocation) {
    setLocations((current) => [...current, location]);
    setSelectedId(location.id); setResult(null);
    setStorageStatus("");
    try {
      await saveLocation(location);
      await savePreferences({ selectedLocationId: location.id, minutes });
    } catch { setStorageStatus("No se pudo guardar la ubicación en este dispositivo; puedes consultarla ahora."); }
    void fetchForecast(location, minutes);
  }

  function useGeolocation() {
    if (!navigator.geolocation || !window.isSecureContext) { setGeoStatus("La geolocalización necesita HTTPS y un navegador compatible. Usa coordenadas manuales."); return; }
    setGeoStatus("Solicitando permiso y posición…");
    navigator.geolocation.getCurrentPosition((position) => {
      if (position.coords.accuracy > 500) { setGeoStatus(`Precisión insuficiente (±${Math.round(position.coords.accuracy)} m). Usa coordenadas manuales o vuelve a intentarlo.`); return; }
      setGeoStatus(`Ubicación obtenida con precisión aproximada de ±${Math.round(position.coords.accuracy)} m.`);
      void addLocation({ id: crypto.randomUUID(), name: "Mi ubicación", point: { lat: position.coords.latitude, lon: position.coords.longitude }, createdAt: new Date().toISOString() });
    }, (error) => {
      setGeoStatus(error.code === 1 ? "Permiso denegado. Puedes introducir coordenadas manuales." :
        error.code === 3 ? "Se agotó el tiempo para localizarte. Intenta de nuevo o usa coordenadas manuales." :
          "No se pudo obtener la posición. Usa coordenadas manuales.");
    }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 });
  }

  async function install() {
    const prompt = installPrompt as (Event & { prompt: () => Promise<void> }) | null;
    if (prompt?.prompt) { await prompt.prompt(); setInstallPrompt(null); }
  }

  return (
    <main className="app-shell">
      <header className="site-header">
        <div className="brand"><span className="brand-mark" aria-hidden="true">◉</span><span>LLUVIA</span></div>
        <span className="header-caption">Consulta local · San Rafael</span>
      </header>
      <section className="hero">
        <p className="eyebrow">Antes de salir</p>
        <h1>¿Qué dice el cielo<br /><em>para tu ubicación?</em></h1>
        <p>Pronóstico horario de lluvia para decidir qué llevar. La precisión local en terreno montañoso aún no está validada.</p>
      </section>
      <div className="content-grid">
        <section className="panel controls" aria-labelledby="location-title">
          <div className="section-heading"><span className="section-number">01</span><h2 id="location-title">Lugar y periodo</h2></div>
          <label htmlFor="saved-location">Ubicación</label>
          <select id="saved-location" value={selectedId} onChange={(event) => void selectLocation(event.target.value)}>
            {locations.map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}
          </select>
          <p className="coordinate">{selected.point.lat.toFixed(5)}, {selected.point.lon.toFixed(5)}</p>
          {storageStatus && <p className="helper" role="status">{storageStatus}</p>}
          <button type="button" className="secondary-button" onClick={useGeolocation}>Usar ubicación del dispositivo</button>
          <p className="helper" role="status">{geoStatus}</p>
          <details className="manual-entry"><summary>Agregar coordenadas manualmente</summary>
            <form onSubmit={(event) => { event.preventDefault(); const point = pointSchema.safeParse({ lat: Number(manual.lat), lon: Number(manual.lon) }); if (!point.success || !manual.name.trim() || !manual.lat.trim() || !manual.lon.trim()) { setStatus("Escribe un nombre y coordenadas válidas."); return; } void addLocation({ id: crypto.randomUUID(), name: manual.name.trim().slice(0, 60), point: point.data, createdAt: new Date().toISOString() }); setManual({ name: "", lat: "", lon: "" }); }}>
              <label htmlFor="place-name">Nombre</label><input id="place-name" required maxLength={60} value={manual.name} onChange={(event) => setManual({ ...manual, name: event.target.value })} placeholder="Casa" />
              <div className="field-pair"><div><label htmlFor="lat">Latitud</label><input id="lat" required type="number" step="any" min={-90} max={90} value={manual.lat} onChange={(event) => setManual({ ...manual, lat: event.target.value })} placeholder="19.2133" /></div>
                <div><label htmlFor="lon">Longitud</label><input id="lon" required type="number" step="any" min={-180} max={180} value={manual.lon} onChange={(event) => setManual({ ...manual, lon: event.target.value })} placeholder="-98.7555" /></div></div>
              <button type="submit" className="secondary-button">Guardar ubicación</button>
            </form>
          </details>
          <fieldset className="period-picker"><legend>Periodo desde ahora</legend>
            {[60, 180, 360].map((duration) => <button key={duration} type="button" aria-pressed={minutes === duration} onClick={() => void selectDuration(duration)}>{duration === 60 ? "1 hora" : duration === 180 ? "3 horas" : "6 horas"}</button>)}
          </fieldset>
          <form className="custom-period" onSubmit={(event) => { event.preventDefault(); const duration = Number(customMinutes); if (Number.isInteger(duration) && duration >= 30 && duration <= 360) void selectDuration(duration); }}>
            <label htmlFor="custom-minutes">O indica cuándo termina tu exposición</label>
            <div className="custom-period-row"><input id="custom-minutes" type="number" min={30} max={360} step={1} value={customMinutes} onChange={(event) => setCustomMinutes(event.target.value)} aria-describedby="custom-minutes-help" />
              <button type="submit" className="secondary-button">Consultar</button></div>
            <p id="custom-minutes-help" className="helper">Minutos desde ahora, entre 30 y 360.</p>
          </form>
        </section>
        <section className="panel forecast" aria-labelledby="forecast-title">
          <div className="section-heading"><span className="section-number">02</span><h2 id="forecast-title">Pronóstico local</h2></div>
          <p className="status-line" role="status">{status}</p>
          {result && safeAssessment ? <>
            <div className={`recommendation ${safeAssessment.state}`}><span className="recommendation-kicker">{safeAssessment.state === "insufficient-data" ? "Datos limitados" : "Orientación"}</span>
              <h3>{safeAssessment.message}</h3><p>{safeAssessment.reason}</p></div>
            <p className="meta">Periodo solicitado: {formatTime(result.period.start)} – {formatTime(result.period.end)}. Fuente: Open-Meteo, pronóstico horario best_match. Consulta: {retrievedAt ? formatTime(retrievedAt) : "sin fecha"}.</p>
            {safeAssessment.state === "rain-signal" && <p className="rain-hours">Horas con señal de lluvia: {safeAssessment.rows.filter((row) => (row.amountMm ?? 0) > 0 || (row.probability ?? 0) >= 0.5).map((row) => `${formatHour(row.period.start)}–${formatHour(row.period.end)}`).join(", ")}.</p>}
            <div className="hourly-list" aria-label="Detalle por hora"><div className="hourly-head"><span>Hora de validez</span><span>Prob.</span><span>Lluvia</span></div>
              {safeAssessment.rows.map((row) => <div className="hourly-row" key={row.period.start}><span>{formatHour(row.period.start)}–{formatHour(row.period.end)}</span><strong>{row.probability === null ? "Sin dato" : `${Math.round(row.probability * 100)} %`}</strong><span>{row.amountMm === null ? "Sin dato" : `${row.amountMm.toFixed(1)} mm`}{row.meanRateMmH === null ? "" : <small> · {row.meanRateMmH.toFixed(1)} mm/h media</small>}</span></div>)}
            </div>
            <p className="footnote">Cada probabilidad corresponde a más de 0.1 mm en la hora mostrada. Los mm son acumulación de esa hora; mm/h es su intensidad media. Las horas que se cruzan con el periodo elegido se muestran completas. No se estima inicio o fin al minuto.</p>
            {point && <><p className="footnote">Cuadrícula utilizada: {point.resolvedPoint ? `${point.resolvedPoint.lat.toFixed(3)}, ${point.resolvedPoint.lon.toFixed(3)}` : "desconocida"}. Resolución espacial y hora de emisión: no informadas en esta respuesta.</p>
              {point.warnings.length > 0 && <details className="limitations"><summary>Límites de estos datos</summary><ul>{point.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}</>}
          </> : <div className="empty-state">La consulta aparecerá aquí cuando haya datos disponibles.</div>}
          <button type="button" className="primary-button" disabled={pending} onClick={() => void fetchForecast(selected, minutes)}>{pending ? "Consultando…" : "Actualizar pronóstico"}</button>
        </section>
      </div>
      <footer className="app-footer"><p>Pronóstico provisional para uso personal. Una señal de lluvia no mide la seguridad del camino ni el estado del pavimento.</p>
        <p className="install-instructions">{installPrompt ? <button type="button" className="text-button" onClick={() => void install()}>Instalar aplicación</button> : "Para instalar: en iPhone, Compartir → Añadir a pantalla de inicio; en otros navegadores, usa la opción Instalar del menú."}</p>
      </footer>
    </main>
  );
}
