/**
 * Storage local em disco (on-premise / VPS).
 *
 * Substitui o antigo adaptador `manus-upload-file` (write-only, dependente do
 * ambiente Manus e indisponível na VPS). Os bytes são gravados sob um diretório
 * raiz no servidor e servidos por uma rota autenticada (`/api/storage/<key>`),
 * que exige sessão válida — ver `server/storageAssetRoutes.ts`.
 */

import path from "node:path";
import fs from "node:fs/promises";

/**
 * Raiz do storage no servidor. Default: `<cwd>/data/uploads`.
 * Em produção o PM2 roda com cwd=/var/www/geoportal, então os arquivos ficam em
 * /var/www/geoportal/data/uploads. Pode ser sobrescrito por
 * ARQUEO_LOCAL_STORAGE_ROOT (path absoluto).
 */
export function getStorageRoot(value = process.env.ARQUEO_LOCAL_STORAGE_ROOT): string {
  const root = value && value.trim() ? value.trim() : path.resolve(process.cwd(), "data", "uploads");
  return path.resolve(root);
}

/**
 * Resolve a chave lógica para um caminho em disco dentro da raiz, bloqueando
 * travessia de diretório. Determinística: o mesmo input gera o mesmo caminho na
 * escrita e na leitura.
 */
export function storagePathForKey(key: string, root = getStorageRoot()): string {
  const normalized = String(key).replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) throw new Error("Chave de storage inválida (vazia)");
  if (segments.some((s) => s === "." || s === "..")) throw new Error("Chave de storage inválida (travessia de diretório)");
  const target = path.resolve(root, ...segments);
  const rel = path.relative(root, target);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Chave de storage fora do diretório permitido");
  }
  return target;
}

/** URL relativa, servida pela rota autenticada, que o front usa diretamente. */
export function storageUrlForKey(key: string): string {
  const normalized = String(key).replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean).map(encodeURIComponent);
  return `/api/storage/${segments.join("/")}`;
}

/**
 * Grava um arquivo no storage local.
 * @param key - Chave lógica do arquivo (ex.: `projects/1/files/abc-foto.jpg`).
 * @param data - Bytes do arquivo (Buffer, Uint8Array ou string).
 * @param _contentType - MIME (informativo; o tipo é derivado da extensão ao servir).
 * @returns `{ key, url }` com a URL relativa autenticada.
 */
export async function storagePut(
  key: string,
  data: Buffer | Uint8Array | string,
  _contentType?: string
): Promise<{ key: string; url: string }> {
  const buffer = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
  const target = storagePathForKey(key);
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer);
    return { key, url: storageUrlForKey(key) };
  } catch (error: any) {
    console.error("[Storage] Falha ao gravar arquivo:", { key, target, message: error?.message });
    throw new Error(`Falha ao fazer upload do arquivo: ${error?.message ?? error}`);
  }
}

/**
 * Confirma que o objeto existe e devolve a URL de acesso.
 * Mantém a assinatura antiga (`expiresIn` ignorado: a rota é autenticada por sessão).
 */
export async function storageGet(
  key: string,
  _expiresIn?: number
): Promise<{ key: string; url: string }> {
  const target = storagePathForKey(key);
  await fs.access(target);
  return { key, url: storageUrlForKey(key) };
}

/** Lê os bytes de um objeto do storage local (uso no servidor). */
export async function storageReadBytes(key: string): Promise<Buffer> {
  return fs.readFile(storagePathForKey(key));
}
