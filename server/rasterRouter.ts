import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";
import { ensureFileSafe } from "./virusScanner";
import { createLocalRasterExport, descriptorFromLayer, getLocalRasterRoot, type RasterBounds } from "./localRasterService";
import { ingestRasterWithConfiguredAdapter, rasterIngestionAvailability } from "./rasterIngestionAdapter";
import { requireProjectAccess, requireProjectEditor } from "./projectAccess";
import { buildHistoricalImageryCatalog } from "./historicalImageryCatalog";

const boundsSchema = z.object({ north: z.number().finite(), south: z.number().finite(), east: z.number().finite(), west: z.number().finite() });
const rasterMimeTypes = ["image/tiff", "image/geotiff", "application/geotiff"] as const;
const resamplingSchema = z.enum(["nearest", "bilinear", "cubic", "lanczos"]);

async function getProjectRasterLayer(projectId: number, layerId: number, actor: { id: number; role: "admin" | "editor" | "client" }) {
  await requireProjectAccess(projectId, actor);
  const layer = await db.getLayerById(layerId);
  if (!layer || layer.projectId !== projectId || layer.layerType !== "raster") throw new TRPCError({ code: "NOT_FOUND", message: "Camada raster não encontrada neste projeto" });
  return layer;
}

function publicIngestionResult(result: Awaited<ReturnType<typeof ingestRasterWithConfiguredAdapter>>) {
  const tileReport = result.processing.tileReport as { tiles?: { count?: number } } | undefined;
  return {
    descriptor: result.descriptor,
    bounds: result.bounds,
    crs: result.crs,
    sourceSha256: result.sourceSha256,
    cogSha256: result.cogSha256,
    sourceBytes: result.sourceBytes,
    cogBytes: result.cogBytes,
    tileCount: tileReport?.tiles?.count ?? null,
    acquisitionAt: (result.processing.stacProperties as Record<string, unknown> | undefined)?.datetime ?? null,
  };
}

