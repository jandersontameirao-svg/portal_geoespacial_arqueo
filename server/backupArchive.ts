import { BackupIntegrityError, type BackupObjectHead, type BackupStore, normalizeBackupKey, objectBackupKey, sha256Buffer } from "./backupStore";
import { buildBackupArtifact, groupObjectReferences, restoreToIsolatedMemory, sha256, type BackupArtifact, type BackupRows, verifyBackupArtifact } from "./backupManifest";

export type LocalArchiveObject = {
  logicalKey: string;
  backupKey: string | null;
  byteLength: number | null;
  sha256: string | null;
  status: "copied" | "missing" | "unreadable";
  references: ReturnType<typeof groupObjectReferences>[number]["references"];
};

export type LocalFilesystemBackupManifest = {
  formatVersion: "1.0-local-filesystem";
  backupId: string;
  createdAt: string;
  artifact: BackupObjectHead & { payloadSha256: string };
  objects: LocalArchiveObject[];
  totals: { objectReferences: number; distinctRequiredObjects: number; copiedObjects: number; missingObjects: number };
  completeness: "complete" | "incomplete";
  recovery: { provider: "local-filesystem"; remoteIntegration: "blocked" };
};

export type LocalArchiveResult = {
  manifest: LocalFilesystemBackupManifest;
  manifestKey: string;
  manifestChecksumKey: string;
  archiveBytes: number;
  objectBytes: number;
};

function archivePrefix(backupId: string) {
  const id = normalizeBackupKey(backupId);
  return `backups/${id}`;
}

function manifestKeys(backupId: string) {
  const prefix = archivePrefix(backupId);
  return { artifactKey: `${prefix}/artifact.json`, manifestKey: `${prefix}/manifest.json`, checksumKey: `${prefix}/manifest.sha256` };
}

function serialize(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
}

export async function createLocalFilesystemArchive(input: { artifact: BackupArtifact; source: BackupStore; target: BackupStore }): Promise<LocalArchiveResult> {
  const verification = verifyBackupArtifact(input.artifact);
  if (!verification.valid) throw new BackupIntegrityError(`Artefato tabular inválido: ${verification.errors.join("; ")}`);
  const { backupId, createdAt } = input.artifact.manifest;
  const keys = manifestKeys(backupId);
  const artifactBytes = serialize(input.artifact);
  const artifactHead = await input.target.put(keys.artifactKey, artifactBytes);
  if (artifactHead.sha256 !== sha256Buffer(artifactBytes)) throw new BackupIntegrityError("Hash do artifact.json divergente após escrita");

  const groups = groupObjectReferences(input.artifact.manifest.objectReferences);
  const objects: LocalArchiveObject[] = [];
  for (const group of groups) {
    try {
      const sourceObject = await input.source.get(group.logicalKey);
      if (!sourceObject) {
        objects.push({ logicalKey: group.logicalKey, backupKey: null, byteLength: null, sha256: null, status: "missing", references: group.references });
        continue;
      }
      const backupKey = objectBackupKey(backupId, group.logicalKey);
      const copiedHead = await input.target.put(backupKey, sourceObject.body);
      const reloaded = await input.target.get(backupKey);
      if (!reloaded || reloaded.head.sha256 !== copiedHead.sha256 || reloaded.head.byteLength !== copiedHead.byteLength || sha256Buffer(reloaded.body) !== copiedHead.sha256) {
        throw new BackupIntegrityError(`Falha de verificação da cópia: ${group.logicalKey}`);
      }
      objects.push({ logicalKey: group.logicalKey, backupKey, byteLength: copiedHead.byteLength, sha256: copiedHead.sha256, status: "copied", references: group.references });
    } catch (error) {
      if (error instanceof BackupIntegrityError) throw error;
      objects.push({ logicalKey: group.logicalKey, backupKey: null, byteLength: null, sha256: null, status: "unreadable", references: group.references });
    }
  }
  const copiedObjects = objects.filter((item) => item.status === "copied").length;
  const missingObjects = objects.length - copiedObjects;
  const manifest: LocalFilesystemBackupManifest = {
    formatVersion: "1.0-local-filesystem",
    backupId,
    createdAt,
    artifact: { ...artifactHead, payloadSha256: input.artifact.manifest.integrity.payloadSha256 },
    objects,
    totals: {
      objectReferences: input.artifact.manifest.objectReferences.length,
      distinctRequiredObjects: groups.length,
      copiedObjects,
      missingObjects,
    },
    completeness: missingObjects === 0 ? "complete" : "incomplete",
    recovery: { provider: "local-filesystem", remoteIntegration: "blocked" },
  };
  const manifestBytes = serialize(manifest);
  const manifestHead = await input.target.put(keys.manifestKey, manifestBytes);
  const checksumHead = await input.target.put(keys.checksumKey, `${manifestHead.sha256}\n`);
  const objectBytes = objects.reduce((total, item) => total + (item.byteLength || 0), 0);
  return { manifest, manifestKey: keys.manifestKey, manifestChecksumKey: keys.checksumKey, objectBytes, archiveBytes: artifactHead.byteLength + manifestHead.byteLength + checksumHead.byteLength + objectBytes };
}

