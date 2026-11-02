import { describe, expect, it } from "vitest";
import { backupInventorySummary, expiredCompleteInventories, retentionExpiry } from "./backupInventoryPolicy";

describe("política de inventário recuperável", () => {
  it("calcula expiração por dias UTC e rejeita retenção fora do intervalo", () => {
    expect(retentionExpiry(new Date("2026-01-01T00:00:00.000Z"), 30).toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(() => retentionExpiry(new Date(), 0)).toThrow("Retenção");
  });

  it("seleciona somente backups completos vencidos para purge", () => {
    const now = new Date("2026-02-01T00:00:00.000Z");
    const due = expiredCompleteInventories([
      { id: 1, backupId: "old", status: "complete", expiresAt: new Date("2026-01-31T00:00:00.000Z") },
      { id: 2, backupId: "future", status: "complete", expiresAt: new Date("2026-02-02T00:00:00.000Z") },
      { id: 3, backupId: "partial", status: "incomplete", expiresAt: new Date("2026-01-01T00:00:00.000Z") },
    ], now);
    expect(due.map((item) => item.backupId)).toEqual(["old"]);
  });

  it("não declara recuperação completa quando faltar blob físico", () => {
    expect(backupInventorySummary({ archiveBytes: 100, objectBytes: 80, totalRecords: 4, requiredObjects: 2, copiedObjects: 1, missingObjects: 1 }).completeness).toBe("incomplete");
    expect(backupInventorySummary({ archiveBytes: 100, objectBytes: 80, totalRecords: 4, requiredObjects: 2, copiedObjects: 2, missingObjects: 0 }).completeness).toBe("complete");
  });
});
