import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb } from "./db";
import { printJobs, savedMaps, projects, projectMembers, layers } from "../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import * as db from "./db";
import { summarizeRasterLayers } from "./rasterLayerMetadata";

/**
 * Router para Jobs de Impressão de Mapas Técnicos
 * Gerencia a geração de mapas no padrão ABNT
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

// Calcular escala baseado no tamanho da página e bounds
function calculateOptimalScale(
  bounds: { north: number; south: number; east: number; west: number },
  pageSize: keyof typeof PAGE_SIZES,
  orientation: "portrait" | "landscape"
): number {
  const page = PAGE_SIZES[pageSize];
  const width = orientation === "landscape" ? page.height : page.width;
  const height = orientation === "landscape" ? page.width : page.height;
  
  // Área útil do mapa (descontando margens e elementos)
  const mapWidth = width - 60; // mm
  const mapHeight = height - 80; // mm
  
  // Calcular extensão em metros (aproximação)
  const latDiff = bounds.north - bounds.south;
  const lonDiff = bounds.east - bounds.west;
  const avgLat = (bounds.north + bounds.south) / 2;
  
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = 111320 * Math.cos(avgLat * Math.PI / 180);
  
  const extentHeight = latDiff * metersPerDegreeLat;
  const extentWidth = lonDiff * metersPerDegreeLon;
  
  // Calcular escala
  const scaleX = (extentWidth * 1000) / mapWidth;
  const scaleY = (extentHeight * 1000) / mapHeight;
  
  const scale = Math.max(scaleX, scaleY);
  
  // Arredondar para escala padrão
  const standardScales = [500, 1000, 2000, 2500, 5000, 10000, 25000, 50000, 100000];
  return standardScales.find(s => s >= scale) || 100000;
}

export const printJobsRouter = router({
  /**
   * Listar jobs de impressão de um projeto
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
        .from(printJobs)
        .where(eq(printJobs.projectId, input.projectId))
        .orderBy(desc(printJobs.requestedAt));

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
        .from(printJobs)
        .where(eq(printJobs.id, input.id));

      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job não encontrado" });
      }

      await checkProjectAccess(job.projectId, ctx.user.id, ctx.user.role);

      return job;
    }),

  /**
   * Criar novo job de impressão
   */
  create: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      savedMapId: z.number().optional(),
      name: z.string().min(1).max(255),
      templateType: z.enum(["abnt_tecnico", "cliente"]),
      pageSize: z.enum(["A4", "A3", "A1", "A0"]),
      orientation: z.enum(["portrait", "landscape"]).default("landscape"),
      scale: z.number().optional(),
      crs: z.string().default("EPSG:31982"),
      utmZone: z.number().optional(),
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
      bounds: z.object({
        north: z.number(),
        south: z.number(),
        east: z.number(),
        west: z.number(),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await checkProjectAccess(input.projectId, ctx.user.id, ctx.user.role);

      // Verificar se é editor ou admin
      if (ctx.user.role === "client") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Clientes não podem criar jobs de impressão",
        });
      }

      const database = await getDb();
      if (!database) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      // Calcular escala se não fornecida
      let scale = input.scale;
      if (!scale && input.bounds) {
        scale = calculateOptimalScale(input.bounds, input.pageSize, input.orientation);
      }
      scale = scale || 10000;

      // Calcular fuso UTM se não fornecido
      let utmZone = input.utmZone;
      if (!utmZone && input.bounds) {
        const centerLon = (input.bounds.east + input.bounds.west) / 2;
        utmZone = Math.floor((centerLon + 180) / 6) + 1;
      }

      const result = await database.insert(printJobs).values({
        projectId: input.projectId,
        savedMapId: input.savedMapId || null,
        name: input.name,
        templateType: input.templateType,
        pageSize: input.pageSize,
        orientation: input.orientation,
        scale,
        crs: input.crs,
        utmZone: utmZone || null,
        title: input.title,
        subtitle: input.subtitle || null,
        author: input.author || ctx.user.name || null,
        showNorthArrow: input.showNorthArrow,
        showScaleBar: input.showScaleBar,
        showLegend: input.showLegend,
        showGrid: input.showGrid,
        showFrame: input.showFrame,
        layersConfig: input.layersConfig || null,
        status: "pending",
        requestedBy: ctx.user.id,
      });

      const insertId = Number((result as any)[0]?.insertId || 0);

      // Log de auditoria
      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "printJob.create",
        entityType: "printJob",
        entityId: insertId,
        projectId: input.projectId,
        details: { name: input.name, templateType: input.templateType },
        ipAddress: ctx.req.ip || null,
        userAgent: ctx.req.headers?.["user-agent"] || null,
      });

      return { id: insertId, success: true };
    }),

  /**
   * Gerar template HTML para o mapa técnico
   * Este template pode ser renderizado no frontend e exportado para PDF
   */
  generateTemplate: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const [job] = await database
        .select()
        .from(printJobs)
        .where(eq(printJobs.id, input.id));

      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job não encontrado" });
      }

      await checkProjectAccess(job.projectId, ctx.user.id, ctx.user.role);

      // Buscar informações do projeto
      const [project] = await database
        .select()
        .from(projects)
        .where(eq(projects.id, job.projectId));

      // Buscar camadas
      const projectLayers = await database
        .select()
        .from(layers)
        .where(eq(layers.projectId, job.projectId));
      const rasterLayers = summarizeRasterLayers(projectLayers);

      // Gerar configuração do template
      const pageSize = PAGE_SIZES[job.pageSize as keyof typeof PAGE_SIZES];
      const isLandscape = job.orientation === "landscape";

      const templateConfig = {
        job,
        project,
        layers: projectLayers,
        rasterLayers,
        dimensions: {
          width: isLandscape ? pageSize.height : pageSize.width,
          height: isLandscape ? pageSize.width : pageSize.height,
          mapArea: {
            x: 30,
            y: 30,
            width: (isLandscape ? pageSize.height : pageSize.width) - 60,
            height: (isLandscape ? pageSize.width : pageSize.height) - 100,
          },
        },
        elements: {
          title: {
            text: job.title,
            x: 30,
            y: 15,
            fontSize: 16,
          },
          subtitle: job.subtitle ? {
            text: job.subtitle,
            x: 30,
            y: 25,
            fontSize: 12,
          } : null,
          scaleBar: job.showScaleBar ? {
            x: 30,
            y: (isLandscape ? pageSize.width : pageSize.height) - 25,
            scale: job.scale,
          } : null,
          northArrow: job.showNorthArrow ? {
            x: (isLandscape ? pageSize.height : pageSize.width) - 50,
            y: 50,
          } : null,
          legend: job.showLegend ? {
            x: (isLandscape ? pageSize.height : pageSize.width) - 80,
            y: 100,
            width: 60,
          } : null,
          carimbo: {
            x: 30,
            y: (isLandscape ? pageSize.width : pageSize.height) - 60,
            width: (isLandscape ? pageSize.height : pageSize.width) - 60,
            height: 50,
            fields: {
              projeto: project?.name || "",
              cliente: project?.clientName || "",
              titulo: job.title,
              escala: `1:${job.scale}`,
              data: new Date().toLocaleDateString("pt-BR"),
              autor: job.author || "",
              crs: job.crs,
            },
          },
        },
        grid: job.showGrid ? {
          utmZone: job.utmZone,
          crs: job.crs,
        } : null,
      };

      return templateConfig;
    }),

  /**
   * Excluir job de impressão
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
        .from(printJobs)
        .where(eq(printJobs.id, input.id));

      if (!existingJob) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job não encontrado" });
      }

      await checkProjectAccess(existingJob.projectId, ctx.user.id, ctx.user.role);

      if (ctx.user.role === "client") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Clientes não podem excluir jobs de impressão",
        });
      }

      await database
        .delete(printJobs)
        .where(eq(printJobs.id, input.id));

      // Log de auditoria
      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "printJob.delete",
        entityType: "printJob",
        entityId: input.id,
        projectId: existingJob.projectId,
        details: { name: existingJob.name },
        ipAddress: ctx.req.ip || null,
        userAgent: ctx.req.headers?.["user-agent"] || null,
      });

      return { success: true };
    }),
});
