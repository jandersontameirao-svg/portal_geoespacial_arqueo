import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ingestLocalGeoTiff } from "./localRasterService";

const run = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("ingestão local GeoTIFF", () => {
  it("transforma GeoTIFF válido em COG EPSG:4674, gera tiles e preserva hashes", async () => {
    const root = await mkdtemp(join(tmpdir(), "arqueo-ingest-local-"));
    roots.push(root);
    const fixture = join(root, "fixture");
    await run("/usr/bin/python3", ["infra/raster/generate_synthetic_rasters.py", "--output-dir", fixture], { cwd: process.cwd(), env: { ...process.env, PYTHONNOUSERSITE: "1", PYTHONPATH: "/usr/lib/python3/dist-packages" } });
    const bytes = await readFile(join(fixture, "before_raw_epsg4326.tif"));
    const result = await ingestLocalGeoTiff({ root: join(root, "volume"), projectId: 41, layerId: 99, bytes, acquisitionAt: "2026-10-29T00:00:00Z", sourceLabel: "fixture sintética de teste", minZoom: 12, maxZoom: 12, nodata: 0 });
    expect(result.crs).toBe("EPSG:4674");
    expect(result.descriptor.cogKey).toBe("projects/41/rasters/99/source.cog.tif");
    expect(result.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.cogSha256).toMatch(/^[a-f0-9]{64}$/);
    expect((result.processing.tileReport as any).tiles.count).toBeGreaterThan(0);
    const cog = join(root, "volume", ...result.cogKey.split("/"));
    const { stdout } = await run("gdalinfo", ["-json", cog]);
    const info = JSON.parse(stdout);
    expect(info.metadata.IMAGE_STRUCTURE.LAYOUT).toBe("COG");
    expect(info.bands.every((band: any) => band.noDataValue === 0)).toBe(true);
  }, 120_000);
});
