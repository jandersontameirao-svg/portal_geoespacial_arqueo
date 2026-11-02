export type BackupInventoryCandidate = { id: number; backupId: string; expiresAt: Date; status: "complete" | "incomplete" | "expired" | "purged" };

export function retentionExpiry(createdAt: Date, retentionDays: number): Date {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) throw new Error("Retenção deve estar entre 1 e 365 dias");
  const result = new Date(createdAt.getTime());
  result.setUTCDate(result.getUTCDate() + retentionDays);
  return result;
}

export function expiredCompleteInventories(inventories: BackupInventoryCandidate[], now = new Date()) {
  return inventories.filter((inventory) => inventory.status === "complete" && inventory.expiresAt.getTime() <= now.getTime());
}

export function backupInventorySummary(input: { archiveBytes: number; objectBytes: number; totalRecords: number; requiredObjects: number; copiedObjects: number; missingObjects: number }) {
  if ([input.archiveBytes, input.objectBytes, input.totalRecords, input.requiredObjects, input.copiedObjects, input.missingObjects].some((value) => !Number.isInteger(value) || value < 0)) throw new Error("Métricas de inventário inválidas");
  return { ...input, completeness: input.missingObjects === 0 && input.copiedObjects === input.requiredObjects ? "complete" as const : "incomplete" as const };
}
