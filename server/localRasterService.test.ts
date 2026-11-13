import { describe, expect, it } from "vitest";
import { descriptorFromLayer, exportFilePath, getLocalRasterRoot, RasterAssetError, resolveLocalRasterPath, tilePath, validateExportRequest, validateRelativeRasterKey, validateTileCoordinates } from "./localRasterService";

const layer = {
  id: 9, projectId: 7, layerType: "raster", crs: "EPSG:4674", bounds: { north: -15, south: -16, east: -47, west: -48 }, isVisible: true,
  layerData: {}, metadata: { localRaster: { cogKey: "projects/7/rasters/9/source.cog.tif", tilesKey: "projects/7/rasters/9/tiles", minZoom: 12, maxZoom: 14, expectedCrs: "EPSG:4674", nodata: 0 } },
};

describe("fronteira de assets raster locais", () => {
  // Usa caminhos absolutos POSIX (/tmp/...), que não são absolutos no Windows;
  // a resolução de raiz é específica de plataforma e vale no Linux (alvo do deploy).
  it.skipIf(process.platform === "win32")("aceita somente descriptor raster completo e gera caminho interno de tile", () => {
    const descriptor = descriptorFromLayer(layer);
    expect(tilePath("/tmp/raster-root", descriptor, 12, 1000, 1000)).toBe("/tmp/raster-root/projects/7/rasters/9/tiles/12/1000/1000.png");
    expect(() => validateTileCoordinates(11, 0, 0, descriptor)).toThrow(RasterAssetError);
    expect(() => validateTileCoordinates(14, 2 ** 14, 0, descriptor)).toThrow(RasterAssetError);
  });

  it("rejeita URL, traversal, chave Windows e camada sem descriptor aprovado", () => {
    for (const key of ["https://example.test/a.tif", "../a.tif", "/tmp/a.tif", "projects\\7\\a.tif", ""])
      expect(() => validateRelativeRasterKey(key)).toThrow(RasterAssetError);
    expect(() => descriptorFromLayer({ ...layer, metadata: {} })).toThrow(RasterAssetError);
    expect(() => descriptorFromLayer({ ...layer, layerType: "vector" })).toThrow(RasterAssetError);
    expect(() => resolveLocalRasterPath("/tmp/root", "../outside.tif")).toThrow(RasterAssetError);
  });

  it("limita exportação para bounds e pixels seguros", () => {
    expect(() => validateExportRequest({ north: -15, south: -16, east: -47, west: -48 }, 1024, 1024)).not.toThrow();
    expect(() => validateExportRequest({ north: -16, south: -15, east: -47, west: -48 }, 1024, 1024)).toThrow(RasterAssetError);
    expect(() => validateExportRequest({ north: -15, south: -16, east: -47, west: -48 }, 9000, 1024)).toThrow(RasterAssetError);
    expect(() => getLocalRasterRoot()).toThrow(RasterAssetError);
    void exportFilePath;
  });
});
