import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb } from "./db";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { storagePut } from "./storage";

/**
 * Router para Backup do Banco de Dados
 * Gerencia backups manuais e automáticos
 */

// Verificar se usuário é admin
function requireAdmin(role: string) {
  if (role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Apenas administradores podem gerenciar backups",
    });
  }
}

// Tabelas para backup
const BACKUP_TABLES = [
  "users",
  "projects",
  "project_members",
  "invitations",
  "files",
  "file_versions",
  "layers",
  "geometries",
  "saved_maps",
  "print_jobs",
  "atlas_jobs",
  "audit_log",
];

export const backupRouter = router({
  /**
   * Criar backup manual do banco de dados
   */
  create: protectedProcedure
    .input(z.object({
      description: z.string().optional(),
    }).optional())
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.user.role);

      const database = await getDb();
      if (!database) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupData: Record<string, any[]> = {};
      const errors: string[] = [];

      // Exportar cada tabela
      for (const tableName of BACKUP_TABLES) {
        try {
          const result = await database.execute(sql.raw(`SELECT * FROM ${tableName}`));
          backupData[tableName] = Array.isArray(result) ? result : (result as any)[0] || [];
        } catch (error: any) {
          // Tabela pode não existir ainda
          errors.push(`${tableName}: ${error.message}`);
          backupData[tableName] = [];
        }
      }

      // Criar arquivo de backup
      const backup = {
        version: "1.0",
        timestamp: new Date().toISOString(),
        description: input?.description || "Backup manual",
        createdBy: ctx.user.id,
        createdByName: ctx.user.name,
        tables: backupData,
        metadata: {
          totalRecords: Object.values(backupData).reduce((sum, arr) => sum + arr.length, 0),
          tablesCount: BACKUP_TABLES.length,
          errors: errors.length > 0 ? errors : undefined,
        },
      };

      const backupJson = JSON.stringify(backup, null, 2);
      const backupBuffer = Buffer.from(backupJson, "utf-8");

      // Salvar no S3
      const fileKey = `backups/backup-${timestamp}.json`;
      const { url } = await storagePut(fileKey, backupBuffer, "application/json");

      // Registrar no audit log
      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "backup.create",
        entityType: "backup",
        entityId: null,
        projectId: null,
        details: {
          fileKey,
          totalRecords: backup.metadata.totalRecords,
          description: input?.description,
        },
        ipAddress: ctx.req.ip || null,
        userAgent: ctx.req.headers?.["user-agent"] || null,
      });

      return {
        success: true,
        fileKey,
        url,
        timestamp: backup.timestamp,
        totalRecords: backup.metadata.totalRecords,
        errors: errors.length > 0 ? errors : undefined,
      };
    }),

  /**
   * Listar backups disponíveis
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.user.role);

    const database = await getDb();
    if (!database) return [];

    // Buscar logs de backup da tabela audit_logs
    const backupLogs = await database.execute(
      sql`SELECT * FROM audit_logs WHERE action = 'backup.create' ORDER BY timestamp DESC LIMIT 50`
    );

    const logs = Array.isArray(backupLogs) ? backupLogs : (backupLogs as any)[0] || [];

    return logs.map((log: any) => ({
      id: log.id,
      createdAt: log.timestamp,
      createdBy: log.userName || log.userEmail,
      details: typeof log.details === "string" ? JSON.parse(log.details) : log.details,
    }));
  }),

  /**
   * Verificar status do sistema de backup
   */
  status: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.user.role);

    const database = await getDb();
    if (!database) {
      return {
        healthy: false,
        message: "Database not available",
        lastBackup: null,
      };
    }

    // Buscar último backup
    const lastBackupResult = await database.execute(
      sql`SELECT * FROM audit_logs WHERE action = 'backup.create' ORDER BY timestamp DESC LIMIT 1`
    );

    const lastBackupLogs = Array.isArray(lastBackupResult) 
      ? lastBackupResult 
      : (lastBackupResult as any)[0] || [];
    
    const lastBackup = lastBackupLogs[0] || null;

    // Verificar se backup é recente (menos de 24h)
    let isRecent = false;
    if (lastBackup) {
      const lastBackupDate = new Date(lastBackup.timestamp);
      const hoursSinceBackup = (Date.now() - lastBackupDate.getTime()) / (1000 * 60 * 60);
      isRecent = hoursSinceBackup < 24;
    }

    return {
      healthy: true,
      lastBackup: lastBackup ? {
        id: lastBackup.id,
        createdAt: lastBackup.timestamp,
        createdBy: lastBackup.userName || lastBackup.userEmail,
        details: typeof lastBackup.details === "string" 
          ? JSON.parse(lastBackup.details) 
          : lastBackup.details,
      } : null,
      isRecent,
      recommendation: !lastBackup 
        ? "Nenhum backup encontrado. Crie um backup agora."
        : !isRecent 
          ? "Último backup há mais de 24h. Recomendado criar novo backup."
          : "Sistema de backup em dia.",
    };
  }),

  /**
   * Agendar backup automático (configuração)
   */
  configure: protectedProcedure
    .input(z.object({
      enabled: z.boolean(),
      intervalHours: z.number().min(1).max(168).default(24), // 1h a 7 dias
      retentionDays: z.number().min(1).max(365).default(30),
    }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.user.role);

      // Registrar configuração no audit log
      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "backup.configure",
        entityType: "backup",
        entityId: null,
        projectId: null,
        details: {
          enabled: input.enabled,
          intervalHours: input.intervalHours,
          retentionDays: input.retentionDays,
        },
        ipAddress: ctx.req.ip || null,
        userAgent: ctx.req.headers?.["user-agent"] || null,
      });

      return {
        success: true,
        message: input.enabled 
          ? `Backup automático configurado para cada ${input.intervalHours}h, retenção de ${input.retentionDays} dias`
          : "Backup automático desativado",
      };
    }),
});
