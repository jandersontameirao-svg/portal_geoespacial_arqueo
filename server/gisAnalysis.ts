import bbox from "@turf/bbox";
import area from "@turf/area";
import buffer from "@turf/buffer";
import { featureCollection } from "@turf/helpers";
import intersect from "@turf/intersect";
import squareGrid from "@turf/square-grid";
import transformRotate from "@turf/transform-rotate";
import union from "@turf/union";
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry, MultiPolygon, Polygon } from "geojson";

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
  };
}

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
      throw new Error("A malha arqueológica exige exatamente uma área poligonal de recorte.");
    }
    const spacingMeters = request.grid?.spacingMeters;
    if (!Number.isFinite(spacingMeters) || !spacingMeters || spacingMeters < 10 || spacingMeters > 10_000) {
      throw new Error("Informe espaçamento da malha entre 10 e 10000 metros.");
    }
    const rotationDegrees = request.grid?.rotationDegrees ?? 0;
    const originCode = request.grid?.originCode?.trim() || "MALHA";
    const coverage = polygonInputs[0];
    const rawGrid = squareGrid(bbox(coverage), spacingMeters / 1000, { units: "kilometers" });
    const rotatedGrid = rotationDegrees === 0 ? rawGrid : transformRotate(rawGrid, rotationDegrees);
    let sequence = 0;
    const clipped = rotatedGrid.features.flatMap((cell) => {
      const clippedCell = intersect(featureCollection([cell as PolygonFeature, coverage]));
      if (!clippedCell) return [];
      sequence += 1;
      return [{
        ...clippedCell,
        properties: {
          ...clippedCell.properties,
          code: `${originCode}-${String(sequence).padStart(4, "0")}`,
          sequence,
          spacingMeters,
          rotationDegrees,
          operation: "grid",
        },
      }];
    });
    return withProvenance(operation, inputs, toCollection(clipped), {
      spacingMeters,
      rotationDegrees,
      originCode,
      units: "meters",
      clip: true,
    });
  }

  throw new Error(`Operação não suportada: ${operation}`);
}
