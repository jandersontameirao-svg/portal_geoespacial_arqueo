import bbox from "@turf/bbox";
import area from "@turf/area";
import buffer from "@turf/buffer";
import { featureCollection } from "@turf/helpers";
import intersect from "@turf/intersect";
import union from "@turf/union";
import proj4 from "proj4";
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry, MultiPolygon, Polygon, Position } from "geojson";

export type PolygonFeature = Feature<Polygon | MultiPolygon, GeoJsonProperties>;
export type AnalysisOperation = "buffer" | "intersection" | "union" | "clip" | "overlay" | "grid" | "area";

export interface AnalysisRequest {
  operation: AnalysisOperation;
  inputs: Feature<Geometry, GeoJsonProperties>[];
  bufferMeters?: number;
  grid?: {
    spacingMeters: number;
    originCode?: string;
    rotationDegrees?: number;
    pattern?: GridPattern;
  };
}

export type GridPattern = "quadrada" | "triangular";

export interface AnalysisProvenance {
  engine: "turf";
  operation: AnalysisOperation;
  crs: "EPSG:4326";
  metricModel: "geodésico";
  createdAt: string;
  inputFeatureCount: number;
  parameters: Record<string, string | number | boolean | undefined>;
}

export interface AnalysisResult {
  output: FeatureCollection<Geometry, GeoJsonProperties>;
  bounds: { west: number; south: number; east: number; north: number } | null;
  areaSquareMeters: number;
  provenance: AnalysisProvenance;
}

function isPolygonal(feature: Feature<Geometry, GeoJsonProperties>): feature is PolygonFeature {
  return feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon";
}

function polygonalInputs(inputs: Feature<Geometry, GeoJsonProperties>[]): PolygonFeature[] {
  const features = inputs.filter(isPolygonal);
  if (features.length === 0) {
    throw new Error("A operação exige ao menos uma geometria Polygon ou MultiPolygon.");
  }
  return features;
}

function toCollection(features: Feature<Geometry, GeoJsonProperties>[]): FeatureCollection<Geometry, GeoJsonProperties> {
  return featureCollection(features);
}

function resultBounds(output: FeatureCollection<Geometry, GeoJsonProperties>): AnalysisResult["bounds"] {
  if (output.features.length === 0) return null;
  const [west, south, east, north] = bbox(output);
  return { west, south, east, north };
}

function totalArea(output: FeatureCollection<Geometry, GeoJsonProperties>): number {
  return output.features.reduce((sum, feature) => sum + area(feature), 0);
}

function withProvenance(
  operation: AnalysisOperation,
  inputs: Feature<Geometry, GeoJsonProperties>[],
  output: FeatureCollection<Geometry, GeoJsonProperties>,
  parameters: AnalysisProvenance["parameters"],
): AnalysisResult {
  return {
    output,
    bounds: resultBounds(output),
    areaSquareMeters: totalArea(output),
    provenance: {
      engine: "turf",
      operation,
      crs: "EPSG:4326",
      metricModel: "geodésico",
      createdAt: new Date().toISOString(),
      inputFeatureCount: inputs.length,
      parameters,
    },
  };
}

function collectPositions(geometry: Geometry): Position[] {
  switch (geometry.type) {
    case "Point": return [geometry.coordinates as Position];
    case "MultiPoint":
    case "LineString": return geometry.coordinates as Position[];
    case "MultiLineString":
    case "Polygon": return (geometry.coordinates as Position[][]).flat();
    case "MultiPolygon": return (geometry.coordinates as Position[][][]).flat(2);
    case "GeometryCollection": return geometry.geometries.flatMap(collectPositions);
    default: return [];
  }
}

