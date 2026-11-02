export type RasterLayerLike = {
  id: number;
  name: string;
  layerType: string;
  crs: string;
  bounds: unknown;
  layerData: unknown;
  metadata: unknown;
};

/** Retorna somente metadados seguros e necessários à composição de mapas/Atlas. */
export function summarizeRasterLayers(layers: RasterLayerLike[]) {
  return layers.filter((layer) => layer.layerType === "raster").map((layer) => {
    const metadata = (layer.metadata || {}) as Record<string, any>;
    const data = (layer.layerData || {}) as Record<string, any>;
    return {
      id: layer.id,
      name: layer.name,
      crs: layer.crs,
      bounds: layer.bounds,
      source: metadata.source || metadata["arqueo:source"] || null,
      acquiredAt: metadata.acquiredAt || metadata.datetime || null,
      nodata: metadata.nodata ?? metadata?.["raster:bands"]?.[0]?.nodata ?? null,
      assetType: metadata.assetType || "cog",
      assetUrl: data.url || data.href || metadata.assetUrl || null,
      checksum: metadata.checksum || metadata?.assets?.cog?.["file:checksum"] || null,
      temporalComparison: metadata.temporalComparison || null,
      attribution: metadata.attribution || null,
    };
  });
}
