import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb } from "./db";
import * as db from "./db";
import { snapshotRegisteredTables } from "./backupTableSnapshot";
import { buildBackupArtifact } from "./backupManifest";
import { createLocalFilesystemArchive, purgeLocalFilesystemArchive, restoreLocalFilesystemArchive } from "./backupArchive";
import { getRecoverableBackupRuntime, publicBackupAvailability } from "./backupRuntime";
import { backupInventorySummary, expiredCompleteInventories, retentionExpiry } from "./backupInventoryPolicy";

function requireAdmin(role: string) {
  if (role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Apenas administradores podem gerenciar backups" });
}

async function pruneExpiredInventories(actor: { id: number; email?: string | null; name?: string | null }, runtime: ReturnType<typeof getRecoverableBackupRuntime>) {
  if (!runtime.available || !runtime.target) return { purged: 0, failed: 0 };
  const candidates = expiredCompleteInventories(await db.listExpiredBackupInventories());
  let purged = 0;
  let failed = 0;
  for (const inventory of candidates) {
    await db.updateBackupInventoryStatus(inventory.id, "expired");
    try {
      const removed = await purgeLocalFilesystemArchive({ backupId: inventory.backupId, store: runtime.target });
      await db.updateBackupInventoryStatus(inventory.id, "purged");
      await db.createAuditLog({ userId: actor.id, userEmail: actor.email || null, userName: actor.name || null, action: "backup.retention.purge", entityType: "backup_inventory", entityId: inventory.id, projectId: null, details: { backupId: inventory.backupId, deletedObjects: removed.deletedObjects, deletedBytes: removed.deletedBytes }, ipAddress: null, userAgent: null });
      purged++;
    } catch (error) {
      failed++;
      await db.createAuditLog({ userId: actor.id, userEmail: actor.email || null, userName: actor.name || null, action: "backup.retention.failed", entityType: "backup_inventory", entityId: inventory.id, projectId: null, details: { backupId: inventory.backupId, reason: error instanceof Error ? error.message : "falha desconhecida" }, ipAddress: null, userAgent: null });
    }
  }
  return { purged, failed };
}

/**
 * Backups só são declarados recuperáveis quando executados pelo adaptador filesystem
 * configurado, com get/head/list por chave estável. Integração remota continua bloqueada.
 */
export const backupRouter = router({
  create: protectedProcedure.input(z.object({ description: z.string().max(500).optional() }).optional()).mutation(async ({ ctx, input }) => {
    requireAdmin(ctx.user.role);
    const runtime = getRecoverableBackupRuntime();
    if (!runtime.available || !runtime.source || !runtime.target) throw new TRPCError({ code: "PRECONDITION_FAILED", message: runtime.reason });
    const database = await getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
    const policy = await db.getBackupPolicy();
    const retentionDays = policy?.retentionDays || 30;
    const retention = await pruneExpiredInventories(ctx.user, runtime);
    const backup = buildBackupArtifact(await snapshotRegisteredTables(database), { schemaFingerprint: "drizzle-schema-v1" });
    const archive = await createLocalFilesystemArchive({ artifact: backup, source: runtime.source, target: runtime.target });
    const summary = backupInventorySummary({ archiveBytes: archive.archiveBytes, objectBytes: archive.objectBytes, totalRecords: backup.manifest.totals.rows, requiredObjects: archive.manifest.totals.distinctRequiredObjects, copiedObjects: archive.manifest.totals.copiedObjects, missingObjects: archive.manifest.totals.missingObjects });
    const restoreVerifiedAt = archive.manifest.completeness === "complete" ? new Date() : null;
    if (restoreVerifiedAt) await restoreLocalFilesystemArchive({ backupId: backup.manifest.backupId, store: runtime.target });
    const inventoryId = await db.createBackupInventory({
      backupId: backup.manifest.backupId, storageMode: "filesystem", status: summary.completeness,
      manifestKey: archive.manifestKey, manifestChecksumKey: archive.manifestChecksumKey,
      manifestSha256: backup.manifest.integrity.payloadSha256, artifactSha256: archive.manifest.artifact.sha256,
      archiveBytes: archive.archiveBytes, objectBytes: archive.objectBytes, totalRecords: summary.totalRecords,
      requiredObjects: summary.requiredObjects, copiedObjects: summary.copiedObjects, missingObjects: summary.missingObjects,
      retentionDays, expiresAt: retentionExpiry(new Date(backup.manifest.createdAt), retentionDays), restoreVerifiedAt, createdBy: ctx.user.id,
    });
    await db.createAuditLog({ userId: ctx.user.id, userEmail: ctx.user.email || null, userName: ctx.user.name || null, action: "backup.create", entityType: "backup_inventory", entityId: inventoryId, projectId: null, details: { backupId: backup.manifest.backupId, manifestKey: archive.manifestKey, manifestChecksumKey: archive.manifestChecksumKey, manifestSha256: backup.manifest.integrity.payloadSha256, artifactSha256: archive.manifest.artifact.sha256, archiveBytes: archive.archiveBytes, objectBytes: archive.objectBytes, totalRecords: backup.manifest.totals.rows, requiredObjects: archive.manifest.totals.distinctRequiredObjects, copiedObjects: archive.manifest.totals.copiedObjects, missingObjects: archive.manifest.totals.missingObjects, retentionDays, retentionPurged: retention.purged, storageMode: runtime.mode, description: input?.description }, ipAddress: ctx.req.ip || null, userAgent: ctx.req.headers?.["user-agent"] || null });
    if (summary.completeness !== "complete") throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Backup inventariado como incompleto: ${summary.missingObjects} blob(s) não puderam ser copiados` });
    return { success: true, inventoryId, backupId: backup.manifest.backupId, timestamp: backup.manifest.createdAt, archiveBytes: archive.archiveBytes, objectBytes: archive.objectBytes, manifestSha256: backup.manifest.integrity.payloadSha256, artifactSha256: archive.manifest.artifact.sha256, expiresAt: retentionExpiry(new Date(backup.manifest.createdAt), retentionDays), restoreVerifiedAt, recoveryReadiness: "completo: bytes, artifact, manifesto e restauração em memória foram verificados", recoverable: true, storageMode: runtime.mode, retention };
  }),

  list: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.user.role);
    return (await db.listBackupInventories()).map((item) => ({ ...item, recoverable: item.status === "complete", recoveryReadiness: item.status === "complete" ? (item.restoreVerifiedAt ? "restauração verificada" : "requer ensaio de restauração") : item.status === "purged" ? "expirado e removido pela retenção" : "backup incompleto ou expirado" }));
  }),

  verifyRestore: protectedProcedure.input(z.object({ backupId: z.string().min(1).max(64) })).mutation(async ({ ctx, input }) => {
    requireAdmin(ctx.user.role);
    const runtime = getRecoverableBackupRuntime();
    if (!runtime.available || !runtime.target) throw new TRPCError({ code: "PRECONDITION_FAILED", message: runtime.reason });
    const inventory = (await db.listBackupInventories(100)).find((item) => item.backupId === input.backupId);
    if (!inventory || inventory.status !== "complete") throw new TRPCError({ code: "NOT_FOUND", message: "Inventário recuperável não encontrado" });
    const restored = await restoreLocalFilesystemArchive({ backupId: input.backupId, store: runtime.target });
    const now = new Date();
    await db.updateBackupInventoryStatus(inventory.id, "complete", now);
    await db.createAuditLog({ userId: ctx.user.id, userEmail: ctx.user.email || null, userName: ctx.user.name || null, action: "backup.restore.verify", entityType: "backup_inventory", entityId: inventory.id, projectId: null, details: { backupId: input.backupId, tables: Object.keys(restored.tables).length, objects: restored.objects.length }, ipAddress: ctx.req.ip || null, userAgent: ctx.req.headers?.["user-agent"] || null });
    return { success: true, backupId: input.backupId, verifiedAt: now, objects: restored.objects.length, tables: Object.keys(restored.tables).length };
  }),

  status: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.user.role);
    const runtime = getRecoverableBackupRuntime();
    const database = await getDb();
    if (!database) return { healthy: false, databaseHealthy: false, recoverable: false, availability: publicBackupAvailability(runtime), message: "Database not available", lastBackup: null, isRecent: false, recommendation: runtime.reason, inventory: { total: 0, complete: 0, expired: 0, purged: 0 } };
    const inventories = await db.listBackupInventories();
    const lastBackup = inventories[0] || null;
    const isRecent = Boolean(lastBackup?.createdAt) && (Date.now() - new Date(lastBackup!.createdAt).getTime()) / 3_600_000 < 24;
    const count = (status: string) => inventories.filter((item) => item.status === status).length;
    return { healthy: runtime.available, databaseHealthy: true, recoverable: runtime.available, availability: publicBackupAvailability(runtime), lastBackup, isRecent, inventory: { total: inventories.length, complete: count("complete"), expired: count("expired"), purged: count("purged") }, recommendation: runtime.available ? (!lastBackup ? "Nenhum backup recuperável criado ainda." : !isRecent ? "Último backup há mais de 24h. Recomenda-se novo backup." : "Adaptador recuperável disponível; a restauração é verificável pelo inventário.") : runtime.reason };
  }),

  configure: protectedProcedure.input(z.object({ enabled: z.boolean(), intervalHours: z.number().int().min(1).max(168).default(24), retentionDays: z.number().int().min(1).max(365).default(30) })).mutation(async ({ ctx, input }) => {
    requireAdmin(ctx.user.role);
    const runtime = getRecoverableBackupRuntime();
    if (input.enabled && !runtime.available) throw new TRPCError({ code: "PRECONDITION_FAILED", message: runtime.reason });
    await db.upsertBackupPolicy({ ...input, updatedBy: ctx.user.id });
    await db.createAuditLog({ userId: ctx.user.id, userEmail: ctx.user.email || null, userName: ctx.user.name || null, action: "backup.configure", entityType: "backup_policy", entityId: 1, projectId: null, details: { ...input, storageMode: runtime.mode, recoverable: runtime.available }, ipAddress: ctx.req.ip || null, userAgent: ctx.req.headers?.["user-agent"] || null });
    return { success: true, message: input.enabled ? `Backup automático configurado para cada ${input.intervalHours}h, retenção de ${input.retentionDays} dias` : "Backup automático desativado", recoverable: runtime.available, availability: publicBackupAvailability(runtime) };
  }),
});