function pointInRing(point: Position, ring: Position[]): boolean {
  let inside = false;
  const x = point[0], y = point[1];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersects = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Ponto dentro do polígono (com buracos e multipolígono), sem dependência externa. */
function pointInPolygonFeature(point: Position, feature: PolygonFeature): boolean {
  const polygons: Position[][][] = feature.geometry.type === "Polygon"
    ? [feature.geometry.coordinates as Position[][]]
    : (feature.geometry.coordinates as Position[][][]);
  for (const rings of polygons) {
    const [outer, ...holes] = rings;
    if (outer && pointInRing(point, outer) && !holes.some(hole => pointInRing(point, hole))) {
      return true;
    }
  }
  return false;
}

/**
 * Executa análise espacial em GeoJSON. Distâncias de buffer e de malha usam
 * metros geodésicos; resultados permanecem em EPSG:4326 para interoperar com
 * Leaflet, KML e a maior parte dos serviços web.
 */
export function executeAnalysis(request: AnalysisRequest): AnalysisResult {
  const { operation, inputs } = request;
  if (inputs.length === 0) {
    throw new Error("Selecione ao menos uma feição para análise.");
  }

  if (operation === "buffer") {
    const meters = request.bufferMeters;
    if (!Number.isFinite(meters) || !meters || meters <= 0 || meters > 100_000) {
      throw new Error("Informe um buffer entre 0 e 100000 metros.");
    }
    const buffered = inputs
      .map((input, index) => {
        const output = buffer(input, meters, { units: "meters", steps: 16 });
        if (!output) return null;
        return {
          ...output,
          properties: { ...output.properties, sourceIndex: index + 1, operation: "buffer" },
        } as Feature<Geometry, GeoJsonProperties>;
      })
      .filter((feature): feature is Feature<Geometry, GeoJsonProperties> => Boolean(feature));
    return withProvenance(operation, inputs, toCollection(buffered), { bufferMeters: meters, units: "meters", steps: 16 });
  }

  if (operation === "area") {
    const outputs = inputs.map((input, index) => ({
      ...input,
      properties: { ...input.properties, sourceIndex: index + 1, areaSquareMeters: area(input), operation: "area" },
    }));
    return withProvenance(operation, inputs, toCollection(outputs), { units: "square meters" });
  }

  const polygonInputs = polygonalInputs(inputs);

  if (operation === "intersection" || operation === "clip" || operation === "overlay") {
    if (polygonInputs.length < 2) {
      throw new Error("Selecione ao menos duas áreas poligonais para esta operação.");
    }
    const output = intersect(featureCollection([polygonInputs[0], polygonInputs[1]]));
    const features = output
      ? [{ ...output, properties: { ...output.properties, operation, sourceIndices: [1, 2] } }]
      : [];
    return withProvenance(operation, inputs, toCollection(features), { sourceCount: 2 });
  }

  if (operation === "union") {
    if (polygonInputs.length < 2) {
      throw new Error("Selecione ao menos duas áreas poligonais para união.");
    }
    const output = union(featureCollection(polygonInputs));
    return withProvenance(
      operation,
      inputs,
      toCollection(output ? [{ ...output, properties: { ...output.properties, operation, sourceCount: polygonInputs.length } }] : []),
      { sourceCount: polygonInputs.length },
    );
  }

  if (operation === "grid") {
    if (polygonInputs.length !== 1) {
      throw new Error("A malha de pontos exige exatamente uma área poligonal de recorte.");
    }
    const spacingMeters = request.grid?.spacingMeters;
    if (!Number.isFinite(spacingMeters) || !spacingMeters || spacingMeters < 10 || spacingMeters > 10_000) {
      throw new Error("Informe espaçamento da malha entre 10 e 10000 metros.");
    }
    const rotationDegrees = request.grid?.rotationDegrees ?? 0;
    if (!Number.isFinite(rotationDegrees) || Math.abs(rotationDegrees) > 180) {
      throw new Error("Informe uma rotação entre -180 e 180 graus.");
    }
    const pattern: GridPattern = request.grid?.pattern === "triangular" ? "triangular" : "quadrada";
    const originCode = request.grid?.originCode?.trim() || "MALHA";
    const coverage = polygonInputs[0];
    const vertices = collectPositions(coverage.geometry);
    if (vertices.length === 0) {
      throw new Error("A área de recorte não possui vértices.");
    }
    // Lattice métrica em UTM: projeta os vértices, constrói a grade (quadrada ou
    // triangular com linhas alternadas) e só mantém pontos dentro do polígono.
    const originLon = vertices[0][0], originLat = vertices[0][1];
    const zone = Math.min(60, Math.max(1, Math.floor((originLon + 180) / 6) + 1));
    const projection = proj4("EPSG:4326", `+proj=utm +zone=${zone}${originLat < 0 ? " +south" : ""} +ellps=GRS80 +units=m +no_defs`);
    const angle = (rotationDegrees * Math.PI) / 180;
    const rotate = ([x, y]: number[], a: number): [number, number] => [
      x * Math.cos(a) - y * Math.sin(a),
      x * Math.sin(a) + y * Math.cos(a),
    ];
    const metric = vertices.map(position => rotate(projection.forward([position[0], position[1]]), -angle));
    const xs = metric.map(p => p[0]);
    const ys = metric.map(p => p[1]);
    const rowStep = pattern === "triangular" ? (spacingMeters * Math.sqrt(3)) / 2 : spacingMeters;
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const firstRow = Math.ceil(Math.min(...ys) / rowStep);
    const lastRow = Math.floor(Math.max(...ys) / rowStep);
    if ((lastRow - firstRow + 1) * (2 + (maxX - minX) / spacingMeters) > 500_000) {
      throw new Error("A área é grande para esse espaçamento. Aumente a distância ou selecione uma área menor.");
    }
    const features: Feature<Geometry, GeoJsonProperties>[] = [];
    for (let row = firstRow; row <= lastRow; row++) {
      const offset = pattern === "triangular" && row % 2 !== 0 ? spacingMeters / 2 : 0;
      for (let x = Math.ceil((minX - offset) / spacingMeters) * spacingMeters + offset; x <= maxX; x += spacingMeters) {
        const coordinates = projection.inverse(rotate([x, row * rowStep], angle)) as Position;
        if (!pointInPolygonFeature(coordinates, coverage)) continue;
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates },
          properties: {
            code: `${originCode}-${String(features.length + 1).padStart(4, "0")}`,
            sequence: features.length + 1,
            spacingMeters,
            rotationDegrees,
            pattern,
            operation: "grid",
          },
        });
        if (features.length > 5000) {
          throw new Error("A malha ultrapassa 5.000 pontos. Aumente o espaçamento.");
        }
      }
    }
    if (features.length === 0) {
      throw new Error("Nenhum ponto caiu dentro da área selecionada.");
    }
    return withProvenance(operation, inputs, toCollection(features), {
      spacingMeters,
      rotationDegrees,
      pattern,
      originCode,
      units: "meters",
      clip: true,
    });
  }

  throw new Error(`Operação não suportada: ${operation}`);
}
