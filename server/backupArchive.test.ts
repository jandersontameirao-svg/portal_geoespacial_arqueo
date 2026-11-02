import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BackupIntegrityError, objectBackupKey } from "./backupStore";
import { createLocalFilesystemArchive, createSyntheticArchiveArtifact, purgeLocalFilesystemArchive, restoreLocalFilesystemArchive } from "./backupArchive";
import { buildBackupArtifact } from "./backupManifest";
import { LocalFilesystemBackupStore } from "./localFilesystemBackupStore";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
async function setup() {
  const sourceRoot = await mkdtemp(path.join(tmpdir(), "arqueo-source-"));
  const targetRoot = await mkdtemp(path.join(tmpdir(), "arqueo-target-"));
  roots.push(sourceRoot, targetRoot);
  const source = new LocalFilesystemBackupStore(sourceRoot);
  const target = new LocalFilesystemBackupStore(targetRoot);
  const artifact = createSyntheticArchiveArtifact();
  for (const reference of artifact.manifest.objectReferences) await source.put(reference.logicalKey, Buffer.from(`bytes:${reference.logicalKey}\0`, "utf8"));
  return { sourceRoot, targetRoot, source, target, artifact };
}

async function archiveFixture() {
  const fixture = await setup();
  const archive = await createLocalFilesystemArchive({ artifact: fixture.artifact, source: fixture.source, target: fixture.target });
  return { ...fixture, archive };
}

describe("arquivo recuperável local", () => {
  it("copia bytes reais uma única vez e restaura tabelas e objetos", async () => {
    const { source, target, artifact } = await setup();
    const duplicateArtifact = buildBackupArtifact({
      ...artifact.tables,
      file_versions: [...(artifact.tables.file_versions || []), { id: 99, fileId: 4, version: 2, s3Key: "synthetic/rasters/before.cog.tif" }],
    }, { backupId: artifact.manifest.backupId, createdAt: artifact.manifest.createdAt });
    const archive = await createLocalFilesystemArchive({ artifact: duplicateArtifact, source, target });
    expect(archive.manifest.completeness).toBe("complete");
    expect(archive.manifest.totals.objectReferences).toBeGreaterThan(archive.manifest.totals.distinctRequiredObjects);
    expect(archive.manifest.totals.copiedObjects).toBe(archive.manifest.totals.distinctRequiredObjects);
    const restored = await restoreLocalFilesystemArchive({ backupId: duplicateArtifact.manifest.backupId, store: target });
    expect(restored.tables.projects?.[0].code).toBe("SYN-RASTER");
    expect(restored.objects).toHaveLength(archive.manifest.totals.distinctRequiredObjects);
    expect(restored.objects.find((item) => item.logicalKey === "synthetic/rasters/before.cog.tif")?.bytes.toString()).toContain("bytes:synthetic/rasters/before.cog.tif");
  });

  it("marca arquivo incompleto e bloqueia restore quando um blob obrigatório está ausente", async () => {
    const { sourceRoot, source, target, artifact } = await setup();
    const missing = artifact.manifest.objectReferences[0].logicalKey;
    await rm(path.join(sourceRoot, ...missing.split("/")));
    const archive = await createLocalFilesystemArchive({ artifact, source, target });
    expect(archive.manifest.completeness).toBe("incomplete");
    await expect(restoreLocalFilesystemArchive({ backupId: artifact.manifest.backupId, store: target })).rejects.toBeInstanceOf(BackupIntegrityError);
  });

  it("detecta alteração de bytes de objeto", async () => {
    const { targetRoot, target, artifact } = await archiveFixture();
    await writeFile(path.join(targetRoot, ...objectBackupKey(artifact.manifest.backupId, "synthetic/rasters/before.cog.tif").split("/")), "corrompido");
    await expect(restoreLocalFilesystemArchive({ backupId: artifact.manifest.backupId, store: target })).rejects.toThrow("Objeto corrompido");
  });

  it("detecta artifact.json e manifesto corrompidos", async () => {
    const first = await archiveFixture();
    await writeFile(path.join(first.targetRoot, "backups", first.artifact.manifest.backupId, "artifact.json"), "{}");
    await expect(restoreLocalFilesystemArchive({ backupId: first.artifact.manifest.backupId, store: first.target })).rejects.toThrow("artifact.json ausente ou corrompido");

    const second = await archiveFixture();
    await writeFile(path.join(second.targetRoot, "backups", second.artifact.manifest.backupId, "manifest.json"), "{}");
    await expect(restoreLocalFilesystemArchive({ backupId: second.artifact.manifest.backupId, store: second.target })).rejects.toThrow("Checksum do manifesto divergente");
  });

  it("remove somente a árvore do backup vencido durante a retenção", async () => {
    const { target, artifact } = await archiveFixture();
    await target.put("backups/outro-backup/artifact.json", "preservado");
    const removed = await purgeLocalFilesystemArchive({ backupId: artifact.manifest.backupId, store: target });
    expect(removed.deletedObjects).toBeGreaterThan(2);
    expect(await target.list(`backups/${artifact.manifest.backupId}`)).toHaveLength(0);
    expect(await target.get("backups/outro-backup/artifact.json")).not.toBeNull();
  });
});
