import { createHash } from "node:crypto";
import path from "node:path";

export type BackupObjectHead = {
  key: string;
  byteLength: number;
  sha256: string;
};

export type BackupObject = {
  head: BackupObjectHead;
  body: Buffer;
};

/**
 * Porta de bytes para backups. Não reutiliza server/storage.ts: aquele adaptador
 * retorna uma URL pública, mas não suporta get/head/list por chave estável.
 */
export interface BackupStore {
  put(key: string, body: Buffer | Uint8Array | string): Promise<BackupObjectHead>;
  get(key: string): Promise<BackupObject | null>;
  head(key: string): Promise<BackupObjectHead | null>;
  list(prefix?: string): Promise<BackupObjectHead[]>;
  delete(key: string): Promise<boolean>;
}

export const REMOTE_BACKUP_INTEGRATION = Object.freeze({
  enabled: false,
  reason: "Integração remota bloqueada: storage.ts não implementa get/head/list privado por chave estável.",
});

export class BackupIntegrityError extends Error {}
export class BackupKeyError extends Error {}
export class BackupConflictError extends Error {}

export function sha256Buffer(data: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Apenas chaves POSIX relativas e segmentadas. Nunca usar chave de origem como path. */
export function normalizeBackupKey(key: string): string {
  if (!key || key.length > 1024 || key.includes("\\") || key.includes("\0")) {
    throw new BackupKeyError("Chave de backup inválida");
  }
  const normalized = path.posix.normalize(key);
  if (
    path.posix.isAbsolute(normalized) ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new BackupKeyError("Chave de backup deve ser relativa e não pode conter traversal");
  }
  return normalized;
}

export function objectBackupKey(backupId: string, logicalKey: string): string {
  const id = normalizeBackupKey(backupId);
  return `backups/${id}/objects/${sha256Buffer(logicalKey)}.bin`;
}
