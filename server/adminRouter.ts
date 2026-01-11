import { z } from "zod";
import { router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "./db";
import { protectedProcedure } from "./_core/trpc";

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
});
