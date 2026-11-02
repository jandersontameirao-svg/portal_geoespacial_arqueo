import type { Feature, FeatureCollection, Geometry } from "geojson";
import { normalizeOgcEndpoint, type OgcEndpointPolicy } from "./ogcCatalogService";

export type WfsBounds = { north: number; south: number; east: number; west: number };
export type WfsImportLimits = { pageSize: number; maxPages: number; maxFeatures: number; maxBytes: number };
export const DEFAULT_WFS_IMPORT_LIMITS: WfsImportLimits = Object.freeze({ pageSize: 500, maxPages: 10, maxFeatures: 5_000, maxBytes: 15 * 1024 * 1024 });

export type WfsImportReport = {
  collection: FeatureCollection<Geometry>;
  pagesFetched: number;
  bytesFetched: number;
  matchedFeatures: number | null;
  truncated: boolean;
};

function validBounds(bounds: WfsBounds) {
  return Number.isFinite(bounds.north) && Number.isFinite(bounds.south) && Number.isFinite(bounds.east) && Number.isFinite(bounds.west)
    && bounds.west < bounds.east && bounds.south < bounds.north;
}

export function buildWfsGetFeatureUrl(input: { endpoint: string; remoteLayer: string; bounds: WfsBounds; startIndex: number; count: number; policy: OgcEndpointPolicy }): URL {
  if (!input.remoteLayer || input.remoteLayer.length > 500) throw new Error("Camada WFS remota inválida");
  if (!validBounds(input.bounds)) throw new Error("AOI do projeto inválida para importação WFS");
  if (!Number.isInteger(input.startIndex) || input.startIndex < 0 || !Number.isInteger(input.count) || input.count < 1 || input.count > 1_000) throw new Error("Paginação WFS inválida");
  const url = normalizeOgcEndpoint(input.endpoint, input.policy);
  url.searchParams.set("service", "WFS");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("version", "2.0.0");
  url.searchParams.set("typeNames", input.remoteLayer);
  url.searchParams.set("outputFormat", "application/json");
  url.searchParams.set("srsName", "EPSG:4674");
  url.searchParams.set("bbox", `${input.bounds.west},${input.bounds.south},${input.bounds.east},${input.bounds.north},EPSG:4674`);
  url.searchParams.set("count", String(input.count));
  url.searchParams.set("startIndex", String(input.startIndex));
  return url;
}

function parseFeatureCollection(body: string): FeatureCollection<Geometry> {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { throw new Error("WFS não retornou GeoJSON válido"); }
  if (!parsed || typeof parsed !== "object" || (parsed as any).type !== "FeatureCollection" || !Array.isArray((parsed as any).features)) {
    throw new Error("WFS retornou estrutura diferente de FeatureCollection");
  }
  const features = (parsed as any).features as unknown[];
  if (features.some((feature) => !feature || typeof feature !== "object" || (feature as any).type !== "Feature" || !(feature as any).geometry)) {
    throw new Error("WFS retornou feição sem geometria");
  }
  return { type: "FeatureCollection", features: features as Array<Feature<Geometry>> };
}

function responseNumberMatched(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

export async function fetchWfsGeoJsonPages(input: {
  endpoint: string;
  remoteLayer: string;
  bounds: WfsBounds;
  policy: OgcEndpointPolicy;
  limits?: Partial<WfsImportLimits>;
  fetchImpl?: typeof fetch;
}): Promise<WfsImportReport> {
  const limits = { ...DEFAULT_WFS_IMPORT_LIMITS, ...(input.limits || {}) };
  if (limits.pageSize < 1 || limits.pageSize > 1_000 || limits.maxPages < 1 || limits.maxPages > 50 || limits.maxFeatures < 1 || limits.maxFeatures > 20_000 || limits.maxBytes < 1) throw new Error("Limites WFS inválidos");
  const fetcher = input.fetchImpl || fetch;
  const all: Array<Feature<Geometry>> = [];
  let bytesFetched = 0;
  let matchedFeatures: number | null = null;
  let pagesFetched = 0;
  let truncated = false;
  for (let page = 0; page < limits.maxPages; page++) {
    const remaining = limits.maxFeatures - all.length;
    if (remaining <= 0) { truncated = true; break; }
    const url = buildWfsGetFeatureUrl({ endpoint: input.endpoint, remoteLayer: input.remoteLayer, bounds: input.bounds, startIndex: all.length, count: Math.min(limits.pageSize, remaining), policy: input.policy });
    const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(20_000), headers: { Accept: "application/geo+json,application/json" } });
    if (!response.ok) throw new Error(`WFS GetFeature falhou com HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (!/json|geo\+json/i.test(contentType)) throw new Error("WFS GetFeature não retornou Content-Type GeoJSON/JSON");
    const body = await response.text();
    bytesFetched += Buffer.byteLength(body);
    if (bytesFetched > limits.maxBytes) throw new Error("Importação WFS excedeu o limite de bytes configurado");
    const collection = parseFeatureCollection(body);
    const raw = JSON.parse(body) as Record<string, unknown>;
    matchedFeatures ??= responseNumberMatched(raw.numberMatched);
    pagesFetched++;
    all.push(...collection.features);
    if (all.length > limits.maxFeatures) { all.length = limits.maxFeatures; truncated = true; break; }
    const returned = collection.features.length;
    if (matchedFeatures !== null && all.length >= matchedFeatures) break;
    if (returned < Math.min(limits.pageSize, remaining)) break;
    if (page === limits.maxPages - 1) truncated = true;
  }
  if (matchedFeatures !== null && all.length < matchedFeatures) truncated = true;
  return { collection: { type: "FeatureCollection", features: all }, pagesFetched, bytesFetched, matchedFeatures, truncated };
}
