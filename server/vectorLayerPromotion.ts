import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { InsertLayer } from "../drizzle/schema";
import type { FileProcessingResult } from "./fileProcessing";

type ProjectFileReference = {
  id: number;
  projectId: number;
  name: string;
  fileType: string;
  crs: string | null;
  bounds: { north: number; south: number; east: number; west: number } | null;
};

export type PromotableVectorLayer = FeatureCollection<Geometry>;

export function isPromotableVectorLayer(value: unknown): value is PromotableVectorLayer {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { type?: unknown; features?: unknown };
  if (candidate.type !== "FeatureCollection" || !Array.isArray(candidate.features) || candidate.features.length === 0) return false;
  return candidate.features.every((feature): feature is Feature<Geometry> => {
    if (!feature || typeof feature !== "object") return false;
    const item = feature as { type?: unknown; geometry?: unknown };
    return item.type === "Feature" && Boolean(item.geometry && typeof item.geometry === "object");
  });
}

export function createImportedVectorLayer(input: {
  file: ProjectFileReference;
  processing: FileProcessingResult;
  createdBy: number;
}): InsertLayer | null {
  const { file, processing, createdBy } = input;
  if (!isPromotableVectorLayer(processing.layerData)) return null;

  return {
    projectId: file.projectId,
    fileId: file.id,
    name: file.name,
    description: `Camada vetorial derivada do arquivo original ${file.name}.`,
    layerType: "vector",
    layerData: processing.layerData,
    defaultStyle: { color: "#2563eb", weight: 2, fillOpacity: 0.2 },
    crs: processing.crs || file.crs || "EPSG:4326",
    bounds: processing.bounds || file.bounds || null,
    // A ativação no mapa deve ser uma escolha explícita no projeto.
    isVisible: false,
    isPublic: false,
    metadata: {
      kind: "file-vector-import",
      sourceFileId: file.id,
      sourceFileName: file.name,
      sourceFileType: file.fileType,
      originalFormat: processing.metadata?.originalFormat || file.fileType,
      featureCount: processing.featureCount || processing.layerData.features.length,
      importStatus: "ready_for_project_layer_selection",
      conversion: processing.metadata?.convertedToGeoJSON ? "kml_or_kmz_to_geojson" : "native_geojson_or_shapefile",
    },
    createdBy,
  };
}

export function vectorFeaturesFromLayer(layerData: unknown): Feature<Geometry>[] {
  if (!isPromotableVectorLayer(layerData)) return [];
  return layerData.features.filter((feature) => feature.geometry.type !== "GeometryCollection");
}
