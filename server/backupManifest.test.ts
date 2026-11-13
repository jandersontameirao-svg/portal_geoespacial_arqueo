import { describe, expect, it } from "vitest";
import { buildBackupArtifact, restoreToIsolatedMemory, verifyBackupArtifact } from "./backupManifest";

function fixture() {
  return {
    users: [{ id: 1, openId: "synthetic-admin", name: "Admin Sintético" }],
    projects: [{ id: 10, name: "Projeto Sintético", code: "SYN-001", createdBy: 1 }],
    project_members: [{ id: 2, projectId: 10, userId: 1, role: "owner" }],
    files: [{ id: 5, projectId: 10, s3Key: "synthetic/files/orthophoto.tif" }],
    file_versions: [{ id: 6, fileId: 5, version: 1, s3Key: "synthetic/files/orthophoto-v1.tif" }],
    base_layers: [{ id: 7, s3Key: "synthetic/base/uc.geojson" }],
    layers: [{ id: 8, projectId: 10, name: "COG sintético" }],
    geometries: [{ id: 9, projectId: 10, name: "AOI" }],
    saved_maps: [{ id: 11, projectId: 10, name: "Mapa" }],
    print_jobs: [{ id: 12, projectId: 10, outputS3Key: "synthetic/prints/mapa.pdf" }],
    atlas_templates: [{ id: 17, projectId: 10, name: "ABNT sintético", config: { pageSize: "A4" } }],
    atlas_jobs: [{ id: 13, projectId: 10, outputS3Key: "synthetic/atlas/atlas.pdf", individualPagesUrls: [{ page: 1, s3Key: "synthetic/atlas/1.pdf" }] }],
    gis_uploads: [{ id: 14, projectId: 10, s3Key: "synthetic/uploads/aoi.kmz" }],
    notifications: [{ id: 15, userId: 1, title: "Fixture" }],
    audit_logs: [{ id: 16, action: "fixture.create" }],
  };
}

describe("manifesto de backup recuperável", () => {
  it("cobre todas as tabelas e inventaria os objetos referenciados", () => {
    const artifact = buildBackupArtifact(fixture(), { backupId: "fixture", createdAt: "2026-01-01T00:00:00.000Z" });
    expect(artifact.manifest.tables).toHaveLength(29);
    expect(artifact.manifest.tables.find((table) => table.name === "audit_logs")?.rowCount).toBe(1);
    expect(artifact.manifest.objectReferences.map((reference) => reference.logicalKey)).toEqual([
      "synthetic/atlas/1.pdf",
      "synthetic/atlas/atlas.pdf",
      "synthetic/base/uc.geojson",
      "synthetic/files/orthophoto-v1.tif",
      "synthetic/files/orthophoto.tif",
      "synthetic/prints/mapa.pdf",
      "synthetic/uploads/aoi.kmz",
    ]);
    expect(verifyBackupArtifact(artifact)).toEqual({ valid: true, errors: [] });
  });

  it("detecta adulteração e bloqueia a restauração local", () => {
    const artifact = buildBackupArtifact(fixture());
    artifact.tables.projects![0].name = "Alterado";
    const verification = verifyBackupArtifact(artifact);
    expect(verification.valid).toBe(false);
    expect(verification.errors.some((error) => error.includes("projects"))).toBe(true);
    expect(() => restoreToIsolatedMemory(artifact, "local-rehearsal")).toThrow("Backup inválido");
  });

  it("restaura somente em memória no modo local explícito", () => {
    const artifact = buildBackupArtifact(fixture());
    const restored = restoreToIsolatedMemory(artifact, "local-rehearsal");
    expect(restored.projects?.[0].code).toBe("SYN-001");
    restored.projects![0].name = "Somente memória";
    expect(artifact.tables.projects?.[0].name).toBe("Projeto Sintético");
  });
});
