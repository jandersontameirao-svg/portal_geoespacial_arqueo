import { describe, expect, it } from "vitest";
import { buildBackupArtifact, restoreToIsolatedMemory, sha256, verifyBackupArtifact, type BackupArtifact, type BackupRows } from "./backupManifest";
import { legacyBackupTableRegistry } from "./backupTableRegistry";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function legacyArtifact(): BackupArtifact {
  const tables: BackupRows = {};
  for (const table of legacyBackupTableRegistry) tables[table.name] = table.name === "users" ? [{ id: 1, name: "Synthetic historical" }] : [];
  return { tables, manifest: { formatVersion: "2.0-local-rehearsal", backupId: "synthetic-historical", createdAt: "2026-01-01T00:00:00Z", schemaFingerprint: "historical", tables: legacyBackupTableRegistry.map((table) => ({ ...table, rowCount: tables[table.name]!.length, sha256: sha256(stable(tables[table.name])) })), objectReferences: [], totals: { rows: 1, requiredObjects: 0 }, integrity: { algorithm: "sha256", payloadSha256: sha256(stable(tables)) }, completeness: "complete" } };
}

describe("Atena backup manifest registry evolution (pure, synthetic only)", () => {
  it("includes all new tables in explicit v2.1 and inventories PDF bytes by stable artifactKey", () => {
    const artifact = buildBackupArtifact({ atena_runs: [{ id: 7, status: "completed", artifactKey: "synthetic/atena/run-7.pdf" }], user_project_selection: [{ id: 2, userId: 3, projectId: 4 }], user_layer_visibility: [{ id: 3, userId: 3, layerId: 5, visible: 0 }], user_base_layer_visibility: [{ id: 4, userId: 3, baseLayerId: 9, visible: 1 }] });
    expect(artifact.manifest.formatVersion).toBe("2.1-local-rehearsal");
    expect(verifyBackupArtifact(artifact)).toEqual({ valid: true, errors: [] });
    expect(artifact.manifest.objectReferences).toContainEqual({ logicalKey: "synthetic/atena/run-7.pdf", source: { table: "atena_runs", primaryKey: 7, field: "artifactKey" }, required: true });
    expect(restoreToIsolatedMemory(artifact, "local-rehearsal")).toEqual(artifact.tables);
  });
  it("still verifies and clones an exact historical v2.0 table set", () => {
    const artifact = legacyArtifact();
    expect(verifyBackupArtifact(artifact)).toEqual({ valid: true, errors: [] });
    expect(restoreToIsolatedMemory(artifact, "local-rehearsal")).toEqual(artifact.tables);
  });
  it("does not accept an unaccounted Atena table injected into a legacy envelope", () => {
    const artifact = legacyArtifact();
    artifact.tables.atena_runs = [{ id: 1, status: "completed" }];
    expect(verifyBackupArtifact(artifact).valid).toBe(false);
  });
  it("detects removal of a new table or corruption of its rows", () => {
    const artifact = buildBackupArtifact({ atena_runs: [{ id: 1, status: "completed" }] });
    artifact.tables.atena_runs![0].status = "failed";
    expect(verifyBackupArtifact(artifact).valid).toBe(false);
    const other = buildBackupArtifact({});
    other.manifest.tables = other.manifest.tables.filter((table) => table.name !== "user_layer_visibility");
    expect(verifyBackupArtifact(other).valid).toBe(false);
  });
});
