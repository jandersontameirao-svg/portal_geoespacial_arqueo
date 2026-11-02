#!/usr/bin/env tsx
/** Ensaio local recuperável: copia bytes sintéticos, verifica hashes e restaura sem serviços externos. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalFilesystemArchive, createSyntheticArchiveArtifact, restoreLocalFilesystemArchive } from "../../server/backupArchive";
import { LocalFilesystemBackupStore } from "../../server/localFilesystemBackupStore";

const root = await mkdtemp(join(tmpdir(), "arqueo-local-backup-roundtrip-"));
try {
  const source = new LocalFilesystemBackupStore(join(root, "source"));
  const target = new LocalFilesystemBackupStore(join(root, "archive"));
  const artifact = createSyntheticArchiveArtifact();
  for (const reference of artifact.manifest.objectReferences) {
    if (!await source.head(reference.logicalKey)) await source.put(reference.logicalKey, Buffer.from(`synthetic-bytes:${reference.logicalKey}\0`, "utf8"));
  }
  const archive = await createLocalFilesystemArchive({ artifact, source, target });
  const restored = await restoreLocalFilesystemArchive({ backupId: artifact.manifest.backupId, store: target });
  console.log(JSON.stringify({
    status: "passed",
    mode: "local-filesystem-rehearsal",
    backupId: artifact.manifest.backupId,
    tables: artifact.manifest.tables.length,
    rows: artifact.manifest.totals.rows,
    objectReferences: archive.manifest.totals.objectReferences,
    distinctObjects: archive.manifest.totals.distinctRequiredObjects,
    copiedObjects: archive.manifest.totals.copiedObjects,
    restoredObjects: restored.objects.length,
    restoredProjects: restored.tables.projects?.length || 0,
    remoteIntegration: archive.manifest.recovery.remoteIntegration,
    productionConnections: 0,
    root: process.env.KEEP_BACKUP_REHEARSAL === "1" ? root : "removed-after-rehearsal",
  }, null, 2));
} finally {
  if (process.env.KEEP_BACKUP_REHEARSAL !== "1") await rm(root, { recursive: true, force: true });
}
