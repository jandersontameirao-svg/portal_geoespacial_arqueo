import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb } from "./db";
import { atlasJobs, atlasTemplates, projects, projectMembers, layers } from "../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import * as db from "./db";
import { summarizeRasterLayers } from "./rasterLayerMetadata";
import { atlasRenderAvailability, renderAtlasWithConfiguredAdapter } from "./atlasRenderAdapter";
import { storagePut } from "./storage";
import { buildAtlasVectorOverlays } from "./atlasVectorOverlay";

/**
 * Router para Atlas Automático
 * Gerencia a geração de atlas multipágina com grid automático
 */

// Helper para verificar acesso ao projeto
async function checkProjectAccess(projectId: number, userId: number, userRole: string) {
  if (userRole === "admin") return true;
  
  const isMember = await db.isUserProjectMember(projectId, userId);
  if (!isMember) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Você não tem acesso a este projeto",
    });
  }
  return true;
}

function requireAtlasEditor(userRole: string) {
  if (userRole === "client") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Clientes não podem alterar templates ou jobs de atlas" });
  }
}

// Configurações de tamanho de página em mm
const PAGE_SIZES = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  A1: { width: 594, height: 841 },
  A0: { width: 841, height: 1189 },
};

// Calcular grid de páginas para cobrir uma área
function calculateGrid(
  bounds: { north: number; south: number; east: number; west: number },
  pageSize: keyof typeof PAGE_SIZES,
  orientation: "portrait" | "landscape",
  scale: number,
  overlap: number = 0.1 // 10% de sobreposição
): {
  rows: number;
  cols: number;
  totalPages: number;
  pages: Array<{
    row: number;
    col: number;
    pageNumber: number;
    bounds: { north: number; south: number; east: number; west: number };
  }>;
} {
  const page = PAGE_SIZES[pageSize];
  const mapWidth = (orientation === "landscape" ? page.height : page.width) - 60; // mm
  const mapHeight = (orientation === "landscape" ? page.width : page.height) - 80; // mm

  // Converter dimensões do mapa para metros na escala
  const pageWidthMeters = (mapWidth / 1000) * scale;
  const pageHeightMeters = (mapHeight / 1000) * scale;

  // Converter para graus (aproximação)
  const avgLat = (bounds.north + bounds.south) / 2;
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = 111320 * Math.cos(avgLat * Math.PI / 180);

  const pageWidthDegrees = pageWidthMeters / metersPerDegreeLon;
  const pageHeightDegrees = pageHeightMeters / metersPerDegreeLat;

  // Calcular extensão total
  const totalWidth = bounds.east - bounds.west;
  const totalHeight = bounds.north - bounds.south;

  // Calcular número de páginas com sobreposição
  const effectiveWidth = pageWidthDegrees * (1 - overlap);
  const effectiveHeight = pageHeightDegrees * (1 - overlap);

  const cols = Math.ceil(totalWidth / effectiveWidth);
  const rows = Math.ceil(totalHeight / effectiveHeight);

  // Gerar páginas
  const pages: Array<{
    row: number;
    col: number;
    pageNumber: number;
    bounds: { north: number; south: number; east: number; west: number };
  }> = [];

  let pageNumber = 1;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const west = bounds.west + col * effectiveWidth;
      const south = bounds.north - (row + 1) * effectiveHeight;
      const east = west + pageWidthDegrees;
      const north = south + pageHeightDegrees;

      pages.push({
        row,
        col,
        pageNumber,
        bounds: {
          north: Math.min(north, bounds.north + pageHeightDegrees * overlap),
          south: Math.max(south, bounds.south - pageHeightDegrees * overlap),
          east: Math.min(east, bounds.east + pageWidthDegrees * overlap),
          west: Math.max(west, bounds.west - pageWidthDegrees * overlap),
        },
      });
      pageNumber++;
    }
  }

  return {
    rows,
    cols,
    totalPages: pages.length,
    pages,
  };
}

