import type { StyleSpecification } from "maplibre-gl";
import type { MapFeature, RoadMapData } from "@/lib/api/types";

export const DEFAULT_OSM_MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    openStreetMap: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\" rel=\"noreferrer\">OpenStreetMap contributors</a>",
    },
  },
  layers: [
    { id: "fallback-background", type: "background", paint: { "background-color": "#e8f0f3" } },
    { id: "open-street-map", type: "raster", source: "openStreetMap" },
  ],
};

export const MAP_LAYER_DEFINITIONS = [
  { key: "elements", layer: "ELEMENT", label: "Yo‘l elementlari", sourceId: "road-elements", layerId: "road-elements-layer", color: "#087c78", radius: 6, badgeTone: "success" },
  { key: "defects", layer: "DEFECT", label: "Nuqsonlar", sourceId: "road-defects", layerId: "road-defects-layer", color: "#b42335", radius: 7, badgeTone: "danger" },
  { key: "workZones", layer: "WORK_ZONE", label: "Ish zonalari", sourceId: "road-work-zones", layerId: "road-work-zones-layer", color: "#096fa3", radius: 8, badgeTone: "info" },
] as const;

export type MapLayerKey = (typeof MAP_LAYER_DEFINITIONS)[number]["key"];

export function featuresForLayer(data: RoadMapData, key: MapLayerKey): MapFeature[] {
  return data.layers[key];
}

export function allMapFeatures(data: RoadMapData): MapFeature[] {
  return MAP_LAYER_DEFINITIONS.flatMap(({ key }) => featuresForLayer(data, key));
}

export function formatRoadLength(lengthM: number): string {
  return `${new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 1 }).format(lengthM / 1000)} km`;
}
