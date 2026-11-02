import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { buildBackupArtifact } from "./backupManifest";
import { createLocalFilesystemArchive, restoreLocalFilesystemArchive } from "./backupArchive";
import { LocalFilesystemBackupStore } from "./localFilesystemBackupStore";
import { ingestLocalGeoTiff } from "./localRasterService";

const run = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("backup físico de COG válido", () => {
  it("restaura bytes de COG real e o GDAL reabre o arquivo com layout COG", async () => {
    const root = await mkdtemp(join(tmpdir(), "arqueo-cog-backup-"));
    roots.push(root);
    const fixture = join(root, "fixture");
    await run("/usr/bin/python3", ["infra/raster/generate_synthetic_rasters.py", "--output-dir", fixture], { cwd: process.cwd(), env: { ...process.env, PYTHONNOUSERSITE: "1", PYTHONPATH: "/usr/lib/python3/dist-packages" } });
    const sourceTiff = await readFile(join(fixture, "before_raw_epsg4326.tif"));
    const ingested = await ingestLocalGeoTiff({ root: join(root, "raster-volume"), projectId: 2, layerId: 7, bytes: sourceTiff, acquisitionAt: "2026-10-29T00:00:00Z", sourceLabel: "fixture COG para backup", minZoom: 12, maxZoom: 12, nodata: 0 });
    const cogBytes = await readFile(join(root, "raster-volume", ...ingested.cogKey.split("/")));
    const artifact = buildBackupArtifact({
      users: [{ id: 1, openId: "test", name: "test" }], projects: [{ id: 2, code: "COG", name: "COG", createdBy: 1 }], project_members: [{ id: 3, projectId: 2, userId: 1, role: "owner" }],
      files: [{ id: 4, projectId: 2, s3Key: ingested.cogKey }], layers: [{ id: 7, projectId: 2, name: "COG", layerType: "raster" }], audit_logs: [{ id: 8, action: "test.cog.backup" }],
    }, { backupId: "valid-cog-roundtrip", createdAt: "2026-10-29T00:00:00.000Z" });
    const source = new LocalFilesystemBackupStore(join(root, "source"));
    const target = new LocalFilesystemBackupStore(join(root, "archive"));
    await source.put(ingested.cogKey, cogBytes);
    const archive = await createLocalFilesystemArchive({ artifact, source, target });
    expect(archive.manifest.completeness).toBe("complete");
    const restored = await restoreLocalFilesystemArchive({ backupId: "valid-cog-roundtrip", store: target });
    const raster = restored.objects.find((object) => object.logicalKey === ingested.cogKey);
    expect(raster?.bytes.equals(cogBytes)).toBe(true);
    const restoredPath = join(root, "restored.cog.tif");
    await writeFile(restoredPath, raster!.bytes);
    const { stdout } = await run("gdalinfo", ["-json", restoredPath]);
    const info = JSON.parse(stdout);
    expect(info.metadata.IMAGE_STRUCTURE.LAYOUT).toBe("COG");
    expect(info.bands.every((band: any) => band.noDataValue === 0)).toBe(true);
  }, 180_000);
});
