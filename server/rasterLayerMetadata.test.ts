import { describe, expect, it } from "vitest";
import { summarizeRasterLayers } from "./rasterLayerMetadata";

describe("metadados raster para mapas e Atlas", () => {
  it("seleciona COG e comparação temporal sem misturar camadas vetoriais", () => {
    const result = summarizeRasterLayers([
      { id: 1, name: "Análise", layerType: "vector", crs: "EPSG:4326", bounds: null, layerData: {}, metadata: {} },
      { id: 2, name: "Ortofoto 2026", layerType: "raster", crs: "EPSG:4674", bounds: { north: -15, south: -16, east: -47, west: -48 }, layerData: { url: "https://example.invalid/a.cog.tif" }, metadata: { acquiredAt: "2026-01-01T00:00:00Z", nodata: 0, checksum: "sha256:abc", temporalComparison: { changedPercent: 6.18 } } },
    ]);
    expect(result).toEqual([expect.objectContaining({ id: 2, crs: "EPSG:4674", nodata: 0, temporalComparison: { changedPercent: 6.18 } })]);
  });
});
