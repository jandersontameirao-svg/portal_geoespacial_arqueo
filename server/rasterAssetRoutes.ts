import type { Express, Request, Response } from "express";
import { readFile } from "node:fs/promises";
import { sdk } from "./_core/sdk";
import { exportFilePath, getLocalRasterRoot, RasterAssetError, tilePath, descriptorFromLayer } from "./localRasterService";
import { getProjectRasterLayer } from "./rasterRouter";

function positiveInt(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function forbidden(res: Response) {
  res.status(403).set({ "Cache-Control": "no-store, private", Vary: "Cookie" }).json({ error: "Acesso ao raster não autorizado" });
}

async function authenticateAndLoad(req: Request, res: Response) {
  const projectId = positiveInt(req.params.projectId);
  const layerId = positiveInt(req.params.layerId);
  if (!projectId || !layerId) return null;
  try {
    const user = await sdk.authenticateRequest(req);
    const layer = await getProjectRasterLayer(projectId, layerId, user);
    return { projectId, layer };
  } catch {
    forbidden(res);
    return null;
  }
}

export function registerRasterAssetRoutes(app: Express) {
  app.get("/api/projects/:projectId/raster-layers/:layerId/tiles/:z/:x/:y.png", async (req, res) => {
    const context = await authenticateAndLoad(req, res);
    if (!context) return;
    const z = Number(req.params.z); const x = Number(req.params.x); const y = Number(req.params.y);
    try {
      const filename = tilePath(getLocalRasterRoot(), descriptorFromLayer(context.layer as any), z, x, y);
      const bytes = await readFile(filename);
      res.status(200).set({ "Content-Type": "image/png", "Content-Length": String(bytes.length), "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" }).send(bytes);
    } catch (error) {
      if (error instanceof RasterAssetError || (error as any)?.code === "ENOENT") return res.status(404).set({ "Cache-Control": "no-store, private", Vary: "Cookie" }).json({ error: "Tile raster não encontrado" });
      return res.status(500).set({ "Cache-Control": "no-store, private", Vary: "Cookie" }).json({ error: "Falha ao carregar tile raster" });
    }
  });

  app.get("/api/projects/:projectId/raster-layers/:layerId/exports/:exportId/:kind", async (req, res) => {
    const context = await authenticateAndLoad(req, res);
    if (!context) return;
    const kind = req.params.kind;
    if (!(["png", "worldfile", "prj", "pdf"] as string[]).includes(kind)) return res.status(404).json({ error: "Tipo de exportação não encontrado" });
    try {
      const file = await exportFilePath(getLocalRasterRoot(), context.layer as any, req.params.exportId, kind as "png" | "worldfile" | "prj" | "pdf");
      const bytes = await readFile(file.path);
      res.status(200).set({ "Content-Type": file.contentType, "Content-Length": String(bytes.length), "Content-Disposition": `attachment; filename=\"${file.filename}\"`, "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" }).send(bytes);
    } catch (error) {
      if (error instanceof RasterAssetError || (error as any)?.code === "ENOENT") return res.status(404).set({ "Cache-Control": "no-store, private", Vary: "Cookie" }).json({ error: "Exportação raster não encontrada" });
      return res.status(500).set({ "Cache-Control": "no-store, private", Vary: "Cookie" }).json({ error: "Falha ao carregar exportação raster" });
    }
  });
}
