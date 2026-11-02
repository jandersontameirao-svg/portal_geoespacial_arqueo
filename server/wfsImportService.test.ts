import { describe, expect, it } from "vitest";
import { buildWfsGetFeatureUrl, fetchWfsGeoJsonPages } from "./wfsImportService";

const policy = { allowedHosts: ["wfs.example.test"], allowTestHttp: false };
const bounds = { west: -48, south: -16, east: -47, north: -15 };
function feature(id: number) { return { type: "Feature", properties: { id }, geometry: { type: "Point", coordinates: [-47.5, -15.5] } }; }
function jsonResponse(payload: unknown) { return new Response(JSON.stringify(payload), { headers: { "content-type": "application/geo+json" } }); }

describe("importação WFS paginada", () => {
  it("cria GetFeature WFS 2.0 com BBOX de projeto e paginação", () => {
    const url = buildWfsGetFeatureUrl({ endpoint: "https://wfs.example.test/ows", remoteLayer: "official:areas", bounds, startIndex: 500, count: 500, policy });
    expect(url.searchParams.get("service")).toBe("WFS");
    expect(url.searchParams.get("typeNames")).toBe("official:areas");
    expect(url.searchParams.get("bbox")).toBe("-48,-16,-47,-15,EPSG:4674");
    expect(url.searchParams.get("startIndex")).toBe("500");
  });

  it("agrega páginas sem aceitar URL ou path fornecido pelo cliente", async () => {
    const calls: URL[] = [];
    const fetchImpl = async (url: URL | RequestInfo) => {
      const parsed = new URL(String(url)); calls.push(parsed);
      const start = Number(parsed.searchParams.get("startIndex"));
      return start === 0
        ? jsonResponse({ type: "FeatureCollection", numberMatched: 3, features: [feature(1), feature(2)] })
        : jsonResponse({ type: "FeatureCollection", numberMatched: 3, features: [feature(3)] });
    };
    const result = await fetchWfsGeoJsonPages({ endpoint: "https://wfs.example.test/ows", remoteLayer: "official:areas", bounds, policy, limits: { pageSize: 2 }, fetchImpl: fetchImpl as typeof fetch });
    expect(result.collection.features).toHaveLength(3);
    expect(result.pagesFetched).toBe(2);
    expect(result.truncated).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it("declara truncamento quando encontra limite de feições", async () => {
    const fetchImpl = async () => jsonResponse({ type: "FeatureCollection", numberMatched: 10, features: [feature(1), feature(2)] });
    const result = await fetchWfsGeoJsonPages({ endpoint: "https://wfs.example.test/ows", remoteLayer: "official:areas", bounds, policy, limits: { pageSize: 2, maxFeatures: 3 }, fetchImpl: fetchImpl as typeof fetch });
    expect(result.collection.features).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it("rejeita resposta que não seja GeoJSON", async () => {
    const fetchImpl = async () => new Response("<xml/>", { headers: { "content-type": "application/xml" } });
    await expect(fetchWfsGeoJsonPages({ endpoint: "https://wfs.example.test/ows", remoteLayer: "official:areas", bounds, policy, fetchImpl: fetchImpl as typeof fetch })).rejects.toThrow("Content-Type GeoJSON");
  });
});
