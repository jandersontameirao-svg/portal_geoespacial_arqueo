#!/usr/bin/env tsx
/** Ensaio integral local: COG sintético -> tiles XYZ -> comparação -> PNG/worldfile/PRJ/PDF reais. */
import { execFile as execFileCallback } from "node:child_process";
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalRasterExport, prepareLocalRasterAssets, type RasterLayerRecord } from "../../server/localRasterService";

const execFile = promisify(execFileCallback);
const root = await mkdtemp(join(tmpdir(), "arqueo-raster-adapter-"));
const rasterRoot = join(root, "raster-root");
const repo = process.cwd();
const run = async (file: string, args: string[]) => execFile(file, args, { cwd: repo, env: { ...process.env, KEEP_ARTIFACTS: "1", PYTHONNOUSERSITE: "1", PYTHONPATH: "/usr/lib/python3/dist-packages" }, maxBuffer: 4 * 1024 * 1024 });
async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = await Promise.all(entries.map(async (entry) => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]));
  return found.flat();
}

try {
  await run("bash", ["infra/scripts/run_raster_fixture_rehearsal.sh", join(root, "fixture")]);
  const beforeKey = "projects/7/rasters/9/source.cog.tif";
  const afterKey = "projects/7/rasters/10/source.cog.tif";
  const beforePath = join(rasterRoot, ...beforeKey.split("/"));
  const afterPath = join(rasterRoot, ...afterKey.split("/"));
  await (await import("node:fs/promises")).mkdir(join(rasterRoot, "projects/7/rasters/9"), { recursive: true });
  await (await import("node:fs/promises")).mkdir(join(rasterRoot, "projects/7/rasters/10"), { recursive: true });
  await copyFile(join(root, "fixture/cog/before_epsg4674.cog.tif"), beforePath);
  await copyFile(join(root, "fixture/cog/after_epsg4674.cog.tif"), afterPath);
  const before = await prepareLocalRasterAssets({ root: rasterRoot, projectId: 7, layerId: 9, cogKey: beforeKey, minZoom: 12, maxZoom: 14 });
  const after = await prepareLocalRasterAssets({ root: rasterRoot, projectId: 7, layerId: 10, cogKey: afterKey, minZoom: 12, maxZoom: 14 });
  const tilePaths = await files(join(rasterRoot, "projects/7/rasters/9/tiles"));
  const changed: string[] = [];
  for (const tile of tilePaths) {
    const relative = tile.slice(join(rasterRoot, "projects/7/rasters/9/tiles").length + 1);
    const beforeBytes = await readFile(tile);
    const afterBytes = await readFile(join(rasterRoot, "projects/7/rasters/10/tiles", relative));
    if (!beforeBytes.equals(afterBytes)) changed.push(relative);
  }
  const layer: RasterLayerRecord = {
    id: 9, projectId: 7, layerType: "raster", crs: "EPSG:4674", bounds: { north: -15.60, south: -15.84576, east: -47.85424, west: -48.10 }, isVisible: true, layerData: {},
    metadata: { localRaster: before.descriptor },
  };
  const exported = await createLocalRasterExport({ root: rasterRoot, layer, bounds: layer.bounds!, width: 1024, height: 1024 });
  const output = join(rasterRoot, ...exported.exportKey.split("/"));
  const png = await readFile(join(output, "map.png"));
  const { stdout: pdfInfo } = await run("pdfinfo", [join(output, "map.pdf")]);
  const { stdout: gdalInfo } = await run("gdalinfo", ["-json", join(output, "map.png")]);
  const imageInfo = JSON.parse(gdalInfo);
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Exportação PNG inválida");
  if (!pdfInfo.includes("Pages:           1")) throw new Error("PDF não tem uma página");
  if (imageInfo.size?.[0] !== 1024 || imageInfo.size?.[1] !== 1024) throw new Error("Dimensão PNG divergente");
  if (!changed.length) throw new Error("Comparação antes/depois não encontrou tile diferente");
  console.log(JSON.stringify({
    status: "passed", mode: "local-raster-adapter-rehearsal", productionConnections: 0,
    crs: before.descriptor.expectedCrs, nodata: before.descriptor.nodata,
    beforeTiles: before.report.tiles.count, afterTiles: after.report.tiles.count, changedTileChecksums: changed.length,
    pngSignature: "valid", pngSize: imageInfo.size, pdfPages: 1,
    export: exported.report.files, root: process.env.KEEP_RASTER_REHEARSAL === "1" ? root : "removed-after-rehearsal",
  }, null, 2));
} finally {
  if (process.env.KEEP_RASTER_REHEARSAL !== "1") await rm(root, { recursive: true, force: true });
}
