import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type BackupObject,
  type BackupObjectHead,
  type BackupStore,
  BackupConflictError,
  BackupKeyError,
  normalizeBackupKey,
  sha256Buffer,
} from "./backupStore";

function toBuffer(body: Buffer | Uint8Array | string): Buffer {
  return Buffer.isBuffer(body) ? body : typeof body === "string" ? Buffer.from(body) : Buffer.from(body);
}

/**
 * Store exclusivamente local para ensaio e recuperação em filesystem. A raiz precisa
 * ser absoluta e externa ao repositório; nenhum caminho absoluto é exposto ao cliente.
 */
export class LocalFilesystemBackupStore implements BackupStore {
  private readonly root: string;

  constructor(rootDir: string) {
    if (!path.isAbsolute(rootDir)) throw new BackupKeyError("A raiz do LocalFilesystemBackupStore deve ser absoluta");
    this.root = path.resolve(rootDir);
  }

  private resolve(key: string): { key: string; filename: string } {
    const safeKey = normalizeBackupKey(key);
    const filename = path.resolve(this.root, ...safeKey.split("/"));
    if (filename !== this.root && !filename.startsWith(`${this.root}${path.sep}`)) {
      throw new BackupKeyError("Chave resolve fora da raiz de backup");
    }
    return { key: safeKey, filename };
  }

  private async headFor(key: string, filename: string): Promise<BackupObjectHead | null> {
    try {
      const info = await stat(filename);
      if (!info.isFile()) return null;
      const bytes = await readFile(filename);
      return { key, byteLength: bytes.byteLength, sha256: sha256Buffer(bytes) };
    } catch (error: any) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async put(key: string, body: Buffer | Uint8Array | string): Promise<BackupObjectHead> {
    const target = this.resolve(key);
    const bytes = toBuffer(body);
    const candidate: BackupObjectHead = { key: target.key, byteLength: bytes.byteLength, sha256: sha256Buffer(bytes) };
    await mkdir(path.dirname(target.filename), { recursive: true, mode: 0o700 });

    const existing = await this.headFor(target.key, target.filename);
    if (existing) {
      if (existing.byteLength === candidate.byteLength && existing.sha256 === candidate.sha256) return existing;
      throw new BackupConflictError(`Conflito: a chave ${target.key} já contém bytes diferentes`);
    }

    const temporary = path.join(path.dirname(target.filename), `.${path.basename(target.filename)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
      await rename(temporary, target.filename);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    const written = await this.headFor(target.key, target.filename);
    if (!written || written.sha256 !== candidate.sha256 || written.byteLength !== candidate.byteLength) {
      throw new Error(`Falha ao verificar escrita local de ${target.key}`);
    }
    return written;
  }

  async get(key: string): Promise<BackupObject | null> {
    const target = this.resolve(key);
    const head = await this.headFor(target.key, target.filename);
    if (!head) return null;
    return { head, body: await readFile(target.filename) };
  }

  async head(key: string): Promise<BackupObjectHead | null> {
    const target = this.resolve(key);
    return this.headFor(target.key, target.filename);
  }

  async list(prefix = ""): Promise<BackupObjectHead[]> {
    const normalizedPrefix = prefix ? normalizeBackupKey(prefix) : "";
    const results: BackupObjectHead[] = [];
    const visit = async (directory: string, relative: string): Promise<void> => {
      let entries: Dirent[];
      try { entries = await readdir(directory, { encoding: "utf8", withFileTypes: true }); }
      catch (error: any) { if (error?.code === "ENOENT") return; throw error; }
      for (const entry of entries) {
        const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(fullPath, nextRelative);
        else if (entry.isFile() && (!normalizedPrefix || nextRelative.startsWith(normalizedPrefix))) {
          const item = await this.headFor(nextRelative, fullPath);
          if (item) results.push(item);
        }
      }
    };
    await visit(this.root, "");
    return results.sort((a, b) => a.key.localeCompare(b.key));
  }

  async delete(key: string): Promise<boolean> {
    const target = this.resolve(key);
    try {
      await unlink(target.filename);
      return true;
    } catch (error: any) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }
}