export const rasterRouter = router({
  ingestionAvailability: protectedProcedure.query(() => rasterIngestionAvailability()),

  ingestGeoTiff: protectedProcedure.input(z.object({
    projectId: z.number().int().positive(),
    filename: z.string().min(1).max(255),
    mimeType: z.enum(rasterMimeTypes),
    size: z.number().int().positive().max(100 * 1024 * 1024),
    fileData: z.string().min(8),
    name: z.string().min(2).max(255),
    description: z.string().max(2000).optional(),
    acquisitionAt: z.string().datetime({ offset: true }),
    sourceLabel: z.string().min(3).max(500),
    minZoom: z.number().int().min(0).max(22).default(12),
    maxZoom: z.number().int().min(0).max(22).default(14),
    nodata: z.number().finite().default(0),
    resampling: resamplingSchema.default("cubic"),
  })).mutation(async ({ ctx, input }) => {
    await requireProjectEditor(input.projectId, ctx.user);
    if (input.minZoom > input.maxZoom) throw new TRPCError({ code: "BAD_REQUEST", message: "Zoom mínimo não pode ser maior que o máximo" });
    const availability = rasterIngestionAvailability();
    if (!availability.available) throw new TRPCError({ code: "PRECONDITION_FAILED", message: availability.reason });
    const bytes = Buffer.from(input.fileData, "base64");
    if (!bytes.length || bytes.length !== input.size) throw new TRPCError({ code: "BAD_REQUEST", message: "Tamanho do GeoTIFF divergente" });
    const scanned = await ensureFileSafe(bytes, input.filename);
    if (!scanned.safe) throw new TRPCError({ code: "BAD_REQUEST", message: `GeoTIFF rejeitado por segurança: ${scanned.result.threats.join(", ")}` });

    const fileKey = `projects/${input.projectId}/files/${nanoid()}-${input.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { url } = await storagePut(fileKey, bytes, input.mimeType);
    const { file, versionId } = await db.createRasterFileWithInitialVersion({
      projectId: input.projectId, name: input.filename, originalName: input.filename, fileType: "geotiff", mimeType: input.mimeType,
      fileSize: input.size, s3Key: fileKey, s3Url: url, isGeospatial: true, crs: "EPSG:4674", bounds: null,
      metadata: { description: input.description || null, rasterIngestion: { status: "processing", acquisitionAt: input.acquisitionAt, sourceLabel: input.sourceLabel, originalStorageKey: fileKey } }, uploadedBy: ctx.user.id,
    }, scanned.result.fileHash);

    const layerId = await db.createLayer({
      projectId: input.projectId, fileId: file.id, name: input.name, description: input.description || "Raster em processamento",
      layerType: "raster", layerData: { sourceFileId: file.id }, styleId: null, defaultStyle: null, crs: "EPSG:4674", bounds: null,
      isVisible: false, isPublic: false, metadata: { rasterIngestion: { status: "processing", requestedAt: new Date().toISOString(), requestedBy: ctx.user.id } }, createdBy: ctx.user.id,
    });
    try {
      const result = await ingestRasterWithConfiguredAdapter({ projectId: input.projectId, layerId, bytes, acquisitionAt: input.acquisitionAt, sourceLabel: input.sourceLabel, minZoom: input.minZoom, maxZoom: input.maxZoom, nodata: input.nodata, resampling: input.resampling });
      const safeResult = publicIngestionResult(result);
      const metadata = {
        localRaster: result.descriptor,
        rasterIngestion: {
          status: "completed", requestedBy: ctx.user.id, acquisitionAt: input.acquisitionAt, sourceLabel: input.sourceLabel,
          sourceKey: result.sourceKey, cogKey: result.cogKey, stacKey: result.stacKey, manifestKey: result.manifestKey,
          sourceSha256: result.sourceSha256, cogSha256: result.cogSha256, sourceBytes: result.sourceBytes, cogBytes: result.cogBytes,
          tileCount: safeResult.tileCount, completedAt: new Date().toISOString(), workerMode: availability.mode,
        },
      };
      await db.updateLayer(layerId, { bounds: result.bounds, crs: result.crs, isVisible: true, metadata, description: input.description || `COG EPSG:4674 processado de ${input.filename}` });
      await db.updateFile(file.id, { crs: result.crs, bounds: result.bounds, metadata: { ...(file.metadata || {}), rasterIngestion: metadata.rasterIngestion } });
      await db.createAuditLog({ userId: ctx.user.id, userEmail: ctx.user.email || null, userName: ctx.user.name || null, action: "raster.ingest", entityType: "layer", entityId: layerId, projectId: input.projectId, details: { filename: input.filename, fileId: file.id, layerId, versionId, version: 1, ...safeResult }, ipAddress: ctx.req.ip || null, userAgent: ctx.req.headers?.["user-agent"] || null });
      return { success: true, fileId: file.id, layerId, versionId, version: 1, ...safeResult };
    } catch (error) {
      await db.updateLayer(layerId, { isVisible: false, metadata: { rasterIngestion: { status: "failed", error: error instanceof Error ? error.message.slice(0, 500) : "Erro desconhecido", failedAt: new Date().toISOString() } } });
      await db.createAuditLog({ userId: ctx.user.id, userEmail: ctx.user.email || null, userName: ctx.user.name || null, action: "raster.ingest_failed", entityType: "layer", entityId: layerId, projectId: input.projectId, details: { filename: input.filename, fileId: file.id, layerId, versionId, version: 1, error: error instanceof Error ? error.message : "Erro desconhecido" }, ipAddress: ctx.req.ip || null, userAgent: ctx.req.headers?.["user-agent"] || null });
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: error instanceof Error ? error.message : "Falha na ingestão raster" });
    }
  }),

  listForMap: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await requireProjectAccess(input.projectId, ctx.user);
    const layers = await db.getLayersByProject(input.projectId);
    return layers.flatMap((layer) => {
      if (layer.layerType !== "raster") return [];
      try {
        const descriptor = descriptorFromLayer(layer as any);
        return [{ id: layer.id, name: layer.name, bounds: layer.bounds, crs: layer.crs, isVisible: layer.isVisible, metadata: layer.metadata, nodata: descriptor.nodata, minZoom: descriptor.minZoom, maxZoom: descriptor.maxZoom, tileTemplate: `/api/projects/${input.projectId}/raster-layers/${layer.id}/tiles/{z}/{x}/{y}.png` }];
      } catch { return []; }
    });
  }),

  historicalCatalog: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await requireProjectAccess(input.projectId, ctx.user);
    return buildHistoricalImageryCatalog((await db.getLayersByProject(input.projectId)) as any);
  }),

  createImageExport: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), layerId: z.number().int().positive(), bounds: boundsSchema, width: z.number().int().min(256).max(8192), height: z.number().int().min(256).max(8192) })).mutation(async ({ ctx, input }) => {
    const layer = await getProjectRasterLayer(input.projectId, input.layerId, ctx.user);
    let result;
    try { result = await createLocalRasterExport({ root: getLocalRasterRoot(), layer: layer as any, bounds: input.bounds as RasterBounds, width: input.width, height: input.height }); }
    catch (error) { throw new TRPCError({ code: "PRECONDITION_FAILED", message: error instanceof Error ? error.message : "Não foi possível exportar raster local" }); }
    const base = `/api/projects/${input.projectId}/raster-layers/${layer.id}/exports/${result.exportId}`;
    return { ...result, downloads: { png: `${base}/png`, worldfile: `${base}/worldfile`, prj: `${base}/prj`, pdf: `${base}/pdf` } };
  }),
});

export { getProjectRasterLayer };
