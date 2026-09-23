"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SiteHeader from "@/components/site-header";
import { pointSchema, periodSchema } from "@/domain/provider-common";
import type { Period, Point } from "@/domain/provider-common";
import { weatherResponseSchema } from "@/domain/weather/contracts";
import type { WeatherResponse } from "@/domain/weather/contracts";
import { assessLocalForecast } from "@/domain/weather/local";
import { describeHourlyRain } from "@/domain/weather/intensity";
import { loadLocalState, loadSnapshot, saveLocation, savePreferences, saveSnapshot } from "@/client/storage/local";
import type { SavedLocation } from "@/client/storage/local";

const home: SavedLocation = {
  id: "san-rafael", name: "San Rafael, Tlalmanalco",
  point: { lat: 19.213346433905848, lon: -98.75547014144284 }, createdAt: "2026-09-22T00:00:00Z",
};
type Result = { forecast: WeatherResponse; period: Period; previous: boolean };
const formatTime = (value: string) => new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const formatHour = (value: string) => new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const snapshotId = (locationId: string) => `${locationId}:hourly`;
const HOUR_MS = 3_600_000;
const formatDay = (value: string) => new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", weekday: "short", day: "numeric" }).format(new Date(value));
const formatAmount = (value: number | null) => value === null ? "—" : value > 0 && value < 0.05 ? "<0.1 mm" : `${value.toFixed(1)} mm`;
function distanceKm(a: Point, b: Point) {
  const radians = Math.PI / 180;
  const latitudeDifference = (b.lat - a.lat) * radians;
  const longitudeDifference = (b.lon - a.lon) * radians;
  const squareHalfChord = Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(longitudeDifference / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(squareHalfChord));
}

