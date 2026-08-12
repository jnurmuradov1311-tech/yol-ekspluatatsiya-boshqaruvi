"use client";

import { useEffect, useRef, useState } from "react";
import type { MapFeature, RoadMapData } from "@/lib/api/types";
import { DEFAULT_OSM_MAP_STYLE, featuresForLayer, MAP_LAYER_DEFINITIONS } from "@/lib/map-data";

const configuredMapStyleUrl = process.env.NEXT_PUBLIC_MAP_STYLE_URL?.trim();

function featureCollection(features: MapFeature[]) {
  return {
    type: "FeatureCollection" as const,
    features: features.map((feature) => ({
      type: "Feature" as const,
      properties: {
        id: feature.id,
        locationLabel: feature.locationLabel,
        kindLabel: feature.kindLabel,
        stateLabel: feature.stateLabel,
        latitude: feature.latitude,
        longitude: feature.longitude,
      },
      geometry: {
        type: "Point" as const,
        coordinates: [feature.longitude, feature.latitude],
      },
    })),
  };
}

export function MapPanel({ data }: { data: RoadMapData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fatalError, setFatalError] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let map: import("maplibre-gl").Map | undefined;
    let fallbackAttempted = !configuredMapStyleUrl;
    setFatalError("");
    setNotice("");
    setReady(false);

    void import("maplibre-gl").then((maplibregl) => {
      if (disposed || !containerRef.current) return;
      const [southWest, northEast] = data.road.bounds;

      const activeMap = new maplibregl.Map({
        container: containerRef.current,
        style: configuredMapStyleUrl || DEFAULT_OSM_MAP_STYLE,
        center: [
          (southWest[0] + northEast[0]) / 2,
          (southWest[1] + northEast[1]) / 2,
        ],
        zoom: 8,
        cooperativeGestures: true,
        attributionControl: false,
      });
      map = activeMap;
      activeMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      activeMap.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");
      activeMap.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

      for (const marker of data.road.chainageMarkers) {
        const markerElement = document.createElement("button");
        markerElement.className = "map-chainage-marker";
        markerElement.type = "button";
        markerElement.textContent = marker.label;
        markerElement.setAttribute("aria-label", `${data.road.code} ${marker.label} piketaji`);
        new maplibregl.Marker({ element: markerElement, anchor: "center" })
          .setLngLat([marker.longitude, marker.latitude])
          .setPopup(new maplibregl.Popup({ offset: 12 }).setText(`${data.road.code} · ${marker.label}`))
          .addTo(activeMap);
      }

      activeMap.fitBounds(data.road.bounds, {
        padding: { top: 58, right: 58, bottom: 58, left: 58 },
        maxZoom: 12,
        duration: 0,
      });

      activeMap.on("style.load", () => {
        if (disposed) return;

        if (!activeMap.getSource("selected-road")) {
          activeMap.addSource("selected-road", {
            type: "geojson",
            data: {
              type: "Feature",
              properties: { code: data.road.code, lengthM: data.road.lengthM },
              geometry: data.road.geometry,
            },
          });
          activeMap.addLayer({
            id: "selected-road-casing",
            type: "line",
            source: "selected-road",
            paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.95 },
          });
          activeMap.addLayer({
            id: "selected-road-line",
            type: "line",
            source: "selected-road",
            paint: { "line-color": "#073451", "line-width": 4, "line-opacity": 0.96 },
          });
        }

        for (const definition of MAP_LAYER_DEFINITIONS) {
          const features = featuresForLayer(data, definition.key);
          activeMap.addSource(definition.sourceId, {
            type: "geojson",
            data: featureCollection(features),
          });
          activeMap.addLayer({
            id: definition.layerId,
            type: "circle",
            source: definition.sourceId,
            paint: {
              "circle-color": definition.color,
              "circle-radius": definition.radius,
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 2,
            },
          });
          activeMap.on("click", definition.layerId, (event) => {
            const properties = event.features?.[0]?.properties;
            if (!properties) return;
            new maplibregl.Popup({ offset: 12 })
              .setLngLat([Number(properties.longitude), Number(properties.latitude)])
              .setText(`${String(properties.locationLabel)} · ${String(properties.kindLabel)} · ${String(properties.stateLabel)}`)
              .addTo(activeMap);
          });
          activeMap.on("mouseenter", definition.layerId, () => {
            activeMap.getCanvas().style.cursor = "pointer";
          });
          activeMap.on("mouseleave", definition.layerId, () => {
            activeMap.getCanvas().style.cursor = "";
          });
        }

        setReady(true);
      });

      activeMap.on("error", () => {
        if (configuredMapStyleUrl && !fallbackAttempted && !activeMap.isStyleLoaded()) {
          fallbackAttempted = true;
          setNotice("Tashkilot xarita uslubi yuklanmadi. Ochiq xarita qatlami ishga tushirildi.");
          activeMap.setStyle(DEFAULT_OSM_MAP_STYLE);
          return;
        }
        if (!activeMap.isStyleLoaded()) {
          setFatalError(`Xarita asosini yuklab bo‘lmadi. ${data.road.code} geometriyasini ko‘rsatish uchun qayta urinib ko‘ring.`);
        }
      });
    }).catch(() => {
      if (!disposed) setFatalError("Xarita komponentini ishga tushirib bo‘lmadi.");
    });

    return () => {
      disposed = true;
      map?.remove();
    };
  }, [data]);

  return (
    <div className="map-panel">
      <div className="map-canvas" ref={containerRef} role="region" aria-label={`${data.road.code} to‘liq yo‘l xaritasi`} />
      {!ready && !fatalError ? <div className="map-loading" role="status">Xarita tayyorlanmoqda…</div> : null}
      {fatalError ? <div className="map-error inline-error" role="alert">{fatalError}</div> : null}
      {notice ? <div className="map-notice" role="status">{notice}</div> : null}
      <aside className="map-legend" aria-label="Xarita qatlamlari">
        <strong>Qatlamlar</strong>
        <span><i className="map-legend__road" /> {data.road.code} yo‘li</span>
        {MAP_LAYER_DEFINITIONS.map((definition) => (
          <span key={definition.key}><i style={{ backgroundColor: definition.color }} /> {definition.label}</span>
        ))}
        <span><i className="map-legend__chainage" /> Piketaj</span>
      </aside>
    </div>
  );
}
