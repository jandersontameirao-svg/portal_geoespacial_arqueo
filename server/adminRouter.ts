import { z } from "zod";
import { router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "./db";
import { protectedProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";

// Middleware para verificar se é admin
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Acesso restrito a administradores",
    });
  }
  return next({ ctx });
});

export const adminRouter = router({
  // Buscar métricas gerais do sistema
  getMetrics: adminProcedure.query(async () => {
    const metrics = await db.getAdminMetrics();
    if (!metrics) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Erro ao buscar métricas",
      });
    }
    return metrics;
  }),

  // Buscar estatísticas de atividade
  getActivityStats: adminProcedure
    .input(z.object({
      days: z.number().min(1).max(365).default(30),
    }))
    .query(async ({ input }) => {
      return await db.getActivityStats(input.days);
    }),

  // Buscar logs de auditoria com filtros e paginação
  getAuditLogs: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
      action: z.string().optional(),
      entityType: z.string().optional(),
      userId: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const { limit, offset, ...filters } = input;
      
      const logs = await db.getFilteredAuditLogs(limit, offset, filters);
      const total = await db.countFilteredAuditLogs(filters);
      
      return {
        logs,
        total,
        hasMore: offset + limit < total,
      };
    }),

  // Listar todos os usuários
  listUsers: adminProcedure.query(async () => {
    const database = await getDb();
    if (!database) return [];

    const allUsers = await database
      .select({
        id: users.id,
        openId: users.openId,
        name: users.name,
        email: users.email,
        role: users.role,
        mfaEnabled: users.mfaEnabled,
        createdAt: users.createdAt,
        lastSignedIn: users.lastSignedIn,
      })
      .from(users)
      .orderBy(desc(users.createdAt));

    return allUsers;
  }),

  // Alterar perfil de um usuário
  changeUserRole: adminProcedure
    .input(z.object({
      userId: z.number(),
      role: z.enum(["admin", "editor", "client"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      // Não permitir alterar o próprio perfil
      if (input.userId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Você não pode alterar seu próprio perfil",
        });
      }

      await database
        .update(users)
        .set({ role: input.role })
        .where(eq(users.id, input.userId));

      // Log de auditoria
      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "admin.changeUserRole",
        entityType: "user",
        entityId: input.userId,
        details: { newRole: input.role },
        ipAddress: ctx.req.ip || null,
        userAgent: ctx.req.headers?.["user-agent"] || null,
      });

      return { success: true };
    }),

  // Resetar MFA de um usuário
  resetUserMfa: adminProcedure
    .input(z.object({
      userId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      await database
        .update(users)
        .set({ 
          mfaEnabled: false, 
          mfaSecret: null,
        })
        .where(eq(users.id, input.userId));

      // Log de auditoria
      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "admin.resetUserMfa",
        entityType: "user",
        entityId: input.userId,
        details: {},
        ipAddress: ctx.req.ip || null,
        userAgent: ctx.req.headers?.["user-agent"] || null,
      });

      return { success: true };
    }),
});
