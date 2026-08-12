"use client";

import { CircleAlert, Construction, ExternalLink, MapPin, Route } from "lucide-react";
import { MapPanel } from "@/components/map-panel";
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, SelectInput } from "@/components/ui";
import { api } from "@/lib/api/client";
import type { MapFeature, RoadOption } from "@/lib/api/types";
import { formatChainage } from "@/lib/format";
import { allMapFeatures, featuresForLayer, formatRoadLength, MAP_LAYER_DEFINITIONS } from "@/lib/map-data";
import { useApiResource } from "@/lib/use-api-resource";
import { useState } from "react";

function FeatureIcon({ layer }: { layer: MapFeature["layer"] }) {
  if (layer === "ELEMENT") return <MapPin aria-hidden="true" />;
  if (layer === "DEFECT") return <CircleAlert aria-hidden="true" />;
  return <Construction aria-hidden="true" />;
}

function MapFeatureRow({ feature, tone }: { feature: MapFeature; tone: "success" | "danger" | "info" }) {
  const osmUrl = `https://www.openstreetmap.org/?mlat=${feature.latitude}&mlon=${feature.longitude}#map=16/${feature.latitude}/${feature.longitude}`;
  return (
    <article>
      <span className={`map-list-icon map-list-icon--${feature.layer.toLowerCase()}`}><FeatureIcon layer={feature.layer} /></span>
      <div>
        <strong>{feature.locationLabel}</strong>
        <p>{feature.kindLabel}</p>
        <small>{feature.latitude.toFixed(5)}, {feature.longitude.toFixed(5)}</small>
      </div>
      <div>
        <Badge tone={tone}>{feature.stateLabel}</Badge>
        <a href={osmUrl} target="_blank" rel="noreferrer" aria-label={`${feature.locationLabel} manzilini OpenStreetMap’da ochish`}>
          <ExternalLink aria-hidden="true" />
        </a>
      </div>
    </article>
  );
}

function RoadMapWorkspace({ roads }: { roads: RoadOption[] }) {
  const [selectedRoadId, setSelectedRoadId] = useState(roads[0]!.id);
  const { data, error, loading, reload } = useApiResource(
    () => api.mapData(selectedRoadId),
    `road-map-data:${selectedRoadId}`,
  );

  return (
    <>
      <Card>
        <SelectInput label="Xaritadagi yo‘l" name="mapRoadId" value={selectedRoadId} disabled onChange={(event) => setSelectedRoadId(event.target.value)}>
          {roads.map((road) => <option value={road.id} key={road.id}>{road.code} · {road.name}</option>)}
        </SelectInput>
      </Card>
      {loading ? <LoadingState label="Yo‘l xaritasi yuklanmoqda" /> : error ? <ErrorState error={error} retry={reload} /> : data ? (
        <>
          <Card className="map-road-summary">
            <div className="map-road-summary__identity"><span><Route aria-hidden="true" /></span><div><strong>{data.road.code} · {data.road.name}</strong><small>YTPdan sinxronlangan to‘liq yo‘l</small></div></div>
            <dl>
              <div><dt>Uzunligi</dt><dd>{formatRoadLength(data.road.lengthM)}</dd></div>
              <div><dt>Piketaj oralig‘i</dt><dd>0+000 — {formatChainage(data.road.lengthM)}</dd></div>
              <div><dt>Belgilangan piketlar</dt><dd>{data.road.chainageMarkers.length} ta</dd></div>
              <div><dt>Xarita yozuvlari</dt><dd>{allMapFeatures(data).length} ta</dd></div>
            </dl>
          </Card>
          <div className="map-layout">
            <Card className="map-card"><MapPanel data={data} /></Card>
            <Card className="map-records">
              <div className="map-records__heading"><div><h2>Qatlam yozuvlari</h2><p>Har bir yozuv {data.road.code} yo‘li va piketajiga bog‘langan.</p></div><Badge tone="info">{allMapFeatures(data).length} ta</Badge></div>
              {MAP_LAYER_DEFINITIONS.map((definition) => {
                const features = featuresForLayer(data, definition.key);
                return (
                  <section className="map-record-group" key={definition.key}>
                    <header><span><i style={{ backgroundColor: definition.color }} />{definition.label}</span><small>{features.length}</small></header>
                    {features.length ? features.map((feature) => <MapFeatureRow feature={feature} tone={definition.badgeTone} key={feature.id} />) : <p className="map-record-group__empty">Bu qatlamda yozuv yo‘q.</p>}
                  </section>
                );
              })}
            </Card>
          </div>
        </>
      ) : null}
    </>
  );
}

export default function MapPage() {
  const roads = useApiResource(api.roads, "map-roads");

  return (
    <div className="page-stack">
      <PageHeader title="D001 yo‘l xaritasi" description="YTPdan sinxronlangan 0+000–67+000 oralig‘idagi to‘liq yo‘l chizig‘i, elementlari, nuqsonlari va ish zonalari." />
      {roads.loading ? <LoadingState label="D001 yuklanmoqda" /> : roads.error ? <ErrorState error={roads.error} retry={roads.reload} /> : roads.data?.items.length ? <RoadMapWorkspace roads={roads.data.items} /> : <EmptyState title="D001 topilmadi" detail="YTP integratsiyasida yagona faol D001 yo‘li 67 000 metr uzunlikda va LineString geometriya bilan bo‘lishi kerak." />}
    </div>
  );
}
