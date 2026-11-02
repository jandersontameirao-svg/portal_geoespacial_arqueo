import { describe, expect, it } from "vitest";
import { buildHistoricalImageryCatalog } from "./historicalImageryCatalog";

const hash = "b".repeat(64);

describe("catálogo histórico de imagens", () => {
  it("lista COGs concluídos por data de aquisição e ignora processamento incompleto", () => {
    const catalog = buildHistoricalImageryCatalog([
      { id: 2, name: "Depois", layerType: "raster", crs: "EPSG:4674", bounds: null, metadata: { rasterIngestion: { status: "completed", acquisitionAt: "2026-02-01T00:00:00.000Z", cogSha256: hash, sourceLabel: "Voo 02", tileCount: 12 } } },
      { id: 1, name: "Antes", layerType: "raster", crs: "EPSG:4674", bounds: null, metadata: { rasterIngestion: { status: "completed", acquisitionAt: "2026-01-01T00:00:00.000Z", cogSha256: hash, sourceLabel: "Voo 01" } } },
      { id: 3, name: "Em processamento", layerType: "raster", crs: "EPSG:4674", bounds: null, metadata: { rasterIngestion: { status: "processing" } } },
    ]);
    expect(catalog.map((item) => item.layerId)).toEqual([1, 2]);
    expect(catalog[1].tileCount).toBe(12);
  });
});
