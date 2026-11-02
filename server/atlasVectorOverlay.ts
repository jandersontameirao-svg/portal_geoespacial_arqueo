import type { Feature, FeatureCollection, Geometry } from "geojson";

export type AtlasVectorOverlay = {
  layerId: number;
  name: string;
  color: string;
  weight: number;
  fillOpacity: number;
  includeInLegend: boolean;
  data: FeatureCollection<Geometry>;
};

const MAX_LAYERS = 20;
const MAX_FEATURES = 5_000;
const MAX_NAME = 255;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function bounded(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
}

function safeGeometry(geometry: unknown): Geometry | null {
  if (!geometry || typeof geometry !== "object") return null;
  const type = (geometry as any).type;
  const accepted = ["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon"];
  if (!accepted.includes(type) || !("coordinates" in (geometry as any))) return null;
  return geometry as Geometry;
}

export function buildAtlasVectorOverlays(layers: Array<{ id: number; name: string; layerData: unknown; defaultStyle: unknown }>, config: Array<{ layerId: number; opacity: number; includeInLegend: boolean }> | null | undefined): AtlasVectorOverlay[] {
  const requested = new Map((config || []).map((item) => [item.layerId, item]));
  const overlays: AtlasVectorOverlay[] = [];
  let features = 0;
  for (const layer of layers) {
    const selection = requested.get(layer.id);
    if (!selection || overlays.length >= MAX_LAYERS) continue;
    const raw = layer.layerData as any;
    if (!raw || raw.type !== "FeatureCollection" || !Array.isArray(raw.features)) continue;
    const cleaned: Array<Feature<Geometry>> = [];
    for (const feature of raw.features) {
      const geometry = safeGeometry(feature?.geometry);
      if (!geometry) continue;
      if (features + cleaned.length >= MAX_FEATURES) throw new Error(`Atlas excede o limite de ${MAX_FEATURES.toLocaleString("pt-BR")} feições vetoriais`);
      cleaned.push({ type: "Feature", properties: { name: typeof feature?.properties?.name === "string" ? feature.properties.name.slice(0, 255) : undefined, code: typeof feature?.properties?.code === "string" ? feature.properties.code.slice(0, 80) : undefined }, geometry });
    }
    const style = (layer.defaultStyle || {}) as Record<string, unknown>;
    overlays.push({
      layerId: layer.id,
      name: String(layer.name || `Camada ${layer.id}`).slice(0, MAX_NAME),
      color: typeof style.color === "string" && HEX_COLOR.test(style.color) ? style.color : "#1d4ed8",
      weight: bounded(style.weight, 2, 1, 8),
      fillOpacity: bounded(style.fillOpacity, Math.max(0.08, Math.min(0.7, Number(selection.opacity) || 0.25)), 0, 0.85),
      includeInLegend: Boolean(selection.includeInLegend),
      data: { type: "FeatureCollection", features: cleaned },
    });
    features += cleaned.length;
  }
  return overlays;
}
