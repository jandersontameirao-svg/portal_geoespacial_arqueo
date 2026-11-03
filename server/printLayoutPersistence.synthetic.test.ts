import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createConnection, type Connection, type RowDataPacket } from "mysql2/promise";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { PRINT_LAYOUT_SEEDS, writeMapPrintLayoutConfig, readMapPrintLayoutConfig } from "../shared/mapPrintLayouts";

const enabled = process.env.PRINT_LAYOUT_LOCAL_SYNTHETIC === "1";
let connection: Connection;
let legacyHash = "";
const report: Record<string, unknown> = { syntheticOnly: true, realDrizzleMysql2: true, databaseMocked: false, OAuthExercised: false, appAuthBypassAdded: false, externalNetworkAvailable: false };
function canonical(value: any): any {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
function context(role: "admin" | "editor" | "client"): TrpcContext {
  const date = new Date("2026-01-01T12:00:00Z");
  return { user: { id: role === "admin" ? 1 : role === "editor" ? 2 : 3, openId: `synthetic-${role}`, role, name: "SYNTHETIC print layout actor", email: null, loginMethod: "synthetic-test", mfaEnabled: false, mfaSecret: null, createdAt: date, updatedAt: date, lastSignedIn: date }, req: { headers: {}, ip: "127.0.0.1", protocol: "http" } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}
const admin = () => appRouter.createCaller(context("admin"));
const editor = () => appRouter.createCaller(context("editor"));
const reader = () => appRouter.createCaller(context("client"));
const anonymous = () => appRouter.createCaller({ ...context("client"), user: null });
async function legacyRows() { return (await connection.query("SELECT * FROM atlas_templates WHERE id=99001"))[0]; }

describe.skipIf(!enabled)("Print layout models via real Drizzle/mysql2 and existing Atlas API", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL || "");
    const socket = url.searchParams.get("socketPath") || "";
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/geoportal_print_layout_synthetic" || !socket.startsWith("/tmp/atena-print-layout.") || !socket.endsWith("/mysql-data/mysql.sock")) throw Error("Exact private synthetic database/socket required");
    if (process.env.BUILT_IN_FORGE_API_KEY || process.env.OGC_ALLOWED_HOSTS) throw Error("External credentials/configuration forbidden");
    connection = await createConnection({ user: "root", socketPath: socket, database: "geoportal_print_layout_synthetic" });
    const [engine] = await connection.query<RowDataPacket[]>("SELECT VERSION() AS version");
    report.engine = engine[0].version;
    await connection.query("INSERT INTO projects (id,name,code,createdBy,status) VALUES (99001,'SYNTHETIC print project','SYNTH-PRINT',1,'active'),(99002,'SYNTHETIC other project','SYNTH-OTHER',1,'active')");
    await connection.query("INSERT INTO project_members (projectId,userId,role,addedBy) VALUES (99001,2,'editor',1),(99001,3,'viewer',1)");
    await connection.query("INSERT INTO atlas_templates (id,projectId,name,templateType,config,isDefault,createdBy) VALUES (99001,99001,'SYNTHETIC existing Atlas','abnt_tecnico',?,1,1)", [JSON.stringify({ pageSize: "A3", orientation: "landscape", scale: "10000", overlap: "10", templateType: "abnt_tecnico" })]);
    legacyHash = fingerprint(await legacyRows());
    report.legacyBeforeHash = legacyHash;
  });
  afterAll(async () => {
    if (connection) {
      report.legacyAfterHash = fingerprint(await legacyRows());
      report.legacyPreserved = report.legacyAfterHash === legacyHash;
      const [rows] = await connection.query<RowDataPacket[]>("SELECT id,name,config,isDefault FROM atlas_templates ORDER BY id");
      report.persistedTemplates = rows.map(row => ({ ...row, config: typeof row.config === "string" ? JSON.parse(row.config) : row.config }));
      await connection.end();
    }
    if (process.env.PRINT_LAYOUT_EVIDENCE_DIR) await writeFile(process.env.PRINT_LAYOUT_EVIDENCE_DIR + "/print-layout-real-driver-report.json", JSON.stringify(report, null, 2) + "\n");
  });
  it("denies anonymous access and client writes without changing existing templates", async () => {
    await expect(anonymous().atlas.templates.list({ projectId: 99001 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(reader().atlas.templates.create({ projectId: 99001, name: "SYNTHETIC forbidden", templateType: "cliente", config: { printLayout: { version: 1 } }, isDefault: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(editor().atlas.templates.list({ projectId: 99002 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fingerprint(await legacyRows())).toBe(legacyHash);
  });
  it("round-trips a versioned layout JSON through the actual router and SQL JSON column", async () => {
    const config = writeMapPrintLayoutConfig(PRINT_LAYOUT_SEEDS[1].config);
    const created = await editor().atlas.templates.create({ projectId: 99001, name: "SYNTHETIC technical print layout", templateType: "cliente", config, isDefault: false });
    const listed = await reader().atlas.templates.list({ projectId: 99001 });
    const stored = listed.find(row => row.id === created.id);
    expect(stored?.config).toEqual(config);
    expect(readMapPrintLayoutConfig(stored?.config)).toEqual(PRINT_LAYOUT_SEEDS[1].config);
    expect(fingerprint(stored?.config)).toBe(fingerprint(config));
    expect(stored?.isDefault).toBe(false);
    expect(listed).toHaveLength(2);
    expect(fingerprint(await legacyRows())).toBe(legacyHash);
    report.modelId = created.id;
    report.configInputHash = fingerprint(config);
    report.configPersistedHash = fingerprint(stored?.config);
    report.persistedThroughRouter = true;
    report.readerCanReadButNotWrite = true;
    report.existingAtlasDefaultPreserved = true;
  });
});
