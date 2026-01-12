/**
 * INFRASTRUCTURE ROUTER
 * Endpoints para health checks, métricas e gerenciamento de infraestrutura
 */

import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  checkInfrastructureHealth,
  getSystemMetrics,
  formatBytes,
  formatDuration,
  formatUptime,
  createDatabaseBackup,
  listBackups,
} from "./_core/infrastructure";
import * as db from "./db";

export const infrastructureRouter = router({
  /**
   * Health Check Público
   * Endpoint básico para verificar se o sistema está online
   */
  ping: publicProcedure.query(async () => {
    return {
      status: "ok",
      timestamp: new Date(),
      message: "Portal Geoespacial is running",
    };
  }),

  /**
   * Health Check Detalhado
   * Verifica status de todos os serviços (banco, storage, redis, etc)
   */
  health: publicProcedure.query(async () => {
    const health = await checkInfrastructureHealth();
    
    return {
      ...health,
      formatted: {
        uptime: formatUptime(health.metrics.uptime),
        memory: formatBytes(health.metrics.memory.used) + " / " + formatBytes(health.metrics.memory.total),
        memoryPercentage: health.metrics.memory.percentage.toFixed(1) + "%",
      },
    };
  }),

  /**
   * Métricas do Sistema
   * Retorna métricas detalhadas de performance
   */
  metrics: protectedProcedure.query(async ({ ctx }) => {
    // Apenas admins podem ver métricas
    if (ctx.user.role !== "admin") {
      throw new Error("Unauthorized: Admin access required");
    }

    const metrics = getSystemMetrics();
    const health = await checkInfrastructureHealth();
    
    // Estatísticas do banco de dados
    const totalProjects = await db.countProjects();
    const totalUsers = await db.countUsers();
    const totalFiles = await db.countFiles();
    
    return {
      system: {
        uptime: formatUptime(metrics.uptime),
        uptimeSeconds: metrics.uptime,
        memory: {
          used: formatBytes(metrics.memory.used),
          total: formatBytes(metrics.memory.total),
          percentage: metrics.memory.percentage.toFixed(1) + "%",
        },
        cpu: {
          usage: metrics.cpu.usage.toFixed(2) + "s",
        },
      },
      services: health.services,
      database: {
        totalProjects,
        totalUsers,
        totalFiles,
      },
    };
  }),

  /**
   * Criar Backup Manual
   * Permite admin criar backup do banco de dados
   */
  createBackup: protectedProcedure.mutation(async ({ ctx }) => {
    // Apenas admins podem criar backups
    if (ctx.user.role !== "admin") {
      throw new Error("Unauthorized: Admin access required");
    }

    const result = await createDatabaseBackup();
    
    // Registrar ação em auditoria
    await db.createAuditLog({
      userId: ctx.user.id,
      action: "backup.create",
      entityType: "system",
      entityId: 0, // System-level backup
      details: {
        type: result.type,
        status: result.status,
        duration: result.duration,
        size: result.size,
      },
      ipAddress: ctx.req.ip || ctx.req.socket.remoteAddress || "unknown",
      userAgent: ctx.req.headers["user-agent"] || "unknown",
    });

    return {
      ...result,
      formatted: {
        size: formatBytes(result.size),
        duration: formatDuration(result.duration),
      },
    };
  }),

  /**
   * Listar Backups
   * Lista todos os backups disponíveis
   */
  listBackups: protectedProcedure.query(async ({ ctx }) => {
    // Apenas admins podem ver backups
    if (ctx.user.role !== "admin") {
      throw new Error("Unauthorized: Admin access required");
    }

    const backups = await listBackups();
    
    return backups.map(backup => ({
      ...backup,
      formatted: {
        size: formatBytes(backup.size),
        duration: formatDuration(backup.duration),
      },
    }));
  }),

  /**
   * Status da Infraestrutura
   * Dashboard completo de infraestrutura para admins
   */
  status: protectedProcedure.query(async ({ ctx }) => {
    // Apenas admins podem ver status completo
    if (ctx.user.role !== "admin") {
      throw new Error("Unauthorized: Admin access required");
    }

    const health = await checkInfrastructureHealth();
    const metrics = getSystemMetrics();
    
    // Estatísticas do banco
    const totalProjects = await db.countProjects();
    const totalUsers = await db.countUsers();
    const totalFiles = await db.countFiles();
    const recentAuditLogs = await db.getRecentAuditLogs(10);
    
    return {
      overall: health.overall,
      timestamp: health.timestamp,
      services: health.services.map(service => ({
        ...service,
        formatted: {
          responseTime: service.responseTime ? formatDuration(service.responseTime) : "N/A",
        },
      })),
      metrics: {
        uptime: formatUptime(metrics.uptime),
        uptimeSeconds: metrics.uptime,
        memory: {
          used: formatBytes(metrics.memory.used),
          total: formatBytes(metrics.memory.total),
          percentage: metrics.memory.percentage.toFixed(1) + "%",
          raw: metrics.memory,
        },
        cpu: {
          usage: metrics.cpu.usage.toFixed(2) + "s",
          raw: metrics.cpu.usage,
        },
      },
      database: {
        totalProjects,
        totalUsers,
        totalFiles,
      },
      recentActivity: recentAuditLogs,
    };
  }),
});
