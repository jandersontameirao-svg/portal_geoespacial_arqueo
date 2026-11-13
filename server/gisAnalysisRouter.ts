import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { executeAnalysis, type AnalysisOperation } from "./gisAnalysis";
import { requireProjectAccess, requireProjectEditor } from "./projectAccess";
import { isPromotableVectorLayer, vectorFeaturesFromLayer } from "./vectorLayerPromotion";

const operationSchema = z.enum(["buffer", "intersection", "union", "clip", "overlay", "grid", "area"]);

const featureSchema = z.object({
  type: z.literal("Feature"),
  properties: z.record(z.string(), z.unknown()).nullable().optional(),
  geometry: z.object({
    type: z.string(),
    coordinates: z.unknown(),
  }),
});

const styleSchema = z.object({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  weight: z.number().min(1).max(8).optional(),
  fillOpacity: z.number().min(0).max(1).optional(),
}).optional();

function defaultName(operation: AnalysisOperation): string {
  const labels: Record<AnalysisOperation, string> = {
    buffer: "Buffer métrico",
    intersection: "Interseção",
    union: "União",
    clip: "Recorte",
    overlay: "Sobreposição",
    grid: "Malha de pontos",
    area: "Área de influência",
  };
  return labels[operation];
}

export const gisAnalysisRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(input.projectId, ctx.user);
      return db.getLayersByProject(input.projectId);
    }),

  updateVectorVisibility: protectedProcedure
    .input(z.object({ projectId: z.number(), layerId: z.number(), isVisible: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user);
      const layer = await db.getLayerById(input.layerId);
      if (!layer || layer.projectId !== input.projectId || layer.layerType !== "vector" || !isPromotableVectorLayer(layer.layerData)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Camada vetorial do projeto não encontrada" });
      }
      await db.updateLayer(input.layerId, { isVisible: input.isVisible });
      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "gis.vector_layer.visibility.update",
        entityType: "layer",
        entityId: input.layerId,
        projectId: input.projectId,
        details: { isVisible: input.isVisible, sourceFileId: layer.fileId },
        ipAddress: ctx.req.ip || null,
        userAgent: ctx.req.headers?.["user-agent"] || null,
      });
      return { success: true };
    }),

  updateLayerPresentation: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      layerId: z.number(),
      isVisible: z.boolean().optional(),
      renderOrder: z.number().int().min(0).max(10_000).optional(),
    }).refine((input) => input.isVisible !== undefined || input.renderOrder !== undefined, "Informe visibilidade ou ordem"))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user);
      const layer = await db.getLayerById(input.layerId);
      if (!layer || layer.projectId !== input.projectId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Camada do projeto não encontrada" });
      }
      const previousMetadata = (layer.metadata || {}) as Record<string, unknown>;
      const previousPresentation = (previousMetadata.presentation && typeof previousMetadata.presentation === "object")
        ? previousMetadata.presentation as Record<string, unknown>
        : {};
      const presentation = {
        ...previousPresentation,
        ...(input.renderOrder === undefined ? {} : { renderOrder: input.renderOrder }),
      };
      await db.updateLayer(input.layerId, {
        ...(input.isVisible === undefined ? {} : { isVisible: input.isVisible }),
        metadata: { ...previousMetadata, presentation },
      });
      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "gis.layer.presentation.update",
        entityType: "layer",
        entityId: input.layerId,
        projectId: input.projectId,
        details: { isVisible: input.isVisible ?? layer.isVisible, renderOrder: presentation.renderOrder ?? null, layerType: layer.layerType },
        ipAddress: ctx.req.ip || null,
        userAgent: ctx.req.headers?.["user-agent"] || null,
      });
      return { success: true, isVisible: input.isVisible ?? layer.isVisible, renderOrder: presentation.renderOrder ?? null };
    }),

  exportVectorLayer: protectedProcedure
    .input(z.object({ projectId: z.number(), layerId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(input.projectId, ctx.user);
      const layer = await db.getLayerById(input.layerId);
      if (!layer || layer.projectId !== input.projectId || layer.layerType !== "vector" || !isPromotableVectorLayer(layer.layerData)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Camada vetorial do projeto não encontrada" });
      }
      const featureCount = vectorFeaturesFromLayer(layer.layerData).length;
      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "gis.vector_layer.export",
        entityType: "layer",
        entityId: input.layerId,
        projectId: input.projectId,
        details: { format: "geojson", featureCount, sourceFileId: layer.fileId },
        ipAddress: ctx.req.ip || null,
        userAgent: ctx.req.headers?.["user-agent"] || null,
      });
      return {
        data: JSON.stringify(layer.layerData, null, 2),
        filename: `${layer.name.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 100) || "camada"}.geojson`,
      };
    }),

  execute: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      name: z.string().trim().min(3).max(255).optional(),
      description: z.string().trim().max(2000).optional(),
      operation: operationSchema,
      inputs: z.array(featureSchema).min(1).max(100),
      bufferMeters: z.number().positive().max(100_000).optional(),
      grid: z.object({
        spacingMeters: z.number().min(10).max(10_000),
        originCode: z.string().trim().min(1).max(60).optional(),
        rotationDegrees: z.number().min(-180).max(180).optional(),
        pattern: z.enum(["quadrada", "triangular"]).optional(),
      }).optional(),
      style: styleSchema,
      sourceLabels: z.array(z.string().trim().min(1).max(255)).max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user);

      let result;
      try {
        result = executeAnalysis({
          operation: input.operation,
          inputs: input.inputs as never,
          bufferMeters: input.bufferMeters,
          grid: input.grid,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Não foi possível executar a análise espacial.",
        });
      }

      if (result.output.features.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "A operação não produziu feições. Verifique se as áreas se sobrepõem.",
        });
      }

      const layerName = input.name || defaultName(input.operation);
      const metadata = {
        kind: "gis-analysis-result",
        provenance: result.provenance,
        sourceLabels: input.sourceLabels || [],
        areaSquareMeters: result.areaSquareMeters,
        generatedIn: "portal-geoespacial-arqueo",
      };

      const layerId = await db.createLayer({
        projectId: input.projectId,
        fileId: null,
        name: layerName,
        description: input.description || `Resultado persistido da operação ${input.operation}.`,
        layerType: "vector",
        layerData: result.output,
        defaultStyle: {
          color: input.style?.color || "#1d4ed8",
          weight: input.style?.weight || 2,
          fillOpacity: input.style?.fillOpacity ?? 0.25,
        },
        crs: "EPSG:4326",
        bounds: result.bounds,
        isVisible: true,
        isPublic: false,
        metadata,
        createdBy: ctx.user.id,
      });

      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "gis.analysis.execute",
        entityType: "layer",
        entityId: layerId,
        projectId: input.projectId,
        details: {
          operation: input.operation,
          inputFeatureCount: input.inputs.length,
          outputFeatureCount: result.output.features.length,
          areaSquareMeters: result.areaSquareMeters,
          provenance: result.provenance,
        },
        ipAddress: ctx.req.ip || null,
        userAgent: ctx.req.headers?.["user-agent"] || null,
      });

      return {
        success: true,
        layerId,
        name: layerName,
        result,
      };
    }),
});
