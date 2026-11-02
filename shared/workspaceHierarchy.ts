import type { FeatureCollection, Geometry } from "geojson";

export type WorkspaceHierarchyLayer = {
  id: number;
  isGroup?: boolean;
  effectiveVisible?: boolean;
  isVisible?: boolean | number;
  layerType?: string;
  layerData?: unknown;
};

/** Presentation only. Authorization remains exclusively in the project routers. */
export function workspaceLayerVisible(
  layerId: number,
  fallback: boolean,
  hierarchy: readonly WorkspaceHierarchyLayer[],
): boolean {
  const node = hierarchy.find((layer) => layer.id === layerId);
  if (!node) return fallback;
  return node.isGroup ? false : node.effectiveVisible ?? fallback;
}

export function isWorkspaceFeatureCollection(value: unknown): value is FeatureCollection<Geometry> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { type?: unknown; features?: unknown };
  return candidate.type === "FeatureCollection" && Array.isArray(candidate.features);
}

/** A layer-backed feature is rendered through its FC OR geometry rows, never both. */
export function standaloneWorkspaceGeometry(
  geometry: { layerId?: number | null },
  layers: readonly WorkspaceHierarchyLayer[],
): boolean {
  if (geometry.layerId == null) return true;
  const node = layers.find((layer) => layer.id === geometry.layerId);
  return !node || node.isGroup || node.layerType !== "vector" || !isWorkspaceFeatureCollection(node.layerData) || node.layerData.features.length === 0;
}
