import { describe, expect, it } from "vitest";
import type { RoadMapData } from "./api/types";
import { allMapFeatures, DEFAULT_OSM_MAP_STYLE, formatRoadLength } from "./map-data";

const data = {
  road: {
    id: "road-d001",
    code: "D001",
    name: "Toshkent halqa avtomobil yo‘li",
    lengthM: 67000,
    geometry: { type: "LineString", coordinates: [[69.1, 41.1], [69.2, 41.2]] },
    bounds: [[69.1, 41.1], [69.2, 41.2]],
    chainageMarkers: [],
  },
  layers: {
    elements: [{ id: "e1", layer: "ELEMENT", locationLabel: "0+100", kindLabel: "Belgi", stateLabel: "Mavjud", latitude: 41.1, longitude: 69.1 }],
    defects: [{ id: "d1", layer: "DEFECT", locationLabel: "1+000", kindLabel: "Chuqur", stateLabel: "Tasdiqlangan", latitude: 41.15, longitude: 69.15 }],
    workZones: [{ id: "w1", layer: "WORK_ZONE", locationLabel: "2+000", kindLabel: "Ish zonasi", stateLabel: "Ishda", latitude: 41.2, longitude: 69.2 }],
  },
} satisfies RoadMapData;

describe("D001 map data", () => {
  it("keeps every backend layer in the displayed feature list", () => {
    expect(allMapFeatures(data).map((feature) => feature.id)).toEqual(["e1", "d1", "w1"]);
  });

  it("provides an attributed OSM raster fallback style", () => {
    expect(DEFAULT_OSM_MAP_STYLE.sources.openStreetMap).toMatchObject({
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    });
    expect(JSON.stringify(DEFAULT_OSM_MAP_STYLE)).toContain("OpenStreetMap contributors");
  });

  it("formats the complete D001 length in kilometres", () => {
    expect(formatRoadLength(data.road.lengthM)).toBe("67 km");
  });
});
