import { describe, expect, it } from "vitest";
import { BASEMAPS, DEFAULT_BASEMAP, SELECTABLE_BASEMAPS } from "./basemaps";

describe("catálogo de mapas-base", () => {
  it("expõe World Imagery e os dois tiles Esri legados verificáveis", () => {
    expect(DEFAULT_BASEMAP.id).toBe("esri-imagery");
    expect(SELECTABLE_BASEMAPS.map((basemap) => basemap.id)).toEqual(["esri-imagery", "esri-light-gray", "esri-dark-gray"]);
    expect(SELECTABLE_BASEMAPS.every((basemap) => basemap.url?.startsWith("https://server.arcgisonline.com/"))).toBe(true);
    expect(SELECTABLE_BASEMAPS.filter((basemap) => basemap.availability === "legacy-available").map((basemap) => basemap.id)).toEqual(["esri-light-gray", "esri-dark-gray"]);
  });

  it("não habilita OSM/OpenTopo como fallback público", () => {
    const restricted = BASEMAPS.filter((basemap) => basemap.availability === "requires-approved-provider");
    expect(restricted.map((basemap) => basemap.id)).toEqual(["osm-approved-provider", "opentopo-approved-provider"]);
    expect(restricted.every((basemap) => !basemap.url)).toBe(true);
  });
});
