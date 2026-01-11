import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb } from "./db";
import { savedMaps, projects, projectMembers } from "../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import * as db from "./db";

/**
 * Router para Estados de Mapa Salvos
 * Permite salvar e restaurar configurações de visualização do mapa
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

export const savedMapsRouter = router({
  /**
   * Listar estados de mapa salvos de um projeto
   */
  list: protectedProcedure
    .input(z.object({
      projectId: z.number(),
    }))
    .query(async ({ ctx, input }) => {
      await checkProjectAccess(input.projectId, ctx.user.id, ctx.user.role);
      
      const database = await getDb();
      if (!database) return [];

      const maps = await database
        .select()
        .from(savedMaps)
        .where(eq(savedMaps.projectId, input.projectId))
        .orderBy(desc(savedMaps.updatedAt));

      return maps;
    }),

  /**
   * Obter um estado de mapa específico
   */
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const [map] = await database
        .select()
        .from(savedMaps)
        .where(eq(savedMaps.id, input.id));

      if (!map) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Mapa salvo não encontrado" });
      }

      await checkProjectAccess(map.projectId, ctx.user.id, ctx.user.role);

      return map;
    }),

  /**
   * Criar novo estado de mapa salvo
   */
  create: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      viewMode: z.enum(["2d", "3d"]).default("3d"),
      center: z.object({
        lat: z.number(),
        lon: z.number(),
        height: z.number().optional(),
      }),
      zoom: z.number().optional(),
      heading: z.number().optional(),
      pitch: z.number().optional(),
      activeLayers: z.array(z.object({
        layerId: z.number(),
        opacity: z.number().min(0).max(1),
        zIndex: z.number(),
      })).optional(),
      basemap: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await checkProjectAccess(input.projectId, ctx.user.id, ctx.user.role);

      // Verificar se é editor ou admin
      if (ctx.user.role === "client") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Clientes não podem salvar estados de mapa",
        });
      }

      const database = await getDb();
      if (!database) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const result = await database.insert(savedMaps).values({
        projectId: input.projectId,
        name: input.name,
        description: input.description || null,
        viewMode: input.viewMode,
        center: input.center,
        zoom: input.zoom?.toString() || null,
        heading: input.heading?.toString() || null,
        pitch: input.pitch?.toString() || null,
        activeLayers: input.activeLayers || null,
        basemap: input.basemap || null,
        createdBy: ctx.user.id,
      });

      const insertId = Number((result as any)[0]?.insertId || 0);

      // Log de auditoria
      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "savedMap.create",
        entityType: "savedMap",
        entityId: insertId,
        projectId: input.projectId,
        details: { name: input.name },
        ipAddress: ctx.req.ip || null,
        userAgent: ctx.req.headers?.["user-agent"] || null,
      });

      return { id: insertId, success: true };
    }),

  /**
   * Atualizar estado de mapa salvo
   */
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      viewMode: z.enum(["2d", "3d"]).optional(),
      center: z.object({
        lat: z.number(),
        lon: z.number(),
        height: z.number().optional(),
      }).optional(),
      zoom: z.number().optional(),
      heading: z.number().optional(),
      pitch: z.number().optional(),
      activeLayers: z.array(z.object({
        layerId: z.number(),
        opacity: z.number().min(0).max(1),
        zIndex: z.number(),
      })).optional(),
      basemap: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const [existingMap] = await database
        .select()
        .from(savedMaps)
        .where(eq(savedMaps.id, input.id));

      if (!existingMap) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Mapa salvo não encontrado" });
      }

      await checkProjectAccess(existingMap.projectId, ctx.user.id, ctx.user.role);

      if (ctx.user.role === "client") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Clientes não podem editar estados de mapa",
        });
      }

      const updateData: any = {};
      if (input.name) updateData.name = input.name;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.viewMode) updateData.viewMode = input.viewMode;
      if (input.center) updateData.center = input.center;
      if (input.zoom !== undefined) updateData.zoom = input.zoom?.toString();
      if (input.heading !== undefined) updateData.heading = input.heading?.toString();
      if (input.pitch !== undefined) updateData.pitch = input.pitch?.toString();
      if (input.activeLayers) updateData.activeLayers = input.activeLayers;
      if (input.basemap !== undefined) updateData.basemap = input.basemap;

      await database
        .update(savedMaps)
        .set(updateData)
        .where(eq(savedMaps.id, input.id));

      // Log de auditoria
      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "savedMap.update",
        entityType: "savedMap",
        entityId: input.id,
        projectId: existingMap.projectId,
        details: updateData,
        ipAddress: ctx.req.ip || null,
        userAgent: ctx.req.headers?.["user-agent"] || null,
      });

      return { success: true };
    }),

  /**
   * Excluir estado de mapa salvo
   */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const [existingMap] = await database
        .select()
        .from(savedMaps)
        .where(eq(savedMaps.id, input.id));

      if (!existingMap) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Mapa salvo não encontrado" });
      }

      await checkProjectAccess(existingMap.projectId, ctx.user.id, ctx.user.role);

      if (ctx.user.role === "client") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Clientes não podem excluir estados de mapa",
        });
      }

      await database
        .delete(savedMaps)
        .where(eq(savedMaps.id, input.id));

      // Log de auditoria
      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "savedMap.delete",
        entityType: "savedMap",
        entityId: input.id,
        projectId: existingMap.projectId,
        details: { name: existingMap.name },
        ipAddress: ctx.req.ip || null,
        userAgent: ctx.req.headers?.["user-agent"] || null,
      });

      return { success: true };
    }),
});
