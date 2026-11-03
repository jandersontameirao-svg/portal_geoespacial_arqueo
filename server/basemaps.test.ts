import { describe, expect, it } from "vitest";
import {
  BASEMAPS,
  DEFAULT_BASEMAP,
  SELECTABLE_BASEMAPS,
  type BasemapDefinition,
} from "../client/src/lib/basemaps";

const historicalIds = [
  "esri-imagery",
  "esri-light-gray",
  "esri-dark-gray",
  "osm-approved-provider",
  "opentopo-approved-provider",
];

// Testes deliberadamente offline: importam apenas dados, sem rede, DOM ou env.
describe("catálogo explícito de fundos cartográficos", () => {
  it("preserva os IDs históricos e a ordem para mapas salvos", () => {
    expect(BASEMAPS.map((basemap) => basemap.id)).toEqual(historicalIds);
    expect(new Set(BASEMAPS.map((basemap) => basemap.id)).size).toBe(5);
    expect(DEFAULT_BASEMAP).toBe(BASEMAPS[0]);
    expect(DEFAULT_BASEMAP.id).toBe("esri-imagery");
  });

  it("disponibiliza os cinco fundos solicitados sem nova aprovação genérica", () => {
    expect(SELECTABLE_BASEMAPS.map((basemap) => basemap.id)).toEqual(historicalIds);
    expect(SELECTABLE_BASEMAPS.every((basemap) => !!basemap.url)).toBe(true);
    expect(BASEMAPS.find((basemap) => basemap.id === "osm-approved-provider")?.availability).toBe("available");
    expect(BASEMAPS.find((basemap) => basemap.id === "opentopo-approved-provider")?.availability).toBe("available");
  });

  it("mantém exatamente os endpoints Esri existentes e sua ordem de coordenadas", () => {
    expect(BASEMAPS.slice(0, 3).map((basemap) => basemap.url)).toEqual([
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    ]);
  });

  it("usa o endpoint HTTPS exato exigido pela política raster OSM", () => {
    const osm = BASEMAPS.find((basemap) => basemap.id === "osm-approved-provider")!;
    expect(osm.url).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(osm.licenseUrl).toBe("https://operations.osmfoundation.org/policies/tiles/");
    expect(osm.attribution).toContain("© OpenStreetMap contributors");
    expect(osm.description).toMatch(/Referer/);
    expect(osm.description).toMatch(/cache HTTP/);
    expect(osm.description).toMatch(/sem SLA/);
    expect(osm.description).toMatch(/não usar.*prefetch.*offline/);
  });

  it("usa o servidor principal documentado OpenTopoMap e todos os créditos", () => {
    const topo = BASEMAPS.find((basemap) => basemap.id === "opentopo-approved-provider")!;
    expect(topo.name).toBe("OpenTopoMap");
    expect(topo.url).toBe("https://tile.opentopomap.org/{z}/{x}/{y}.png");
    expect(topo.licenseUrl).toBe("https://opentopomap.org/about");
    for (const credit of ["OpenStreetMap", "SRTM", "Sonny", "OpenTopoMap", "CC-BY-SA 3.0"]) {
      expect(topo.attribution).toContain(credit);
    }
    expect(topo.description).toMatch(/sem garantia de disponibilidade/);
    expect(topo.description).toMatch(/Sem troca automática/);
  });

  it("limita zooms aos níveis documentados sem estender o OpenTopoMap até 19", () => {
    expect(BASEMAPS.map(({ id, minZoom, maxZoom }) => ({ id, minZoom, maxZoom }))).toEqual([
      { id: "esri-imagery", minZoom: 0, maxZoom: 23 },
      { id: "esri-light-gray", minZoom: 0, maxZoom: 16 },
      { id: "esri-dark-gray", minZoom: 0, maxZoom: 16 },
      { id: "osm-approved-provider", minZoom: 0, maxZoom: 19 },
      { id: "opentopo-approved-provider", minZoom: 1, maxZoom: 17 },
    ]);
    for (const basemap of BASEMAPS) {
      expect(Number.isInteger(basemap.minZoom)).toBe(true);
      expect(Number.isInteger(basemap.maxZoom)).toBe(true);
      expect(basemap.minZoom!).toBeLessThanOrEqual(basemap.maxZoom!);
    }
  });

  it("declara CORS anônimo para captura sem enviar credenciais aos provedores", () => {
    expect(BASEMAPS.every((basemap) => basemap.crossOrigin === "anonymous")).toBe(true);
  });

  it("mantém novos campos opcionais compatíveis com definições antigas", () => {
    const oldDefinition: BasemapDefinition = {
      id: "legacy-fixture",
      name: "Exemplo de compatibilidade de tipo",
      kind: "xyz",
      availability: "planned-review",
      attribution: "Crédito",
      description: "Não selecionável",
    };
    expect(oldDefinition.minZoom).toBeUndefined();
    expect(oldDefinition.maxZoom).toBeUndefined();
    expect(oldDefinition.crossOrigin).toBeUndefined();
  });

  it("não introduz URL arbitrária, proxy, dados, token, chave ou fallback", () => {
    const hosts = new Set([
      "server.arcgisonline.com",
      "tile.openstreetmap.org",
      "tile.opentopomap.org",
    ]);
    for (const basemap of BASEMAPS) {
      const url = new URL(basemap.url!);
      expect(url.protocol).toBe("https:");
      expect(hosts.has(url.hostname)).toBe(true);
      expect(url.username).toBe("");
      expect(url.password).toBe("");
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
      expect(basemap.url).not.toMatch(/localhost|127\.0\.0\.1|proxy|token|api[_-]?key/i);
      expect(basemap).not.toHaveProperty("fallbackUrl");
      for (const coordinate of ["{z}", "{x}", "{y}"]) expect(basemap.url).toContain(coordinate);
      expect(basemap.attribution.trim().length).toBeGreaterThan(0);
      expect(new URL(basemap.licenseUrl!).protocol).toBe("https:");
    }
  });

  it("mantém avisos honestos de retirada dos serviços raster cinza", () => {
    for (const basemap of BASEMAPS.slice(1, 3)) {
      expect(basemap.availability).toBe("legacy-available");
      expect(basemap.description).toMatch(/dezembro de 2029/);
      expect(basemap.description).toMatch(/suporte maduro/);
    }
    expect(DEFAULT_BASEMAP.description).toMatch(/Não é declarada como ortofoto certificada/);
  });
});
