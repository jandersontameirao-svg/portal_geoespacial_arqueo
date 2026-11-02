import { createHash, randomUUID } from "node:crypto";
import { backupTableRegistry, type BackupTableName } from "./backupTableRegistry";

export type BackupRows = Partial<Record<BackupTableName, Array<Record<string, unknown>>>>;
export type ObjectReference = {
  logicalKey: string;
  source: { table: BackupTableName; primaryKey: unknown; field: string };
  required: boolean;
};

export type GroupedObjectReferences = Array<{ logicalKey: string; references: ObjectReference[] }>;

export type BackupManifest = {
  formatVersion: "2.0-local-rehearsal";
  backupId: string;
  createdAt: string;
  schemaFingerprint: string;
  tables: Array<{ name: BackupTableName; primaryKey: string; rowCount: number; sha256: string }>;
  objectReferences: ObjectReference[];
  totals: { rows: number; requiredObjects: number };
  integrity: { algorithm: "sha256"; payloadSha256: string };
  completeness: "complete" | "incomplete";
};

export type BackupArtifact = {
  manifest: BackupManifest;
  tables: BackupRows;
};

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeRows(rows: Array<Record<string, unknown>> | undefined): Array<Record<string, unknown>> {
  return [...(rows || [])].sort((first, second) => String(first.id ?? "").localeCompare(String(second.id ?? "")));
}

export function inventoryObjectReferences(tables: BackupRows): ObjectReference[] {
  const references: ObjectReference[] = [];
  const fields: Array<{ table: BackupTableName; field: string }> = [
    { table: "files", field: "s3Key" },
    { table: "file_versions", field: "s3Key" },
    { table: "base_layers", field: "s3Key" },
    { table: "gis_uploads", field: "s3Key" },
    { table: "print_jobs", field: "outputS3Key" },
    { table: "atlas_jobs", field: "outputS3Key" },
  ];
  for (const entry of fields) {
    for (const row of tables[entry.table] || []) {
      const key = row[entry.field];
      if (typeof key === "string" && key.trim()) {
        references.push({ logicalKey: key, source: { table: entry.table, primaryKey: row.id, field: entry.field }, required: true });
      }
    }
  }
  for (const row of tables.atlas_jobs || []) {
    const pages = row.individualPagesUrls;
    if (!Array.isArray(pages)) continue;
    for (const page of pages) {
      if (page && typeof page === "object" && typeof (page as Record<string, unknown>).s3Key === "string") {
        const key = (page as Record<string, unknown>).s3Key as string;
        if (key.trim()) references.push({ logicalKey: key, source: { table: "atlas_jobs", primaryKey: row.id, field: "individualPagesUrls[].s3Key" }, required: true });
      }
    }
  }
  return references.sort((a, b) => a.logicalKey.localeCompare(b.logicalKey));
}

/** Mantém proveniência de todas as linhas, mas permite copiar um blob apenas uma vez. */
export function groupObjectReferences(references: ObjectReference[]): GroupedObjectReferences {
  const grouped = new Map<string, ObjectReference[]>();
  for (const reference of references) grouped.set(reference.logicalKey, [...(grouped.get(reference.logicalKey) || []), reference]);
  return Array.from(grouped.entries())
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([logicalKey, groupedReferences]) => ({ logicalKey, references: groupedReferences }));
}

export function buildBackupArtifact(tables: BackupRows, options?: { backupId?: string; createdAt?: string; schemaFingerprint?: string }): BackupArtifact {
  const normalized: BackupRows = {};
  for (const table of backupTableRegistry) normalized[table.name] = normalizeRows(tables[table.name]);
  const tableManifest = backupTableRegistry.map((table) => {
    const rows = normalized[table.name] || [];
    return { name: table.name, primaryKey: table.primaryKey, rowCount: rows.length, sha256: sha256(canonicalize(rows)) };
  });
  const objectReferences = inventoryObjectReferences(normalized);
  const payload = canonicalize(normalized);
  return {
    manifest: {
      formatVersion: "2.0-local-rehearsal",
      backupId: options?.backupId || randomUUID(),
      createdAt: options?.createdAt || new Date().toISOString(),
      schemaFingerprint: options?.schemaFingerprint || sha256(backupTableRegistry.map((table) => `${table.name}:${table.primaryKey}`).join("|")),
      tables: tableManifest,
      objectReferences,
      totals: { rows: tableManifest.reduce((total, table) => total + table.rowCount, 0), requiredObjects: objectReferences.length },
      integrity: { algorithm: "sha256", payloadSha256: sha256(payload) },
      completeness: "complete",
    },
    tables: normalized,
  };
}

export function verifyBackupArtifact(artifact: BackupArtifact): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const expectedTables = new Map(backupTableRegistry.map((entry) => [entry.name, entry.primaryKey]));
  const manifestCounts = new Map<BackupTableName, number>();
  for (const table of artifact.manifest.tables) {
    const expectedPrimaryKey = expectedTables.get(table.name);
    if (!expectedPrimaryKey) {
      errors.push(`Tabela desconhecida no manifesto: ${table.name}`);
      continue;
    }
    manifestCounts.set(table.name, (manifestCounts.get(table.name) || 0) + 1);
    if (table.primaryKey !== expectedPrimaryKey) errors.push(`Chave primária divergente: ${table.name}`);
    const rows = normalizeRows(artifact.tables[table.name]);
    if (rows.length !== table.rowCount) errors.push(`Contagem divergente: ${table.name}`);
    if (sha256(canonicalize(rows)) !== table.sha256) errors.push(`Hash divergente: ${table.name}`);
  }
  for (const table of backupTableRegistry) {
    const count = manifestCounts.get(table.name) || 0;
    if (count !== 1) errors.push(count === 0 ? `Tabela ausente no manifesto: ${table.name}` : `Tabela duplicada no manifesto: ${table.name}`);
  }
  const payload = canonicalize(Object.fromEntries(backupTableRegistry.map((table) => [table.name, normalizeRows(artifact.tables[table.name])])))
  if (sha256(payload) !== artifact.manifest.integrity.payloadSha256) errors.push("Hash global divergente");
  if (artifact.manifest.completeness !== "complete") errors.push("Manifesto marcado como incompleto");
  return { valid: errors.length === 0, errors };
}

/**
 * Restauração deliberadamente não destrutiva: monta clone em memória para ensaio.
 * Não abre conexões, não chama storage e não recebe URL/credenciais de destino.
 */
export function restoreToIsolatedMemory(artifact: BackupArtifact, mode: "local-rehearsal"): BackupRows {
  if (mode !== "local-rehearsal") throw new Error("Restauração permitida somente em modo local-rehearsal");
  const verification = verifyBackupArtifact(artifact);
  if (!verification.valid) throw new Error(`Backup inválido: ${verification.errors.join("; ")}`);
  return JSON.parse(JSON.stringify(artifact.tables)) as BackupRows;
}
