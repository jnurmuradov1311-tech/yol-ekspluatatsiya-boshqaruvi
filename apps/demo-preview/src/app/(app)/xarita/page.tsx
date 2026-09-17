"use client";

import { CircleAlert, Construction, Eye, EyeOff, ExternalLink, Layers3, MapPin, Route, Search } from "lucide-react";
import { MapPanel } from "@/components/map-panel";
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, SelectInput } from "@/components/ui";
import { api } from "@/lib/api/client";
import type { MapFeature, RoadOption } from "@/lib/api/types";
import { formatChainage } from "@/lib/format";
import { allMapFeatures, featuresForLayer, formatRoadLength, MAP_LAYER_DEFINITIONS } from "@/lib/map-data";
import { useApiResource } from "@/lib/use-api-resource";
import { useState } from "react";
import { useOperatingScope } from "@/components/scope-provider";

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
  const [visibleLayers, setVisibleLayers] = useState<Set<MapFeature["layer"]>>(new Set(["ELEMENT", "DEFECT", "WORK_ZONE"]));
  const [layerQuery, setLayerQuery] = useState("");
  const { data, error, loading, reload } = useApiResource(
    () => api.mapData(selectedRoadId),
    `road-map-data:${selectedRoadId}`,
  );
  const selectedRoad = roads.find((road) => road.id === selectedRoadId) ?? roads[0]!;

  return (
    <>
      <Card className="map-workspace-header">
        <SelectInput label="Xaritadagi yo‘l" name="mapRoadId" value={selectedRoadId} onChange={(event) => setSelectedRoadId(event.target.value)}>
          {roads.map((road) => <option value={road.id} key={road.id}>{road.code} · {road.name}</option>)}
        </SelectInput>
        <span><Route aria-hidden="true" /><small>Uzunligi</small><strong>{formatRoadLength(selectedRoad.lengthM)}</strong></span><span><MapPin aria-hidden="true" /><small>Piketaj</small><strong>0+000 — {formatChainage(selectedRoad.lengthM)}</strong></span>
      </Card>
      {loading ? <LoadingState label="Yo‘l xaritasi yuklanmoqda" /> : error ? <ErrorState error={error} retry={reload} /> : data ? (
        <>
          <div className="map-layout">
            <Card className="map-card"><MapPanel data={data} visibleLayers={visibleLayers} /></Card>
            <Card className="map-records">
              <div className="map-records__heading"><div><h2><Layers3 size={19} /> Qatlam yozuvlari</h2><p>Har bir yozuv yo‘l va piketajiga bog‘langan.</p></div><Badge tone="info">{allMapFeatures(data).length} ta</Badge></div>
              <label className="layer-search"><Search size={17} /><input value={layerQuery} onChange={(event) => setLayerQuery(event.target.value)} placeholder="Qatlam qidirish..." aria-label="Qatlam qidirish" /></label>
              {MAP_LAYER_DEFINITIONS.map((definition) => {
                const normalizedQuery = layerQuery.trim().toLocaleLowerCase();
                const features = featuresForLayer(data, definition.key).filter((feature) => {
                  if (!normalizedQuery) return true;
                  return [feature.locationLabel, feature.kindLabel, feature.stateLabel]
                    .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
                });
                const visible = visibleLayers.has(definition.layer);
                return (
                  <section className="map-record-group" key={definition.key}>
                    <header><span><i style={{ backgroundColor: definition.color }} />{definition.label}</span><button type="button" className={visible ? "layer-toggle layer-toggle--on" : "layer-toggle"} aria-pressed={visible} aria-label={`${definition.label} qatlamini ${visible ? "yashirish" : "ko‘rsatish"}`} onClick={() => setVisibleLayers((current) => { const next = new Set(current); if (next.has(definition.layer)) next.delete(definition.layer); else next.add(definition.layer); return next; })}>{visible ? <Eye /> : <EyeOff />}</button></header>
                    {visible ? features.length ? features.map((feature) => <MapFeatureRow feature={feature} tone={definition.badgeTone} key={feature.id} />) : <p className="map-record-group__empty">{normalizedQuery ? "Qidiruvga mos yozuv topilmadi." : "Bu qatlamda yozuv yo‘q."}</p> : null}
                  </section>
                );
              })}
            </Card>
          </div>
          <div className="map-kpi-strip"><Card><CircleAlert /><span><strong>{data.layers.defects.length}</strong><small>Nuqsonlar</small></span></Card><Card><MapPin /><span><strong>{data.layers.elements.length}</strong><small>Yo‘l elementlari</small></span></Card><Card><Construction /><span><strong>{data.layers.workZones.length}</strong><small>Ish zonalari</small></span></Card><Card><Route /><span><strong>{formatRoadLength(data.road.lengthM)}</strong><small>Xaritadagi yo‘l</small></span></Card></div>
        </>
      ) : null}
    </>
  );
}

export default function MapPage() {
  const roads = useApiResource(api.roads, "map-roads");
  const { scope } = useOperatingScope();

  return (
    <div className="page-stack">
      <PageHeader title="Yo‘llar xaritasi" description={`${scope.shortName} doirasidagi yo‘llar, elementlar, nuqsonlar va ish zonalarining yagona fazoviy ko‘rinishi.`} />
      {roads.loading ? <LoadingState label="Yo‘llar yuklanmoqda" /> : roads.error ? <ErrorState error={roads.error} retry={roads.reload} /> : roads.data?.items.length ? <RoadMapWorkspace roads={roads.data.items} /> : <EmptyState title="Yo‘l geometriyasi topilmadi" detail="Tanlangan bo‘limga faol yo‘l kesimi va LineString geometriya biriktirilishi kerak." />}
    </div>
  );
}
