#!/usr/bin/env tsx
/** Ensaio local sem banco, S3, OAuth ou dados de produção. */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBackupArtifact, restoreToIsolatedMemory, sha256, verifyBackupArtifact } from "../../server/backupManifest";

const output = await mkdtemp(join(tmpdir(), "arqueo-backup-rehearsal-"));
try {
  const artifact = buildBackupArtifact({
    users: [{ id: 1, openId: "synthetic-admin", name: "Admin Sintético" }],
    projects: [{ id: 10, code: "SYN-001", name: "Projeto Sintético", createdBy: 1 }],
    project_members: [{ id: 11, projectId: 10, userId: 1, role: "owner" }],
    files: [{ id: 12, projectId: 10, s3Key: "synthetic/files/a.tif" }],
    file_versions: [{ id: 13, fileId: 12, version: 1, s3Key: "synthetic/files/a-v1.tif" }],
    base_layers: [{ id: 14, s3Key: "synthetic/base/a.geojson" }],
    layers: [{ id: 15, projectId: 10, name: "Raster sintético" }],
    geometries: [{ id: 16, projectId: 10, name: "AOI" }],
    saved_maps: [{ id: 17, projectId: 10, name: "Mapa" }],
    print_jobs: [{ id: 18, projectId: 10, outputS3Key: "synthetic/print/a.pdf" }],
    atlas_jobs: [{ id: 19, projectId: 10, outputS3Key: "synthetic/atlas/a.pdf", individualPagesUrls: [{ page: 1, s3Key: "synthetic/atlas/page-1.pdf" }] }],
    gis_uploads: [{ id: 20, projectId: 10, s3Key: "synthetic/upload/a.kmz" }],
    notifications: [{ id: 21, userId: 1, title: "Fixture" }],
    audit_logs: [{ id: 22, action: "fixture.create" }],
  }, { backupId: "local-synthetic-rehearsal", createdAt: "2026-10-29T00:00:00.000Z" });

  const artifactPath = join(output, "backup-artifact.json");
  const content = JSON.stringify(artifact, null, 2) + "\n";
  await writeFile(artifactPath, content, "utf8");
  const fromDisk = JSON.parse(await readFile(artifactPath, "utf8"));
  const verification = verifyBackupArtifact(fromDisk);
  if (!verification.valid) throw new Error(`Manifesto inválido: ${verification.errors.join("; ")}`);
  const restored = restoreToIsolatedMemory(fromDisk, "local-rehearsal");
  const report = {
    status: "passed",
    scope: "fixture sintética / restauração em memória local",
    artifactSha256: sha256(content),
    tables: fromDisk.manifest.tables.length,
    rows: fromDisk.manifest.totals.rows,
    requiredObjectsReferenced: fromDisk.manifest.totals.requiredObjects,
    restoredProjects: restored.projects?.length || 0,
    diskArtifact: artifactPath,
    productionConnections: 0,
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (process.env.KEEP_BACKUP_REHEARSAL !== "1") await rm(output, { recursive: true, force: true });
}
