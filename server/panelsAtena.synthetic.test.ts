import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection, type Connection, type RowDataPacket } from "mysql2/promise";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { loadGeometryRows } from "./atena/executor";
import { isWorkspaceFeatureCollection, standaloneWorkspaceGeometry } from "../shared/workspaceHierarchy";

const enabled = process.env.HIERARCHY_ATENA_SYNTHETIC === "1";
const ids = { admin: 920001, editor: 920002, reader: 920003, outsider: 920004, project: 920101, other: 920102, source: 920201, foreign: 920202 };
const now = new Date("2026-11-02T12:00:00Z");
const source = { type: "FeatureCollection", features: [{ type: "Feature", id: "synthetic-point-1", properties: { name: "Ponto sintético" }, geometry: { type: "Point", coordinates: [-47.91, -15.78] } }] };
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  return value;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
let connection: Connection;
let completedRunId: number;
let outputIds: number[] = [];
const report: Record<string, unknown> = { syntheticOnly: true, databaseDriver: "real Drizzle/mysql2", mockDatabase: false, realAtenaGeometryEngine: true, OAuth: "not exercised; synthetic caller context only, no application bypass", externalLLMOrOfficialSourceCalls: false, productionStageWrites: false };

function context(id: number, role: "admin" | "editor" | "client"): TrpcContext {
  return { user: { id, openId: `panels-atena-${id}`, name: "Synthetic panels Atena", email: `synthetic-${id}@example.invalid`, role, loginMethod: "synthetic-test", mfaEnabled: false, mfaSecret: null, createdAt: now, updatedAt: now, lastSignedIn: now }, req: { protocol: "http", headers: {}, ip: "127.0.0.1" } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}
const editor = () => appRouter.createCaller(context(ids.editor, "editor"));
const reader = () => appRouter.createCaller(context(ids.reader, "client"));
const outsider = () => appRouter.createCaller(context(ids.outsider, "editor"));

// No DATABASE_URL fallback. Even an explicitly enabled test rejects other schemas/transports.
describe.skipIf(!enabled)("integrated panels + hierarchy + Atena on isolated real MySQL", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL || "");
    const socketPath = url.searchParams.get("socketPath") || "";
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/geoportal_panels_atena" || !socketPath.startsWith("/tmp/atena-panels-atena.") || !socketPath.endsWith("/mysql-data/mysql.sock")) throw new Error("Exact synthetic schema and local private socket required");
    if (process.env.BUILT_IN_FORGE_API_KEY || process.env.VIRUSTOTAL_API_KEY || process.env.ARQUEO_RASTER_WORKER_URL) throw new Error("External credentials/configuration must be absent");
    connection = await createConnection({ user: "root", socketPath, database: "geoportal_panels_atena" });
    const [version] = await connection.query<RowDataPacket[]>("SELECT VERSION() AS engine");
    report.engine = version[0].engine;
    await connection.query("INSERT INTO users (id,openId,role) VALUES (?,?,'admin'),(?,?,'editor'),(?,?,'client'),(?,?,'editor')", [ids.admin, `panels-${ids.admin}`, ids.editor, `panels-${ids.editor}`, ids.reader, `panels-${ids.reader}`, ids.outsider, `panels-${ids.outsider}`]);
    await connection.query("INSERT INTO projects (id,name,code,createdBy) VALUES (?,'Painéis sintéticos','PANEL-SYNTH-01',?),(?,'Projeto isolado externo','PANEL-SYNTH-02',?)", [ids.project, ids.admin, ids.other, ids.admin]);
    await connection.query("INSERT INTO project_members (projectId,userId,role,addedBy) VALUES (?,?,'editor',?),(?,?,'viewer',?),(?,?,'editor',?)", [ids.project, ids.editor, ids.admin, ids.project, ids.reader, ids.admin, ids.other, ids.outsider, ids.admin]);
    for (const [id, projectId] of [[ids.source, ids.project], [ids.foreign, ids.other]]) await connection.query("INSERT INTO layers (id,projectId,name,layerType,layerData,crs,metadata,createdBy) VALUES (?,?,'Vetor FC legado','vector',?,'EPSG:4326',?,?)", [id, projectId, JSON.stringify(source), JSON.stringify({ kind: "file-vector-import", featureCount: 1 }), ids.admin]);
    report.sourceFingerprintBefore = hash(source);
  });
  afterAll(async () => {
    if (connection) await connection.end();
    if (process.env.HIERARCHY_ATENA_EVIDENCE_DIR) {
      await mkdir(process.env.HIERARCHY_ATENA_EVIDENCE_DIR, { recursive: true });
      await writeFile(path.join(process.env.HIERARCHY_ATENA_EVIDENCE_DIR, "panels-atena-real-driver-report.json"), JSON.stringify(report, null, 2) + "\n");
    }
  });

  it("discovers an existing layerData FC through the Atena adapter without backfill or duplicate rows", async () => {
    const available = await editor().atena.layers({ projectId: ids.project });
    expect(available.find((layer) => layer.id === ids.source)?.featureCount).toBe(1);
    const rows = await loadGeometryRows(ids.project, [ids.source]);
    expect(rows).toHaveLength(1);
    const [dbRows] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM geometries WHERE projectId=?", [ids.project]);
    expect(Number(dbRows[0].n)).toBe(0);
    report.adapter = { rowsLoaded: rows.length, sourceGeometriesPhysicallyInserted: 0 };
  });

  it("plans without writing a run, rejects missing parameters, and respects project boundaries", async () => {
    const [before] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM atena_runs WHERE projectId=?", [ids.project]);
    const missing = await editor().atena.plan({ projectId: ids.project, request: { operation: "vector.buffer", sourceLayerIds: [ids.source] } });
    expect(missing.status).toBe("needs_input");
    const ready = await reader().atena.plan({ projectId: ids.project, request: { operation: "vector.buffer", sourceLayerIds: [ids.source], distanceM: 100 } });
    expect(ready.status).toBe("ready");
    const foreign = await editor().atena.plan({ projectId: ids.project, request: { operation: "vector.buffer", sourceLayerIds: [ids.foreign], distanceM: 100 } });
    expect(foreign.status).toBe("error");
    await expect(outsider().atena.layers({ projectId: ids.project })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [after] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM atena_runs WHERE projectId=?", [ids.project]);
    expect(after[0].n).toBe(before[0].n);
    report.planWithoutWrites = true;
  });

  it("denies execution to a reader and unauthenticated caller with no run or output inserted", async () => {
    const request = { operation: "vector.buffer" as const, sourceLayerIds: [ids.source], distanceM: 100 };
    await expect(reader().atena.run({ projectId: ids.project, request })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(appRouter.createCaller({ ...context(ids.editor, "editor"), user: null }).atena.run({ projectId: ids.project, request })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const [rows] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM atena_runs WHERE projectId=?", [ids.project]);
    expect(Number(rows[0].n)).toBe(0);
  });

  it("runs the actual buffer engine, persists history, and exposes output to the existing GIS workspace", async () => {
    const request = { operation: "vector.buffer" as const, sourceLayerIds: [ids.source], distanceM: 100, outputName: "Buffer sintético integrado" };
    const started = await editor().atena.run({ projectId: ids.project, request, requestText: "Buffer sintético explicitamente confirmado no teste de contrato" });
    expect(started.outcome).toBe("started");
    if (started.outcome !== "started") throw new Error("Run unexpectedly blocked");
    completedRunId = started.runId;
    let run = await editor().atena.get({ runId: completedRunId });
    for (let attempt = 0; attempt < 100 && ["queued", "running"].includes(run.status); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      run = await editor().atena.get({ runId: completedRunId });
    }
    expect(run.status, run.errorMessage || undefined).toBe("completed");
    const all = await editor().gisAnalysis.list({ projectId: ids.project });
    const outputs = all.filter((layer) => (layer.metadata as any)?.kind === "gis-analysis-result" && layer.id !== ids.source);
    expect(outputs.length).toBeGreaterThan(0);
    for (const layer of outputs) {
      expect(isWorkspaceFeatureCollection(layer.layerData)).toBe(true);
      if (!isWorkspaceFeatureCollection(layer.layerData)) throw new Error("Missing FC bridge");
      expect(layer.layerData.features.length).toBeGreaterThan(0);
      expect(layer.layerData.features.every((feature) => feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon")).toBe(true);
    }
    outputIds = outputs.map((layer) => layer.id);
    const [original] = await connection.query<RowDataPacket[]>("SELECT layerData FROM layers WHERE id=?", [ids.source]);
    const value = typeof original[0].layerData === "string" ? JSON.parse(original[0].layerData) : original[0].layerData;
    expect(hash(value)).toBe(hash(source));
    expect((await reader().atena.list({ projectId: ids.project })).some((entry) => entry.id === completedRunId)).toBe(true);
    await expect(outsider().atena.get({ runId: completedRunId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    report.execution = { runId: completedRunId, status: run.status, outputLayerIds: outputIds, outputLayerSha256: outputs.map((layer) => ({ id: layer.id, sha256: hash(layer.layerData) })), originalUnchanged: true };
  });

  it("applies reader-specific output visibility and does not duplicate FC-backed geometry rendering", async () => {
    expect(outputIds.length).toBeGreaterThan(0);
    const outputId = outputIds[0];
    await reader().layers.setVisibility({ id: outputId, visible: false });
    const readerLayers = await reader().layers.list({ projectId: ids.project });
    const editorLayers = await editor().layers.list({ projectId: ids.project });
    expect(readerLayers.find((layer) => layer.id === outputId)?.effectiveVisible).toBe(false);
    expect(editorLayers.find((layer) => layer.id === outputId)?.effectiveVisible).toBe(true);
    const gis = await editor().gisAnalysis.list({ projectId: ids.project });
    expect(standaloneWorkspaceGeometry({ layerId: outputId }, gis)).toBe(false);
    report.presentation = { personalOverrideIsolated: true, duplicateGeometrySuppressedByBridge: true };
  });
});