export default function LocalWeather() {
  const [locations, setLocations] = useState<SavedLocation[]>([home]);
  const [selectedId, setSelectedId] = useState(home.id);
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState("Preparando consulta…");
  const [pending, setPending] = useState(false);
  const [manual, setManual] = useState({ name: "", lat: "", lon: "" });
  const [manualStatus, setManualStatus] = useState("");
  const [geoStatus, setGeoStatus] = useState("");
  const [storageStatus, setStorageStatus] = useState("");
  const [clock, setClock] = useState(0);
  const requestNumber = useRef(0);

  const fetchForecast = useCallback(async (location: SavedLocation) => {
    const currentRequest = ++requestNumber.current;
    setPending(true);
    setStatus("Actualizando pronóstico…");
    try {
      const query = new URLSearchParams({ lat: String(location.point.lat), lon: String(location.point.lon), view: "hourly" });
      const response = await fetch(`/api/weather?${query}`, { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(typeof body === "object" && body !== null && "error" in body ? String(body.error) : "No se pudo consultar el clima");
      if (typeof body !== "object" || body === null || !("forecast" in body) || !("period" in body)) throw new Error("La respuesta meteorológica es inválida");
      const forecast = weatherResponseSchema.parse(body.forecast);
      const period = periodSchema.parse(body.period);
      if (currentRequest !== requestNumber.current) return;
      setResult({ forecast, period, previous: false });
      setClock(Date.now());
      setStatus("Pronóstico actualizado");
      try { await saveSnapshot({ id: snapshotId(location.id), forecast, period }); } catch { setStatus("Pronóstico actualizado; no se pudo guardar para abrir sin conexión."); }
    } catch (error) {
      const snapshot = await loadSnapshot(snapshotId(location.id)).catch(() => null);
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
      setLocations(available); setSelectedId(selected.id);
      void fetchForecast(selected);
    }).catch(() => { if (active) { setStatus("No se pudo abrir el almacenamiento local."); void fetchForecast(home); } });
    return () => { active = false; };
  }, [fetchForecast]);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    }
    const interval = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const selected = locations.find((location) => location.id === selectedId) ?? home;
  useEffect(() => {
    if (!result || result.previous || pending) return;
    const requestedHour = Date.parse(result.period.start) + 2 * HOUR_MS;
    const timeout = window.setTimeout(() => void fetchForecast(selected), Math.max(0, requestedHour + HOUR_MS - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [fetchForecast, pending, result, selected]);
  const point = result?.forecast.points[0];
  const assessmentPeriod = result ? { start: new Date(Date.parse(result.period.start) + 2 * HOUR_MS).toISOString(), end: result.period.end } : null;
  const assessment = result && point && assessmentPeriod ? assessLocalForecast(point, assessmentPeriod, clock) : null;
  const safeAssessment = result?.previous && assessment ? { ...assessment, state: "insufficient-data" as const,
    message: "Pronóstico anterior, sin recomendación actual", reason: "Se necesita una consulta nueva para decidir la salida." } : assessment;
  const retrievedAt = point?.values[0]?.retrievedAt;
  const probabilityEvent = point?.values.find((value) => value.variable === "precipitationProbability")?.probabilityEvent;
  const source = result ? `${result.forecast.provider}, ${point?.values[0]?.product ?? "producto no informado"}` : "desconocida";
  const hourlyRows = result && safeAssessment ? Array.from({ length: 13 }, (_, index) => {
    const start = new Date(Date.parse(result.period.start) + index * HOUR_MS).toISOString();
    const row = safeAssessment.rows.find((item) => item.period.start === start);
    return { start, end: new Date(Date.parse(start) + HOUR_MS).toISOString(), offset: index - 2, row };
  }) : [];

  async function selectLocation(id: string) {
    const location = locations.find((item) => item.id === id) ?? home;
    setSelectedId(id); setResult(null);
    await savePreferences({ selectedLocationId: id }).catch(() => setStorageStatus("No se pudo guardar la preferencia en este dispositivo."));
    void fetchForecast(location);
  }

  async function addLocation(location: SavedLocation) {
    setLocations((current) => [...current, location]);
    setSelectedId(location.id); setResult(null);
    setStorageStatus(""); setManualStatus("");
    try {
      await saveLocation(location);
      await savePreferences({ selectedLocationId: location.id });
    } catch { setStorageStatus("No se pudo guardar la ubicación en este dispositivo; puedes consultarla ahora."); }
    void fetchForecast(location);
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

  return (
    <main className="app-shell">
      <SiteHeader section="local" />
      <div className="weather-content">
        <section className="hero weather-hero">
          <h1>Lluvia por hora</h1>
          <p>{result?.previous ? `Consulta guardada del ${formatTime(new Date(Date.parse(result.period.start) + 2 * HOUR_MS).toISOString())}` : "De hace 2 horas a las próximas 10."}</p>
        </section>
        <section className="location-controls" aria-labelledby="location-title">
          <div className="location-main">
            <div className="location-select">
              <label id="location-title" htmlFor="saved-location">Ubicación</label>
              <select id="saved-location" value={selectedId} onChange={(event) => void selectLocation(event.target.value)}>
                {locations.map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}
              </select>
            </div>
            <button type="button" className="secondary-button" onClick={useGeolocation}>Usar mi ubicación</button>
          </div>
          <details className="manual-entry"><summary>Agregar ubicación con coordenadas</summary>
            <form onSubmit={(event) => { event.preventDefault(); const point = pointSchema.safeParse({ lat: Number(manual.lat), lon: Number(manual.lon) }); if (!point.success || !manual.name.trim() || !manual.lat.trim() || !manual.lon.trim()) { setManualStatus("Escribe un nombre y coordenadas válidas."); return; } void addLocation({ id: crypto.randomUUID(), name: manual.name.trim().slice(0, 60), point: point.data, createdAt: new Date().toISOString() }); setManual({ name: "", lat: "", lon: "" }); }}>
              <label htmlFor="place-name">Nombre</label><input id="place-name" required maxLength={60} value={manual.name} onChange={(event) => setManual({ ...manual, name: event.target.value })} placeholder="Casa" />
              <div className="field-pair"><div><label htmlFor="lat">Latitud</label><input id="lat" required type="number" step="any" min={-90} max={90} value={manual.lat} onChange={(event) => setManual({ ...manual, lat: event.target.value })} placeholder="19.2133" /></div>
                <div><label htmlFor="lon">Longitud</label><input id="lon" required type="number" step="any" min={-180} max={180} value={manual.lon} onChange={(event) => setManual({ ...manual, lon: event.target.value })} placeholder="-98.7555" /></div></div>
              <button type="submit" className="secondary-button">Guardar ubicación</button>
              {manualStatus && <p className="helper" role="alert">{manualStatus}</p>}
            </form>
          </details>
          {geoStatus && <p className="helper" role="status">{geoStatus}</p>}
          {storageStatus && <p className="helper" role="status">{storageStatus}</p>}
        </section>
        <section className="forecast weather-forecast" aria-labelledby="forecast-title">
          <div className="weather-heading"><h2 id="forecast-title">Pronóstico en {selected.name}</h2><span>Hora local</span></div>
          <p className="status-line" role="status">{status}</p>
          {result && safeAssessment ? <>
            <div className={`recommendation ${safeAssessment.state}`}>
              <h3>{safeAssessment.message}</h3><p>{safeAssessment.reason}</p>
            </div>
            <p className="meta">Actualizado {retrievedAt ? formatTime(retrievedAt) : "sin fecha"} · {result.forecast.provider}</p>
            <table className="hourly-table" aria-label="Pronóstico por hora">
              <thead><tr><th scope="col">Hora</th><th scope="col">Prob.</th><th scope="col">Lluvia</th><th scope="col">Qué esperar</th></tr></thead>
              <tbody>{hourlyRows.map(({ start, end, offset, row }) => <tr className={offset === 0 ? "current-hour" : undefined} key={start}>
                <th scope="row"><strong className="hour-label">{result.previous ? (offset === 0 ? "Hora de consulta" : `${offset > 0 ? "+" : ""}${offset} h`) : offset === 0 ? "Ahora" : offset < 0 ? `Hace ${-offset} h` : `En ${offset} h`}</strong><small>{formatDay(start)} · {formatHour(start)}–{formatHour(end)}</small></th>
                <td>{row?.probability == null ? "—" : `${Math.round(row.probability * 100)} %`}</td>
                <td>{formatAmount(row?.amountMm ?? null)}</td>
                <td className="rain-description">{describeHourlyRain(row?.amountMm ?? null, row?.probability ?? null)}</td>
              </tr>)}</tbody>
            </table>
            <p className="footnote">Las horas anteriores son pronósticos, no observaciones. «—» indica que no hay dato.</p>
            <details className="forecast-details"><summary>Sobre estos datos</summary>
              <p>Fuente: {source}. Probabilidad de {probabilityEvent?.description.toLowerCase() ?? "precipitación durante esa hora"}. Los mm son acumulación por hora.</p>
              <p>La descripción usa esa acumulación como intensidad media orientativa: ligera (&lt;2.5 mm), moderada (2.5–&lt;10 mm), fuerte (10–&lt;50 mm) y muy intensa (≥50 mm). No indica picos, truenos ni el minuto de inicio.</p>
              {point && <><p>Cuadrícula: {point.resolvedPoint ? `${point.resolvedPoint.lat.toFixed(3)}, ${point.resolvedPoint.lon.toFixed(3)} (a ${distanceKm(point.requestedPoint, point.resolvedPoint).toFixed(1)} km)` : "desconocida"}. La precisión local en montaña aún no está validada.</p>
                {point.warnings.length > 0 && <ul>{point.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}</>}
            </details>
          </> : <div className="empty-state">{pending ? "Cargando pronóstico horario…" : "Sin pronóstico disponible."}</div>}
          <button type="button" className="primary-button" disabled={pending} onClick={() => void fetchForecast(selected)}>{pending ? "Consultando…" : "Actualizar pronóstico"}</button>
        </section>
      </div>
    </main>
  );
}