/** Remove somente os objetos pertencentes a um backup encerrado pela política de retenção. */
export async function purgeLocalFilesystemArchive(input: { backupId: string; store: BackupStore }): Promise<{ deletedObjects: number; deletedBytes: number }> {
  const prefix = archivePrefix(input.backupId);
  const heads = await input.store.list(prefix);
  let deletedObjects = 0;
  let deletedBytes = 0;
  for (const head of heads) {
    if (await input.store.delete(head.key)) {
      deletedObjects++;
      deletedBytes += head.byteLength;
    }
  }
  return { deletedObjects, deletedBytes };
}

export async function restoreLocalFilesystemArchive(input: { backupId: string; store: BackupStore }): Promise<{ tables: BackupRows; objects: Array<{ logicalKey: string; bytes: Buffer }> }> {
  const keys = manifestKeys(input.backupId);
  const manifestObject = await input.store.get(keys.manifestKey);
  const checksumObject = await input.store.get(keys.checksumKey);
  if (!manifestObject || !checksumObject) throw new BackupIntegrityError("Manifesto ou checksum de manifesto ausente");
  const expectedManifestHash = checksumObject.body.toString("utf8").trim();
  if (!/^[a-f0-9]{64}$/i.test(expectedManifestHash) || sha256Buffer(manifestObject.body) !== expectedManifestHash) {
    throw new BackupIntegrityError("Checksum do manifesto divergente");
  }
  let manifest: LocalFilesystemBackupManifest;
  try { manifest = JSON.parse(manifestObject.body.toString("utf8")) as LocalFilesystemBackupManifest; }
  catch { throw new BackupIntegrityError("Manifesto local não é JSON válido"); }
  if (manifest.formatVersion !== "1.0-local-filesystem" || manifest.backupId !== input.backupId) throw new BackupIntegrityError("Manifesto não corresponde ao backup solicitado");
  if (manifest.completeness !== "complete") throw new BackupIntegrityError("Backup incompleto não pode ser restaurado");
  if (manifest.recovery.remoteIntegration !== "blocked") throw new BackupIntegrityError("Modo de recuperação inesperado");

  const artifactObject = await input.store.get(manifest.artifact.key);
  if (!artifactObject || artifactObject.head.sha256 !== manifest.artifact.sha256 || artifactObject.head.byteLength !== manifest.artifact.byteLength) {
    throw new BackupIntegrityError("artifact.json ausente ou corrompido");
  }
  let artifact: BackupArtifact;
  try { artifact = JSON.parse(artifactObject.body.toString("utf8")) as BackupArtifact; }
  catch { throw new BackupIntegrityError("artifact.json não é JSON válido"); }
  if (artifact.manifest.integrity.payloadSha256 !== manifest.artifact.payloadSha256 || sha256(serialize(artifact)) !== manifest.artifact.sha256) {
    throw new BackupIntegrityError("Integridade do artifact.json divergente");
  }
  const tables = restoreToIsolatedMemory(artifact, "local-rehearsal");
  const objects: Array<{ logicalKey: string; bytes: Buffer }> = [];
  for (const item of manifest.objects) {
    if (item.status !== "copied" || !item.backupKey || item.byteLength === null || !item.sha256) throw new BackupIntegrityError(`Objeto obrigatório indisponível: ${item.logicalKey}`);
    const object = await input.store.get(item.backupKey);
    if (!object || object.head.byteLength !== item.byteLength || object.head.sha256 !== item.sha256 || sha256Buffer(object.body) !== item.sha256) {
      throw new BackupIntegrityError(`Objeto corrompido ou ausente: ${item.logicalKey}`);
    }
    objects.push({ logicalKey: item.logicalKey, bytes: object.body });
  }
  return { tables, objects };
}

/** Fixture pequena que permite scripts locais criarem um artifact coerente sem banco. */
export function createSyntheticArchiveArtifact() {
  return buildBackupArtifact({
    users: [{ id: 1, openId: "synthetic-admin", name: "Admin sintético" }],
    projects: [{ id: 2, code: "SYN-RASTER", name: "Projeto raster sintético", createdBy: 1 }],
    project_members: [{ id: 3, projectId: 2, userId: 1, role: "owner" }],
    files: [{ id: 4, projectId: 2, s3Key: "synthetic/rasters/before.cog.tif" }],
    file_versions: [{ id: 5, fileId: 4, version: 1, s3Key: "synthetic/rasters/before-v1.cog.tif" }],
    base_layers: [{ id: 6, s3Key: "synthetic/base/official.geojson" }],
    layers: [{ id: 7, projectId: 2, name: "COG sintético" }],
    print_jobs: [{ id: 8, projectId: 2, outputS3Key: "synthetic/exports/map.pdf" }],
    atlas_jobs: [{ id: 9, projectId: 2, outputS3Key: "synthetic/atlas/atlas.pdf", individualPagesUrls: [{ page: 1, s3Key: "synthetic/atlas/page-1.pdf" }] }],
    gis_uploads: [{ id: 10, projectId: 2, s3Key: "synthetic/uploads/aoi.kmz" }],
    audit_logs: [{ id: 11, action: "fixture.archive.create" }],
  }, { backupId: "local-archive-fixture", createdAt: "2026-10-29T00:00:00.000Z" });
}
