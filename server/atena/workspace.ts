import { createHash } from "node:crypto";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { collectCoordinatePositions, swapCoordinateOrderTree, validateStoredGeometryCoordinates, storedPolygonToGeoJSON } from "../../shared/geometry-coordinates";
import type { SourceRow } from "./geo";

export function decodeJson<T = unknown>(value: unknown): T {
  let result = value;
  for (let i = 0; i < 3 && typeof result === "string"; i++) {
    try { result = JSON.parse(result); } catch { break; }
  }
  return result as T;
}

export function layerFeatureCollection(value: unknown): FeatureCollection | null {
  const data = decodeJson<any>(value);
  if (data == null) return null;
  if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) throw new Error("Camada vetorial não contém FeatureCollection válida; nenhum insumo foi convertido ou omitido.");
  return data;
}

/** IDs negativos são referências efêmeras, nunca IDs de geometries persistidas. */
function sourceId(layerId: number, index: number, part: number, geometry: Geometry) {
  return -parseInt(createHash("sha256").update(JSON.stringify([layerId, index, part, geometry])).digest("hex").slice(0, 12), 16) - 1;
}

/** Lê GeoJSON [lng,lat] sem alterar a FC original; preserva furos e componentes. */
export function rowsFromLayerData(layer: { id: number; name: string; layerData: unknown }): SourceRow[] {
  const collection = layerFeatureCollection(layer.layerData);
  if (!collection) return [];
  if (collection.features.length > 5000) throw new Error("Camada excede 5000 feições.");
  const rows: SourceRow[] = [];
  let vertexCount = 0;
  collection.features.forEach((feature, index) => {
    if (!feature || feature.type !== "Feature" || !feature.geometry) throw new Error(`Camada ${layer.name}: feição ${index + 1} sem geometria válida.`);
    const geom = feature.geometry;
    const geometries: Geometry[] = geom.type === "MultiPoint"
      ? geom.coordinates.map(coordinates => ({ type: "Point", coordinates }))
      : geom.type === "MultiLineString" ? geom.coordinates.map(coordinates => ({ type: "LineString", coordinates })) : [geom];
    geometries.forEach((geometry, part) => {
      if (geometry.type === "GeometryCollection") throw new Error(`Camada ${layer.name}: GeometryCollection não suportada; decomponha explicitamente a entrada.`);
      const type = geometry.type === "Point" ? "marker" : geometry.type === "LineString" ? "polyline" : geometry.type === "Polygon" || geometry.type === "MultiPolygon" ? "polygon" : null;
      if (!type) throw new Error(`Camada ${layer.name}: tipo ${geometry.type} não suportado.`);
      vertexCount += collectCoordinatePositions(geometry.coordinates).length;
      if (vertexCount > 50000) throw new Error("Camada excede 50000 vértices para análise Atena; simplifique explicitamente uma cópia do insumo.");
      const coordinates = swapCoordinateOrderTree(geometry.coordinates);
      validateStoredGeometryCoordinates(type, coordinates, { requireClosed: type === "polygon" });
      rows.push({ id: sourceId(layer.id, index, part, geometry), name: String(feature.properties?.name ?? feature.properties?.nome ?? `${layer.name} · ${index + 1}${geometries.length > 1 ? `/${part + 1}` : ""}`).slice(0, 255), type, coordinates: JSON.stringify(coordinates), layerId: layer.id });
    });
  });
  if (rows.length > 5000) throw new Error("Camada excede 5000 componentes geométricos.");
  return rows;
}

/** Uma camada usa geometries OU layerData; nunca concatena as duas representações. */
export function selectLayerRows(layer: { id: number; name: string; layerData: unknown }, rows: SourceRow[]) {
  const associated = rows.filter(row => row.layerId === layer.id);
  return associated.length ? associated : rowsFromLayerData(layer);
}

export function featureFromStored(row: Pick<SourceRow, "name" | "type" | "coordinates">, properties: Record<string, unknown> = {}): Feature {
  const coordinates = decodeJson(row.coordinates);
  validateStoredGeometryCoordinates(row.type, coordinates);
  const geometry: Geometry = row.type === "polygon" ? storedPolygonToGeoJSON(coordinates) as Geometry
    : { type: row.type === "marker" ? "Point" : "LineString", coordinates: swapCoordinateOrderTree(coordinates) } as Geometry;
  return { type: "Feature", properties: { ...properties, name: row.name }, geometry };
}

export function collectionBounds(collection: FeatureCollection) {
  const positions = collection.features.flatMap(feature => feature.geometry.type === "GeometryCollection" ? [] : collectCoordinatePositions(feature.geometry.coordinates));
  if (!positions.length) return null;
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [lng, lat] of positions) { west = Math.min(west, lng); east = Math.max(east, lng); south = Math.min(south, lat); north = Math.max(north, lat); }
  return { west, south, east, north };
}

export function resultMetadata(input: { operation: string; runId?: number; sourceLayerIds?: number[]; [key: string]: unknown }) {
  return { kind: "gis-analysis-result", atena: true, storageBridge: "geometry-mirror-v1", provenance: { engine: "atena", ...input }, generatedIn: "portal-geoespacial-arqueo" };
}
