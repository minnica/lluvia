"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Point } from "@/domain/provider-common";
import type { SegmentAssessment } from "@/domain/routing/exposure";
import "maplibre-gl/dist/maplibre-gl.css";

type Props = { keyValue: string; points: Point[]; segments: SegmentAssessment[]; selectedId: string | null;
  onPick: (point: Point) => void; onSelect: (id: string) => void };

// Equivalentes sRGB de los tokens dark neutral de shadcn; MapLibre necesita colores literales.
const mapColors = { rain: "#ff2056", dry: "#00bc7d", unknown: "#a1a1a1", marker: "#171717", markerText: "#e5e5e5" };

export default function RouteMap({ keyValue, points, segments, selectedId, onPick, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const lastGeometry = useRef<{ points: Point[]; segments: SegmentAssessment[] } | null>(null);
  const [ready, setReady] = useState(false);
  const pick = useRef(onPick);
  const select = useRef(onSelect);
  useEffect(() => { pick.current = onPick; select.current = onSelect; }, [onPick, onSelect]);

  useEffect(() => {
    if (!container.current || !keyValue) return;
    let active = true;
    let instance: MapLibreMap | null = null;
    void import("maplibre-gl").then(({ default: maplibregl }) => {
      if (!active || !container.current) return;
      instance = new maplibregl.Map({
        container: container.current,
        center: [-98.75547, 19.21335], zoom: 11,
        style: { version: 8,
          sources: { tomtom: { type: "raster", tiles: [`https://a.api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=${encodeURIComponent(keyValue)}&language=es-MX`],
            tileSize: 256, attribution: '© <a href="https://www.tomtom.com/" target="_blank" rel="noopener noreferrer">TomTom</a>' } },
          layers: [{ id: "base", type: "raster", source: "tomtom" }] },
      });
      map.current = instance;
      instance.on("load", () => setReady(true));
      instance.on("click", (event) => {
        const features = instance?.getLayer("route-lines") ? instance.queryRenderedFeatures(event.point, { layers: ["route-lines"] }) : [];
        const id = features[0]?.properties?.id;
        if (typeof id === "string") select.current(id);
        else pick.current({ lat: event.lngLat.lat, lon: event.lngLat.lng });
      });
    });
    return () => { active = false; instance?.remove(); map.current = null; setReady(false); };
  }, [keyValue]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    const update = () => {
      const features: GeoJSON.Feature<GeoJSON.LineString>[] = segments.map((item) => ({
        type: "Feature", properties: { id: item.segment.id, state: item.state,
          selected: item.segment.id === selectedId },
        geometry: { type: "LineString", coordinates: item.segment.geometry },
      }));
      const collection: GeoJSON.FeatureCollection<GeoJSON.LineString> = { type: "FeatureCollection", features };
      const source = instance.getSource("route") as import("maplibre-gl").GeoJSONSource | undefined;
      if (source) source.setData(collection);
      else {
        instance.addSource("route", { type: "geojson", data: collection });
        instance.addLayer({ id: "route-lines", type: "line", source: "route",
          paint: { "line-color": ["match", ["get", "state"], "rain-signal", mapColors.rain, "no-rain-signal", mapColors.dry, mapColors.unknown],
            "line-width": ["case", ["get", "selected"], 8, 5], "line-opacity": 0.9 } });
      }
      const pointFeatures: GeoJSON.Feature<GeoJSON.Point>[] = points.map((point, index) => ({
        type: "Feature", properties: { label: index === 0 ? "O" : index === points.length - 1 ? "D" : `${index}` },
        geometry: { type: "Point", coordinates: [point.lon, point.lat] },
      }));
      const pointCollection: GeoJSON.FeatureCollection<GeoJSON.Point> = { type: "FeatureCollection", features: pointFeatures };
      const markerSource = instance.getSource("waypoints") as import("maplibre-gl").GeoJSONSource | undefined;
      if (markerSource) markerSource.setData(pointCollection);
      else {
        instance.addSource("waypoints", { type: "geojson", data: pointCollection });
        instance.addLayer({ id: "waypoint-circles", type: "circle", source: "waypoints", paint: {
          "circle-radius": 11, "circle-color": mapColors.marker, "circle-stroke-width": 2, "circle-stroke-color": mapColors.markerText } });
        instance.addLayer({ id: "waypoint-labels", type: "symbol", source: "waypoints",
          layout: { "text-field": ["get", "label"], "text-size": 11 }, paint: { "text-color": mapColors.markerText } });
      }
      const coordinates = segments.length ? segments.flatMap((item) => item.segment.geometry) : points.map((point) => [point.lon, point.lat]);
      if (coordinates.length > 1 && (lastGeometry.current?.points !== points || lastGeometry.current?.segments !== segments)) {
        const west = Math.min(...coordinates.map((item) => item[0]));
        const east = Math.max(...coordinates.map((item) => item[0]));
        const south = Math.min(...coordinates.map((item) => item[1]));
        const north = Math.max(...coordinates.map((item) => item[1]));
        instance.fitBounds([[west, south], [east, north]], { padding: 42, maxZoom: 14, duration: 0 });
      }
      lastGeometry.current = { points, segments };
    };
    if (instance.isStyleLoaded()) update(); else instance.once("load", update);
    return () => { instance.off("load", update); };
  }, [points, segments, selectedId, ready]);

  if (!keyValue) return <div className="map-fallback">Mapa no configurado. Puedes introducir coordenadas y analizar el recorrido.</div>;
  return <div ref={container} className="route-map" role="application" aria-label="Mapa de recorrido. Selecciona el campo origen, destino o parada y toca un punto." />;
}
