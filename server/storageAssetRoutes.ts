import type { Express, Request, Response } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sdk } from "./_core/sdk";
import { storagePathForKey } from "./storage";

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".geojson": "application/geo+json",
  ".json": "application/json",
  ".kml": "application/vnd.google-earth.kml+xml",
  ".kmz": "application/vnd.google-earth.kmz",
  ".xml": "application/xml",
  ".csv": "text/csv",
  ".txt": "text/plain; charset=utf-8",
  ".zip": "application/zip",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function deny(res: Response, status: number, error: string) {
  res.status(status).set({ "Cache-Control": "no-store, private", Vary: "Cookie" }).json({ error });
}

/**
 * Serve os bytes gravados por `storagePut`. Exige sessão autenticada (o browser
 * envia o cookie em `fetch`, `<img src>` e `window.open` por ser mesma origem).
 */
export function registerStorageAssetRoutes(app: Express) {
  app.get("/api/storage/*", async (req: Request, res: Response) => {
    try {
      await sdk.authenticateRequest(req);
    } catch {
      return deny(res, 403, "Acesso ao arquivo não autorizado");
    }

    const rawKey = (req.params as Record<string, string>)[0] ?? "";
    let target: string;
    try {
      target = storagePathForKey(rawKey);
    } catch {
      return deny(res, 400, "Chave de arquivo inválida");
    }

    try {
      const bytes = await readFile(target);
      res.status(200).set({
        "Content-Type": contentTypeFor(target),
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
      }).send(bytes);
    } catch (error: any) {
      if (error?.code === "ENOENT") return deny(res, 404, "Arquivo não encontrado");
      return deny(res, 500, "Falha ao carregar arquivo");
    }
  });
}
