export type HistoricalRasterLayer = {
  id: number;
  name: string;
  layerType: string;
  crs: string;
  bounds: unknown;
  metadata: Record<string, any> | null;
};

export type HistoricalImageryItem = {
  layerId: number;
  name: string;
  acquisitionAt: string;
  sourceLabel: string | null;
  crs: string;
  bounds: unknown;
  cogSha256: string;
  tileCount: number | null;
};

export function buildHistoricalImageryCatalog(layers: HistoricalRasterLayer[]): HistoricalImageryItem[] {
  return layers.flatMap((layer) => {
    const ingestion = layer.metadata?.rasterIngestion;
    if (layer.layerType !== "raster" || ingestion?.status !== "completed" || typeof ingestion.acquisitionAt !== "string" || !/^[a-f0-9]{64}$/i.test(String(ingestion.cogSha256 || ""))) return [];
    const date = new Date(ingestion.acquisitionAt);
    if (Number.isNaN(date.getTime())) return [];
    return [{ layerId: layer.id, name: layer.name, acquisitionAt: date.toISOString(), sourceLabel: typeof ingestion.sourceLabel === "string" ? ingestion.sourceLabel : null, crs: layer.crs, bounds: layer.bounds, cogSha256: String(ingestion.cogSha256).toLowerCase(), tileCount: Number.isInteger(ingestion.tileCount) ? ingestion.tileCount : null }];
  }).sort((a, b) => a.acquisitionAt.localeCompare(b.acquisitionAt));
}
