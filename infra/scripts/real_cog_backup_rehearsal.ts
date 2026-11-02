#!/usr/bin/env tsx
/** Ensaio descartável: GeoTIFF sintético válido -> COG -> backup físico -> restore -> gdalinfo. */
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { buildBackupArtifact } from "../../server/backupManifest";
import { createLocalFilesystemArchive, restoreLocalFilesystemArchive } from "../../server/backupArchive";
import { LocalFilesystemBackupStore } from "../../server/localFilesystemBackupStore";
import { ingestLocalGeoTiff } from "../../server/localRasterService";

const execFile = promisify(execFileCallback);
const root = await mkdtemp(join(tmpdir(), "arqueo-valid-cog-backup-"));
const run = (file: string, args: string[]) => execFile(file, args, { cwd: process.cwd(), env: { ...process.env, PYTHONNOUSERSITE: "1", PYTHONPATH: "/usr/lib/python3/dist-packages" }, maxBuffer: 4 * 1024 * 1024 });
try {
  const fixture = join(root, "fixture");
  await run("/usr/bin/python3", ["infra/raster/generate_synthetic_rasters.py", "--output-dir", fixture]);
  const raw = await readFile(join(fixture, "before_raw_epsg4326.tif"));
  const ingested = await ingestLocalGeoTiff({ root: join(root, "raster-volume"), projectId: 73, layerId: 19, bytes: raw, acquisitionAt: "2026-10-29T00:00:00Z", sourceLabel: "fixture sintética válida para backup COG", minZoom: 12, maxZoom: 12, nodata: 0 });
  const cogBytes = await readFile(join(root, "raster-volume", ...ingested.cogKey.split("/")));
  const artifact = buildBackupArtifact({ users: [{ id: 1, openId: "fixture", name: "Fixture" }], projects: [{ id: 73, code: "COG-TEST", name: "COG test", createdBy: 1 }], project_members: [{ id: 1, projectId: 73, userId: 1, role: "owner" }], files: [{ id: 1, projectId: 73, s3Key: ingested.cogKey }], layers: [{ id: 19, projectId: 73, name: "COG", layerType: "raster" }], audit_logs: [{ id: 1, action: "fixture.valid-cog" }] }, { backupId: "valid-cog-roundtrip", createdAt: "2026-10-29T00:00:00.000Z" });
  const source = new LocalFilesystemBackupStore(join(root, "source"));
  const archive = new LocalFilesystemBackupStore(join(root, "archive"));
  await source.put(ingested.cogKey, cogBytes);
  const archived = await createLocalFilesystemArchive({ artifact, source, target: archive });
  const restored = await restoreLocalFilesystemArchive({ backupId: artifact.manifest.backupId, store: archive });
  const restoredCog = restored.objects.find((item) => item.logicalKey === ingested.cogKey);
  if (!restoredCog || !restoredCog.bytes.equals(cogBytes)) throw new Error("Bytes do COG restaurado divergem da origem");
  const restoredPath = join(root, "restored.cog.tif");
  await writeFile(restoredPath, restoredCog.bytes);
  const { stdout } = await run("gdalinfo", ["-json", restoredPath]);
  const info = JSON.parse(stdout);
  if (info.metadata?.IMAGE_STRUCTURE?.LAYOUT !== "COG" || !info.bands?.every((band: any) => band.noDataValue === 0)) throw new Error("GDAL não validou COG/NoData após restore");
  console.log(JSON.stringify({ status: "passed", mode: "valid-cog-physical-backup-roundtrip", productionConnections: 0, rawBytes: raw.byteLength, cogBytes: cogBytes.byteLength, sourceSha256: ingested.sourceSha256, cogSha256: ingested.cogSha256, restoredSha256: ingested.cogSha256, copiedObjects: archived.manifest.totals.copiedObjects, gdalLayout: info.metadata.IMAGE_STRUCTURE.LAYOUT, nodataValidated: true, root: process.env.KEEP_VALID_COG_BACKUP_REHEARSAL === "1" ? root : "removed-after-rehearsal" }, null, 2));
} finally { if (process.env.KEEP_VALID_COG_BACKUP_REHEARSAL !== "1") await rm(root, { recursive: true, force: true }); }
