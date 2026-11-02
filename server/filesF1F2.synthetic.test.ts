import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createConnection, type Connection, type RowDataPacket } from "mysql2/promise";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { filesRouter } from "./filesRouter";
import { rasterRouter } from "./rasterRouter";
import type { TrpcContext } from "./_core/context";
import { resolveTiffUpload } from "../shared/tiffUploadPolicy";

// Only the storage boundary is replaced, inside this test, with actual local bytes.
// SQL, Drizzle, scanner, router guards, audit and versioning remain real.
vi.mock("./storage", () => ({ storagePut: async (key: string, bytes: Buffer) => {
  const root = process.env.F1F2_LOCAL_ROOT || "";
  if (!root.startsWith("/tmp/atena-f1f2.")) throw new Error("Synthetic filesystem root required");
  const target = path.join(root, "objects", key);
  if (!target.startsWith(path.join(root, "objects") + path.sep)) throw new Error("Unsafe synthetic key");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return { key, url: `/synthetic-only/${key}` };
} }));

const enabled = process.env.F1F2_SYNTHETIC === "1";
const fixed = new Date("2026-01-02T03:04:05Z");
const types = ["kml", "kmz", "shp", "geojson", "geotiff", "pdf", "docx", "xlsx", "image", "other"];
let connection: Connection;
let bytes: Buffer;
const report: Record<string, unknown> = { realMySQLDrizzle: true, realScanner: true, storage: "test-only filesystem boundary substitution", oauth: "not tested; synthetic caller contexts, no app bypass", productionStageTouched: false };
function context(id: number, role: "admin" | "editor" | "client"): TrpcContext {
  return { user: { id, openId: `f1f2-${id}`, name: "Synthetic F1F2", email: "test@example.invalid", role, loginMethod: "synthetic-test", mfaEnabled: false, mfaSecret: null, createdAt: fixed, updatedAt: fixed, lastSignedIn: fixed }, req: { protocol: "http", headers: {}, ip: "127.0.0.1" } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}
const editor = () => filesRouter.createCaller(context(2, "editor"));
const sha256 = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
const labelSet = (rows: Array<{ fileType: string }>) => [...new Set(rows.map((row) => row.fileType))].sort();

describe.skipIf(!enabled)("F1/F2 local real-driver files contracts", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL || "");
    const socketPath = url.searchParams.get("socketPath") || "";
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/geoportal_f1f2" || !socketPath.startsWith("/tmp/atena-f1f2.") || !socketPath.endsWith("/mysql.sock")) throw new Error("Exact local socket/schema required");
    if (process.env.VIRUSTOTAL_API_KEY || process.env.ARQUEO_RASTER_WORKER_URL || process.env.ARQUEO_RASTER_INGESTION_MODE) throw new Error("No external scanner/raster configuration allowed");
    connection = await createConnection({ user: "root", socketPath, database: "geoportal_f1f2" });
    const [version] = await connection.query<RowDataPacket[]>("SELECT VERSION() AS version");
    report.engine = version[0].version;
    await connection.query("INSERT INTO users (id,openId,role) VALUES (1,'f1f2-admin','admin'),(2,'f1f2-editor','editor'),(3,'f1f2-client','client'),(4,'f1f2-outsider','editor')");
    await connection.query("INSERT INTO projects (id,name,code,createdBy) VALUES (101,'Sintético F1F2','F1F2-01',1),(102,'Projeto externo sintético','F1F2-02',1)");
    await connection.query("INSERT INTO project_members (projectId,userId,role,addedBy) VALUES (101,2,'editor',1),(101,3,'viewer',1),(102,4,'editor',1)");
    for (const [index, type] of types.entries()) {
      await connection.query("INSERT INTO files (id,projectId,name,originalName,fileType,fileSize,s3Key,s3Url,isGeospatial,uploadedBy) VALUES (?,101,?,?,?,?,?,?,?,1)", [201 + index, `F1F2 ${type}`,`synthetic.${type}`,type,16,`synthetic/${type}`,`/synthetic/${type}`,["kml","kmz","shp","geojson","geotiff"].includes(type)]);
    }
    await connection.query("INSERT INTO files (id,projectId,name,originalName,fileType,fileSize,s3Key,s3Url,isGeospatial,uploadedBy) VALUES (301,102,'Private raster','private.tif','geotiff',16,'private','/synthetic/private',1,1),(302,101,'Deleted raster','deleted.tif','geotiff',16,'deleted','/synthetic/deleted',1,1)");
    await connection.query("UPDATE files SET deletedAt=NOW() WHERE id=302");
    bytes = await readFile(path.join(process.env.F1F2_LOCAL_ROOT!, "valid-synthetic.tif"));
    report.fixture = { validGeoTiffVerifiedByGDALInExecutor: true, size: bytes.length, sha256: sha256(bytes) };
  });
  afterAll(async () => {
    if (connection) await connection.end();
    const target = process.env.F1F2_EVIDENCE_DIR;
    if (target) { await mkdir(target, { recursive: true }); await writeFile(path.join(target, "real-driver-report.json"), JSON.stringify(report, null, 2) + "\n"); }
  });

  it("F1 includes geotiff in both SQL/global and project categories, preserving old labels", async () => {
    const categories = { geospatial: ["kml","kmz","shp","geojson","geotiff"], document: ["pdf","docx","xlsx"], image: ["image"], other: ["other"] } as const;
    for (const [category, expected] of Object.entries(categories)) {
      const global = await editor().listAll({ category: category as keyof typeof categories });
      const project = await editor().list({ projectId: 101, category: category as keyof typeof categories });
      expect(labelSet(global)).toEqual([...expected].sort());
      expect(labelSet(project)).toEqual([...expected].sort());
      expect(global.every((row) => row.projectId === 101)).toBe(true);
      expect(global.some((row) => row.id === 302)).toBe(false);
    }
    report.categories = categories;
    expect(labelSet(await editor().list({ projectId: 101, category: "all" }))).toEqual([...types].sort());
  });
  it("F1 keeps search, pagination and project isolation", async () => {
    expect((await editor().listAll({ category: "geospatial", search: "geotiff" })).map((row) => row.id)).toEqual([205]);
    expect(await editor().listAll({ category: "geospatial", search: "geotiff", offset: 1, limit: 1 })).toEqual([]);
    await expect(editor().list({ projectId: 102, category: "geospatial" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const outsider = filesRouter.createCaller(context(4, "editor"));
    expect((await outsider.listAll({ category: "geospatial" })).map((row) => row.id)).toEqual([301]);
  });
  it("F2 stores original a.tif without raster configured, preserving bytes, SQL type and initial version hash", async () => {
    const policy = resolveTiffUpload({ name: "a.tif", type: "application/geotiff" }, "original");
    const result = await editor().upload({ projectId: 101, filename: "a.tif", mimeType: policy.genericMime, size: bytes.length, fileData: bytes.toString("base64"), category: "image", description: "Original TIFF sintético sem processamento raster", tags: ["image","tif"] });
    expect(result.file).toMatchObject({ name: "a.tif", originalName: "a.tif", fileType: "image", mimeType: "image/tiff", isGeospatial: false });
    expect(result.layerId).toBeNull();
    const stored = await readFile(path.join(process.env.F1F2_LOCAL_ROOT!, "objects", result.file.s3Key));
    expect(sha256(stored)).toBe(sha256(bytes));
    const versions = await editor().versions({ fileId: result.file.id });
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, sha256: sha256(bytes), mimeType: "image/tiff", fileSize: bytes.length });
    const [layers] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM layers WHERE fileId=?", [result.file.id]);
    expect(Number(layers[0].n)).toBe(0);
    const [audit] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_logs WHERE entityId=? AND action='file.upload'", [result.file.id]);
    expect(Number(audit[0].n)).toBe(1);
    report.originalUpload = { fileId: result.file.id, fileType: result.file.fileType, versionCount: versions.length, sha256: sha256(stored), layers: 0, scanner: "real local signature scanner; no API key", sourceMime: "application/geotiff", sentMime: policy.genericMime };
  });
  it("F2 short-name request satisfies unchanged raster schema and fails before writes when unavailable", async () => {
    const before = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM files");
    const policy = resolveTiffUpload({ name: "a.tif", type: "image/tiff" }, "raster");
    await expect(rasterRouter.createCaller(context(2,"editor")).ingestGeoTiff({ projectId:101, filename:"a.tif", mimeType:"image/tiff", size:bytes.length, fileData:bytes.toString("base64"), name:policy.rasterName, acquisitionAt:fixed.toISOString(), sourceLabel:"Synthetic authorized test" })).rejects.toMatchObject({ code:"PRECONDITION_FAILED" });
    const after = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM files");
    expect(after[0][0].n).toBe(before[0][0].n);
    report.shortName = { filename: "a.tif", rasterName: policy.rasterName, validation: "passed name schema; real PRECONDITION_FAILED availability guard", noWrite: true };
  });
  it("F2 keeps client/nonmember/unauthenticated guards and scanner rejection before local storage", async () => {
    const payload = { projectId:101,filename:"a.tif",mimeType:"image/tiff",size:bytes.length,fileData:bytes.toString("base64"),category:"image" as const,description:"Original TIFF sintético seguro",tags:["image"] };
    await expect(filesRouter.createCaller(context(3,"client")).upload(payload)).rejects.toMatchObject({ code:"FORBIDDEN" });
    await expect(filesRouter.createCaller(context(4,"editor")).upload(payload)).rejects.toMatchObject({ code:"FORBIDDEN" });
    await expect(filesRouter.createCaller({ ...context(2,"editor"), user:null }).upload(payload)).rejects.toMatchObject({ code:"UNAUTHORIZED" });
    const malware = Buffer.from("MZ synthetic dangerous executable; not TIFF");
    await expect(editor().upload({ ...payload, size:malware.length,fileData:malware.toString("base64") })).rejects.toMatchObject({ code:"BAD_REQUEST" });
    report.securityNegatives = ["client role denied", "nonmember denied", "unauthenticated denied", "MZ signature rejected by actual scanner"];
  });
});
