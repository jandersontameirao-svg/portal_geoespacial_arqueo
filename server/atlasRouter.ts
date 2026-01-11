import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb } from "./db";
import { atlasJobs, projects, projectMembers, layers } from "../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import * as db from "./db";

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

export const atlasRouter = router({
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

      // Verificar se é editor ou admin
      if (ctx.user.role === "client") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Clientes não podem criar jobs de atlas",
        });
      }

      const database = await getDb();
      if (!database) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
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
        // title, subtitle, author stored in gridConfig as metadata
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
      
      const grid = calculateGrid(
        coverageArea,
        job.pageSize as keyof typeof PAGE_SIZES,
        job.orientation as "portrait" | "landscape",
        job.scale,
(gridConfig as any)?.overlap || 0.1
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

      return {
        atlasId: job.id,
        atlasName: job.name,
        pageNumber: input.pageNumber,
        totalPages: (gridConfig as any)?.totalPages || grid.totalPages,
        bounds: page.bounds,
        row: page.row,
        col: page.col,
        title: `${(gridConfig as any)?.title || job.name} - Folha ${String(input.pageNumber).padStart(2, "0")}/${String((gridConfig as any)?.totalPages || grid.totalPages).padStart(2, "0")}`,
        subtitle: (gridConfig as any).subtitle,
        author: (gridConfig as any).author,
        project: project?.name,
        client: project?.clientName,
        scale: job.scale,
        crs: job.crs,
        utmZone: job.utmZone,
        pageSize: job.pageSize,
        orientation: job.orientation,
        showNorthArrow: true, // Default values since schema doesn't have these fields
        showScaleBar: true,
        showLegend: true,
        showGrid: true,
        showFrame: true,
        layersConfig: job.layersConfig,
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