function boundsFromCoverageArea(rawCoverage: any): { north: number; south: number; east: number; west: number } {
  if (rawCoverage?.type && rawCoverage?.coordinates) {
    const pairs: number[][] = (rawCoverage.coordinates.flat(Infinity) as unknown[]).reduce((acc: number[][], value: unknown, index: number, all: unknown[]) => {
      if (index % 2 === 0 && Number.isFinite(Number(value)) && Number.isFinite(Number(all[index + 1]))) acc.push([Number(value), Number(all[index + 1])]);
      return acc;
    }, []);
    if (!pairs.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Área de cobertura inválida" });
    return { north: Math.max(...pairs.map((p) => p[1])), south: Math.min(...pairs.map((p) => p[1])), east: Math.max(...pairs.map((p) => p[0])), west: Math.min(...pairs.map((p) => p[0])) };
  }
  if (!rawCoverage || !["north", "south", "east", "west"].every((key) => Number.isFinite(Number(rawCoverage[key])))) throw new TRPCError({ code: "BAD_REQUEST", message: "Área de cobertura inválida" });
  return { north: Number(rawCoverage.north), south: Number(rawCoverage.south), east: Number(rawCoverage.east), west: Number(rawCoverage.west) };
}

export const atlasRouter = router({
  templates: router({
    list: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ ctx, input }) => {
      await checkProjectAccess(input.projectId, ctx.user.id, ctx.user.role);
      const database = await getDb();
      if (!database) return [];
      return database.select().from(atlasTemplates).where(eq(atlasTemplates.projectId, input.projectId)).orderBy(desc(atlasTemplates.updatedAt));
    }),
    create: protectedProcedure.input(z.object({
      projectId: z.number(), name: z.string().trim().min(3).max(255), templateType: z.enum(["abnt_tecnico", "cliente"]),
      config: z.record(z.string(), z.unknown()), isDefault: z.boolean().default(false),
    })).mutation(async ({ ctx, input }) => {
      await checkProjectAccess(input.projectId, ctx.user.id, ctx.user.role);
      requireAtlasEditor(ctx.user.role);
      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      if (input.isDefault) await database.update(atlasTemplates).set({ isDefault: false }).where(eq(atlasTemplates.projectId, input.projectId));
      const [result] = await database.insert(atlasTemplates).values({ ...input, config: input.config as Record<string, any>, createdBy: ctx.user.id }).$returningId();
      await db.createAuditLog({ userId: ctx.user.id, userEmail: ctx.user.email || null, userName: ctx.user.name || null, action: "atlas.template.create", entityType: "atlas_template", entityId: result.id, projectId: input.projectId, details: { name: input.name, templateType: input.templateType, isDefault: input.isDefault }, ipAddress: ctx.req.ip || null, userAgent: ctx.req.headers?.["user-agent"] || null });
      return { success: true, id: result.id };
    }),
    update: protectedProcedure.input(z.object({
      id: z.number(), name: z.string().trim().min(3).max(255).optional(), templateType: z.enum(["abnt_tecnico", "cliente"]).optional(),
      config: z.record(z.string(), z.unknown()).optional(), isDefault: z.boolean().optional(),
    })).mutation(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const [template] = await database.select().from(atlasTemplates).where(eq(atlasTemplates.id, input.id));
      if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "Template não encontrado" });
      await checkProjectAccess(template.projectId, ctx.user.id, ctx.user.role);
      requireAtlasEditor(ctx.user.role);
      const { id, ...updates } = input;
      if (updates.isDefault) await database.update(atlasTemplates).set({ isDefault: false }).where(eq(atlasTemplates.projectId, template.projectId));
      await database.update(atlasTemplates).set({ ...updates, ...(updates.config ? { config: updates.config as Record<string, any> } : {}) }).where(eq(atlasTemplates.id, id));
      await db.createAuditLog({ userId: ctx.user.id, userEmail: ctx.user.email || null, userName: ctx.user.name || null, action: "atlas.template.update", entityType: "atlas_template", entityId: id, projectId: template.projectId, details: { fields: Object.keys(updates) }, ipAddress: ctx.req.ip || null, userAgent: ctx.req.headers?.["user-agent"] || null });
      return { success: true };
    }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const [template] = await database.select().from(atlasTemplates).where(eq(atlasTemplates.id, input.id));
      if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "Template não encontrado" });
      await checkProjectAccess(template.projectId, ctx.user.id, ctx.user.role);
      requireAtlasEditor(ctx.user.role);
      await database.delete(atlasTemplates).where(eq(atlasTemplates.id, input.id));
      await db.createAuditLog({ userId: ctx.user.id, userEmail: ctx.user.email || null, userName: ctx.user.name || null, action: "atlas.template.delete", entityType: "atlas_template", entityId: input.id, projectId: template.projectId, details: { name: template.name }, ipAddress: ctx.req.ip || null, userAgent: ctx.req.headers?.["user-agent"] || null });
      return { success: true };
    }),
  }),
  /**
   * Listar jobs de atlas de um projeto
   */
  list: protectedProcedure
    .input(z.object({
      projectId: z.number(),
    }))
    .query(async ({ ctx, input }) => {
      await checkProjectAccess(input.projectId, ctx.user.id, ctx.user.role);
      
      const database = await getDb();
      if (!database) return [];

      const jobs = await database
        .select()
        .from(atlasJobs)
        .where(eq(atlasJobs.projectId, input.projectId))
        .orderBy(desc(atlasJobs.requestedAt));

      return jobs;
    }),

  /**
   * Obter um job específico
   */
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const [job] = await database
        .select()
        .from(atlasJobs)
        .where(eq(atlasJobs.id, input.id));

      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job não encontrado" });
      }

      await checkProjectAccess(job.projectId, ctx.user.id, ctx.user.role);

      return job;
    }),

  /**
   * Calcular preview do grid sem criar job
   */
  previewGrid: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      pageSize: z.enum(["A4", "A3", "A1", "A0"]),
      orientation: z.enum(["portrait", "landscape"]).default("landscape"),
      scale: z.number().min(500).max(100000),
      bounds: z.object({
        north: z.number(),
        south: z.number(),
        east: z.number(),
        west: z.number(),
      }),
      overlap: z.number().min(0).max(0.5).default(0.1),
    }))
    .query(async ({ ctx, input }) => {
      await checkProjectAccess(input.projectId, ctx.user.id, ctx.user.role);

      const grid = calculateGrid(
        input.bounds,
        input.pageSize,
        input.orientation,
        input.scale,
        input.overlap
      );

      return {
        ...grid,
        estimatedTime: grid.totalPages * 5, // 5 segundos por página
        pageSize: input.pageSize,
        orientation: input.orientation,
        scale: input.scale,
      };
    }),

  /**
   * Criar novo job de atlas
   */
  create: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      name: z.string().min(1).max(255),
      templateId: z.number().int().positive().optional(),
      templateType: z.enum(["abnt_tecnico", "cliente"]),
      pageSize: z.enum(["A4", "A3", "A1", "A0"]),
      orientation: z.enum(["portrait", "landscape"]).default("landscape"),
      scale: z.number().min(500).max(100000),
      bounds: z.object({
        north: z.number(),
        south: z.number(),
        east: z.number(),
        west: z.number(),
      }),
      overlap: z.number().min(0).max(0.5).default(0.1),
      title: z.string().min(1).max(255),
      subtitle: z.string().optional(),
      author: z.string().optional(),
      showNorthArrow: z.boolean().default(true),
      showScaleBar: z.boolean().default(true),
      showLegend: z.boolean().default(true),
      showGrid: z.boolean().default(true),
      showFrame: z.boolean().default(true),
      layersConfig: z.array(z.object({
        layerId: z.number(),
        opacity: z.number().min(0).max(1),
        includeInLegend: z.boolean(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await checkProjectAccess(input.projectId, ctx.user.id, ctx.user.role);

      requireAtlasEditor(ctx.user.role);

      const database = await getDb();
      if (!database) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      let templateConfig: Record<string, any> = {};
      if (input.templateId) {
        const [template] = await database.select().from(atlasTemplates).where(eq(atlasTemplates.id, input.templateId));
        if (!template || template.projectId !== input.projectId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Template do projeto não encontrado" });
        }
        templateConfig = (template.config || {}) as Record<string, any>;
      }

      // Calcular grid
      const grid = calculateGrid(
        input.bounds,
        input.pageSize,
        input.orientation,
        input.scale,
        input.overlap
      );

      // Calcular fuso UTM
      const centerLon = (input.bounds.east + input.bounds.west) / 2;
      const utmZone = Math.floor((centerLon + 180) / 6) + 1;

      const result = await database.insert(atlasJobs).values({
        projectId: input.projectId,
        name: input.name,
        templateId: input.templateId || null,
        templateType: input.templateType,
        pageSize: input.pageSize,
        orientation: input.orientation,
        scale: input.scale,
        coverageArea: {
          type: "Polygon",
          coordinates: [[[
            [input.bounds.west, input.bounds.south],
            [input.bounds.east, input.bounds.south],
            [input.bounds.east, input.bounds.north],
            [input.bounds.west, input.bounds.north],
            [input.bounds.west, input.bounds.south],
          ]]],
        } as any,
        gridConfig: {
          rows: grid.rows,
          cols: grid.cols,
          totalPages: grid.totalPages,
          cellWidth: 0,
          cellHeight: 0,
        } as any,
        renderConfig: {
          ...templateConfig,
          title: input.title,
          subtitle: input.subtitle || null,
          author: input.author || null,
          showNorthArrow: input.showNorthArrow,
          showScaleBar: input.showScaleBar,
          showLegend: input.showLegend,
          showGrid: input.showGrid,
          showFrame: input.showFrame,
          overlap: input.overlap,
        },
        crs: `EPSG:319${80 + utmZone}`,
        utmZone,
        layersConfig: input.layersConfig ? [
          ...input.layersConfig,
          // Store display options in layersConfig metadata
        ] : null,
        status: "pending",
        requestedBy: ctx.user.id,
      });

      const insertId = Number((result as any)[0]?.insertId || 0);

      // Log de auditoria
      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "atlas.create",
        entityType: "atlas",
        entityId: insertId,
        projectId: input.projectId,
        details: { 
          name: input.name, 
          totalPages: grid.totalPages,
          scale: input.scale,
        },
        ipAddress: ctx.req.ip || null,
        userAgent: ctx.req.headers?.["user-agent"] || null,
      });

      return { 
        id: insertId, 
        success: true,
        grid,
      };
    }),

  render: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), rasterLayerId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const [job] = await database.select().from(atlasJobs).where(eq(atlasJobs.id, input.id));
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Atlas não encontrado" });
      await checkProjectAccess(job.projectId, ctx.user.id, ctx.user.role);
      requireAtlasEditor(ctx.user.role);
      const availability = atlasRenderAvailability();
      if (!availability.available) throw new TRPCError({ code: "PRECONDITION_FAILED", message: availability.reason });
      const rasterLayer = await db.getLayerById(input.rasterLayerId);
      if (!rasterLayer || rasterLayer.projectId !== job.projectId || rasterLayer.layerType !== "raster" || (rasterLayer.metadata as any)?.rasterIngestion?.status !== "completed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Selecione uma camada raster COG processada deste projeto" });
      }
      const bounds = boundsFromCoverageArea(job.coverageArea);
      const renderConfig = (job.renderConfig || {}) as Record<string, any>;
      const grid = calculateGrid(bounds, job.pageSize as keyof typeof PAGE_SIZES, job.orientation as "portrait" | "landscape", job.scale, Number(renderConfig.overlap || 0.1));
      const selectedLayerIds = Array.from(new Set(((job.layersConfig || []) as Array<{ layerId: number }>).map((item) => item.layerId).filter((id) => Number.isInteger(id) && id > 0)));
      const projectLayers = selectedLayerIds.length ? await database.select().from(layers).where(eq(layers.projectId, job.projectId)) : [];
      let overlays;
      try {
        overlays = buildAtlasVectorOverlays(projectLayers.filter((layer) => selectedLayerIds.includes(layer.id) && layer.layerType === "vector"), job.layersConfig as Array<{ layerId: number; opacity: number; includeInLegend: boolean }> | null);
      } catch (error) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: error instanceof Error ? error.message : "Overlays vetoriais inválidos" });
      }
      await database.update(atlasJobs).set({ status: "processing", progress: 5, currentPage: 0, errorMessage: null }).where(eq(atlasJobs.id, job.id));
      try {
        const rendered = await renderAtlasWithConfiguredAdapter({
          atlasId: job.id, projectId: job.projectId, rasterLayerId: rasterLayer.id,
          pages: grid.pages.map((page) => ({ bounds: page.bounds })), title: String(renderConfig.title || job.name), pageSize: job.pageSize as "A4" | "A3" | "A1" | "A0", orientation: job.orientation as "portrait" | "landscape", scale: job.scale, crs: job.crs,
          showNorthArrow: renderConfig.showNorthArrow !== false, showFrame: renderConfig.showFrame !== false, showLegend: renderConfig.showLegend !== false, showScaleBar: renderConfig.showScaleBar !== false, overlays,
        });
        const storageKey = `projects/${job.projectId}/atlas/${job.id}-${rendered.outputSha256.slice(0, 16)}.pdf`;
        const uploaded = await storagePut(storageKey, rendered.pdfBytes, "application/pdf");
        await database.update(atlasJobs).set({ status: "completed", progress: 100, currentPage: grid.totalPages, outputS3Key: uploaded.key, outputUrl: uploaded.url, individualPagesUrls: rendered.pages.map((page) => ({ page: page.page, url: "", s3Key: `${rendered.outputKey}#${page.png}` })), completedAt: new Date(), errorMessage: null }).where(eq(atlasJobs.id, job.id));
        await db.createAuditLog({ userId: ctx.user.id, userEmail: ctx.user.email || null, userName: ctx.user.name || null, action: "atlas.render.completed", entityType: "atlas", entityId: job.id, projectId: job.projectId, details: { rasterLayerId: rasterLayer.id, pages: grid.totalPages, outputSha256: rendered.outputSha256, sourceCogSha256: rendered.sourceCogSha256, outputBytes: rendered.outputBytes, overlays: overlays.length, pageSize: job.pageSize }, ipAddress: ctx.req.ip || null, userAgent: ctx.req.headers?.["user-agent"] || null });
        return { success: true, outputUrl: uploaded.url, outputSha256: rendered.outputSha256, outputBytes: rendered.outputBytes, pages: grid.totalPages };
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 1000) : "Falha desconhecida no worker cartográfico";
        await database.update(atlasJobs).set({ status: "failed", errorMessage: message, progress: 0 }).where(eq(atlasJobs.id, job.id));
        await db.createAuditLog({ userId: ctx.user.id, userEmail: ctx.user.email || null, userName: ctx.user.name || null, action: "atlas.render.failed", entityType: "atlas", entityId: job.id, projectId: job.projectId, details: { rasterLayerId: input.rasterLayerId, error: message }, ipAddress: ctx.req.ip || null, userAgent: ctx.req.headers?.["user-agent"] || null });
        throw new TRPCError({ code: "PRECONDITION_FAILED", message });
      }
    }),

  /**
   * Gerar configuração de uma página específica do atlas
   */
  getPageConfig: protectedProcedure
    .input(z.object({
      atlasId: z.number(),
      pageNumber: z.number().min(1),
    }))
    .query(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const [job] = await database
        .select()
        .from(atlasJobs)
        .where(eq(atlasJobs.id, input.atlasId));

      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Atlas não encontrado" });
      }

      await checkProjectAccess(job.projectId, ctx.user.id, ctx.user.role);

      const totalPagesFromConfig = (job.gridConfig as any)?.totalPages || 100;
      if (input.pageNumber > totalPagesFromConfig) {
        throw new TRPCError({ 
          code: "BAD_REQUEST", 
          message: `Página ${input.pageNumber} não existe. Total: ${totalPagesFromConfig}` 
        });
      }

      // Recalcular grid para obter bounds da página
      // coverageArea pode ser bounds simples ou GeoJSON
      let coverageArea: { north: number; south: number; east: number; west: number };
      const rawCoverage = job.coverageArea as any;
      if (rawCoverage.type && rawCoverage.coordinates) {
        // É GeoJSON, extrair bounds
        const coords = rawCoverage.coordinates.flat(2);
        const lons = coords.filter((_: any, i: number) => i % 2 === 0);
        const lats = coords.filter((_: any, i: number) => i % 2 === 1);
        coverageArea = {
          north: Math.max(...lats),
          south: Math.min(...lats),
          east: Math.max(...lons),
          west: Math.min(...lons),
        };
      } else {
        coverageArea = rawCoverage;
      }
      const gridConfig = job.gridConfig as { rows: number; cols: number; totalPages?: number; overlap?: number; title?: string; subtitle?: string; author?: string } | null;
      const renderConfig = (job.renderConfig || gridConfig || {}) as { overlap?: number; title?: string; subtitle?: string; author?: string; showNorthArrow?: boolean; showScaleBar?: boolean; showLegend?: boolean; showGrid?: boolean; showFrame?: boolean };
      
      const grid = calculateGrid(
        coverageArea,
        job.pageSize as keyof typeof PAGE_SIZES,
        job.orientation as "portrait" | "landscape",
        job.scale,
renderConfig.overlap || 0.1
      );

      const page = grid.pages.find(p => p.pageNumber === input.pageNumber);
      if (!page) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Página não encontrada" });
      }

      // Buscar informações do projeto
      const [project] = await database
        .select()
        .from(projects)
        .where(eq(projects.id, job.projectId));
      const projectLayers = await database
        .select()
        .from(layers)
        .where(eq(layers.projectId, job.projectId));

      return {
        atlasId: job.id,
        atlasName: job.name,
        pageNumber: input.pageNumber,
        totalPages: (gridConfig as any)?.totalPages || grid.totalPages,
        bounds: page.bounds,
        row: page.row,
        col: page.col,
        title: `${renderConfig.title || job.name} - Folha ${String(input.pageNumber).padStart(2, "0")}/${String((gridConfig as any)?.totalPages || grid.totalPages).padStart(2, "0")}`,
        subtitle: renderConfig.subtitle || null,
        author: renderConfig.author || null,
        project: project?.name,
        client: project?.clientName,
        scale: job.scale,
        crs: job.crs,
        utmZone: job.utmZone,
        pageSize: job.pageSize,
        orientation: job.orientation,
        showNorthArrow: renderConfig.showNorthArrow ?? true,
        showScaleBar: renderConfig.showScaleBar ?? true,
        showLegend: renderConfig.showLegend ?? true,
        showGrid: renderConfig.showGrid ?? true,
        showFrame: renderConfig.showFrame ?? true,
        layersConfig: job.layersConfig,
        rasterLayers: summarizeRasterLayers(projectLayers),
      };
    }),

  /**
   * Excluir job de atlas
   */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const [existingJob] = await database
        .select()
        .from(atlasJobs)
        .where(eq(atlasJobs.id, input.id));

      if (!existingJob) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Atlas não encontrado" });
      }

      await checkProjectAccess(existingJob.projectId, ctx.user.id, ctx.user.role);

      if (ctx.user.role === "client") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Clientes não podem excluir jobs de atlas",
        });
      }

      await database
        .delete(atlasJobs)
        .where(eq(atlasJobs.id, input.id));

      // Log de auditoria
      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "atlas.delete",
        entityType: "atlas",
        entityId: input.id,
        projectId: existingJob.projectId,
        details: { name: existingJob.name },
        ipAddress: ctx.req.ip || null,
        userAgent: ctx.req.headers?.["user-agent"] || null,
      });

      return { success: true };
    }),
});
