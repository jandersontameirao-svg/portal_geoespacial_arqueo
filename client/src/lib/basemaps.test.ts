import { describe, expect, it } from "vitest";
import { BASEMAPS, DEFAULT_BASEMAP, SELECTABLE_BASEMAPS } from "./basemaps";

const savedMapIds = [
  "esri-imagery",
  "esri-light-gray",
  "esri-dark-gray",
  "osm-approved-provider",
  "opentopo-approved-provider",
];

describe("catálogo de mapas-base", () => {
  it("preserva o fundo padrão e os cinco IDs históricos de mapas salvos", () => {
    expect(DEFAULT_BASEMAP.id).toBe("esri-imagery");
    expect(BASEMAPS.map((basemap) => basemap.id)).toEqual(savedMapIds);
    expect(SELECTABLE_BASEMAPS.map((basemap) => basemap.id)).toEqual(savedMapIds);
  });

  it("mantém World Imagery e os dois tiles Esri legados verificáveis", () => {
    const esri = SELECTABLE_BASEMAPS.slice(0, 3);
    expect(esri.every((basemap) => basemap.url?.startsWith("https://server.arcgisonline.com/"))).toBe(true);
    expect(SELECTABLE_BASEMAPS.filter((basemap) => basemap.availability === "legacy-available").map((basemap) => basemap.id)).toEqual(["esri-light-gray", "esri-dark-gray"]);
  });

  it("habilita OSM/OpenTopo como escolhas explícitas, nunca como fallback", () => {
    const community = BASEMAPS.slice(3);
    expect(community.map((basemap) => basemap.availability)).toEqual(["available", "available"]);
    expect(community.map((basemap) => basemap.url)).toEqual([
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://tile.opentopomap.org/{z}/{x}/{y}.png",
    ]);
    expect(community.every((basemap) => !Object.keys(basemap).some((key) => /fallback/i.test(key)))).toBe(true);
    expect(community.every((basemap) => basemap.description.includes("fallback") || basemap.description.includes("Sem troca automática"))).toBe(true);
  });

  it("declara limites diferentes e CORS anônimo sem tornar novos campos obrigatórios", () => {
    expect(BASEMAPS.slice(3).map((basemap) => [basemap.minZoom, basemap.maxZoom])).toEqual([[0, 19], [1, 17]]);
    expect(SELECTABLE_BASEMAPS.every((basemap) => basemap.crossOrigin === "anonymous")).toBe(true);
  });
});
