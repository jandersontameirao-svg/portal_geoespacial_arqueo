import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createConnection, type Connection, type RowDataPacket } from "mysql2/promise";
import type { inferRouterInputs } from "@trpc/server";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { rasterRouter } from "./rasterRouter";
import { filesRouter } from "./filesRouter";
import { ensureFileSafe } from "./virusScanner";
import type { TrpcContext } from "./_core/context";

// The ONLY substituted boundary is storage, and it writes the actual bytes.
// No db/Drizzle/mysql2/scanner/adapter/worker/GDAL mocks or network requests.
// Captures contain metadata only: never retain another copy of a raster Buffer.
type StorageCapture = { key: string; url: string; size: number; mimeType: string; sha256: string };
const localStorage = vi.hoisted(() => ({
  authorized: false,
  root: "",
  puts: [] as StorageCapture[],
}));
vi.mock("./storage", () => ({
  storagePut: async (key: string, bytes: Buffer, mimeType: string) => {
    if (!localStorage.authorized || process.env.F5_SYNTHETIC !== "1" || process.env.F5_LOCAL_ROOT !== localStorage.root) {
      throw new Error("F5 storage requires the validated synthetic local guard");
    }
    const objectRoot = path.join(localStorage.root, "objects");
    const target = path.resolve(objectRoot, key);
    if (!key || key.includes("\\") || !target.startsWith(objectRoot + path.sep)) {
      throw new Error("Unsafe F5 synthetic object key");
    }
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    // A collision must fail rather than silently hide an overwritten original.
    await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    const url = `/synthetic-f5-only/${key}`;
    localStorage.puts.push({ key, url, size: bytes.length, mimeType, sha256: createHash("sha256").update(bytes).digest("hex") });
    return { key, url };
  },
}));

const enabled = process.env.F5_SYNTHETIC === "1";
const fixed = new Date("2026-01-02T03:04:05Z");
const MAX_SIZE = 100 * 1024 * 1024;
const TIMEOUT = 120_000;
const PROJECT = 101;
const OTHER_PROJECT = 102;
const TRIGGER = "`geoportal_f5`.`f5_reject_initial_version`";
const FORCED_FAILURE = "F5_SYNTHETIC_FORCED_VERSION_FAILURE";
const execFileAsync = promisify(execFile);
type RasterInput = inferRouterInputs<typeof rasterRouter>["ingestGeoTiff"];
type Guard = { root: string; socketPath: string; rasterRoot: string; evidenceDir: string };
type Artifact = { key: string; size: number; sha256: string };
type Counts = { files: number; versions: number; layers: number; audits: number };
type GdalInfo = {
  driverShortName: string;
  size: number[];
  coordinateSystem?: { wkt?: string };
  metadata?: { IMAGE_STRUCTURE?: { LAYOUT?: string } };
  bands?: Array<{ noDataValue?: number; overviews?: Array<{ size: number[] }> }>;
};
let connection: Connection | undefined;
let guard: Guard | undefined;
let syntheticScopeConfirmed = false;
let fixture: Buffer;
let sourceGdalInfo: GdalInfo;
const completedCases: Array<{ name: string; evidence: unknown }> = [];
const report: Record<string, unknown> = {
  suite: "F5 raster initial-version local synthetic contracts",
  setupCompleted: false,
  boundaries: {
    database: "real MySQL + mysql2 + Drizzle; separate observation/seed connection",
    scanner: "real scanner, local mode required; VirusTotal configuration forbidden",
    raster: "real direct-local adapter/worker and GDAL; one successful processing request",
    storage: "test-only filesystem substitution, actual bytes, metadata-only captures",
    authentication: "synthetic TrpcContext callers; OAuth/session/HTTP delivery not exercised",
    cleanup: "runner owns the temporary root and database lifecycle",
  },
  limits: { maxBytes: MAX_SIZE, requestedMinZoom: 12, requestedMaxZoom: 12, perTestTimeoutMs: TIMEOUT },
  caveats: [
    "SQL atomicity covers files + file_versions only, not the earlier external storage write.",
    "A forced file_versions failure deliberately retains a synthetic storage orphan; no deletion is attempted.",
    "Failed worker requests may leave files.metadata.rasterIngestion.status=processing; only the layer failure status is asserted.",
    "Download procedures return local synthetic URL references; bytes are verified on disk, not via HTTP or real S3.",
    "Completed cases below are recorded after their assertions; the runner's Vitest result remains authoritative for overall pass/fail.",
  ],
};
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function context(id: number, role: "admin" | "editor" | "client"): TrpcContext {
  return {
    user: {
      id, openId: `f5-${id}`, name: "Synthetic F5", email: "f5@example.invalid", role,
      loginMethod: "synthetic-test", mfaEnabled: false, mfaSecret: null,
      createdAt: fixed, updatedAt: fixed, lastSignedIn: fixed,
    },
    req: { protocol: "http", headers: {}, ip: "127.0.0.1" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}
const raster = () => rasterRouter.createCaller(context(2, "editor"));
const files = () => filesRouter.createCaller(context(2, "editor"));

function payload(bytes: Buffer, filename = "before_raw_epsg4326.tif"): RasterInput {
  return {
    projectId: PROJECT, filename, mimeType: "image/tiff", size: bytes.length,
    fileData: bytes.toString("base64"), name: `F5 ${filename}`,
    description: "Raster exclusivamente sintético local F5",
    acquisitionAt: fixed.toISOString(), sourceLabel: "Fixture sintética local autorizada F5",
    minZoom: 12, maxZoom: 12, nodata: 0, resampling: "cubic",
  };
}

/** Must run before createConnection or ANY SQL, including SELECT/seeding/trigger DDL. */
async function validateGuard(): Promise<Guard> {
  if (!enabled) throw new Error("F5_SYNTHETIC=1 required");
  const root = process.env.F5_LOCAL_ROOT || "";
  if (!/^\/tmp\/atena-f5\.[A-Za-z0-9_-]+$/.test(root) || path.resolve(root) !== root || await realpath(root) !== root) {
    throw new Error("Exact non-symlink /tmp/atena-f5.* root required");
  }
  const url = new URL(process.env.DATABASE_URL || "");
  const socketPath = url.searchParams.get("socketPath") || "";
  if (url.protocol !== "mysql:" || url.hostname !== "127.0.0.1" || url.pathname !== "/geoportal_f5" ||
      url.username !== "root" || url.password || socketPath !== path.join(root, "mysql-data", "mysql.sock") ||
      !/^\/tmp\/atena-f5\.[A-Za-z0-9_-]+\/mysql-data\/mysql\.sock$/.test(socketPath) ||
      await realpath(socketPath) !== socketPath) {
    throw new Error("Exact geoportal_f5 schema / 127.0.0.1 / local root socket only; no password");
  }
  const rasterRoot = path.join(root, "raster-volume");
  if (process.env.ARQUEO_RASTER_INGESTION_MODE !== "direct-local" || process.env.ARQUEO_LOCAL_RASTER_ROOT !== rasterRoot) {
    throw new Error("F5 requires direct-local and exactly ROOT/raster-volume");
  }
  const forbidden = [
    "VIRUSTOTAL_API_KEY", "ARQUEO_RASTER_WORKER_URL", "ARQUEO_RASTER_WORKER_TOKEN",
    "BUILT_IN_FORGE_API_KEY", "VITE_FRONTEND_FORGE_API_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
  ];
  if (forbidden.some((key) => Boolean(process.env[key]))) throw new Error("External service credentials/configuration forbidden in F5");
  const evidenceDir = process.env.F5_EVIDENCE_DIR || "";
  if (!path.isAbsolute(evidenceDir) || path.resolve(evidenceDir) !== evidenceDir || evidenceDir === "/") {
    throw new Error("Explicit absolute F5_EVIDENCE_DIR required");
  }
  await mkdir(rasterRoot, { recursive: true, mode: 0o700 });
  await mkdir(path.join(root, "objects"), { recursive: true, mode: 0o700 });
  if (await realpath(rasterRoot) !== rasterRoot || await realpath(path.join(root, "objects")) !== path.join(root, "objects")) {
    throw new Error("F5 raster/object roots cannot be symlinks");
  }
  return { root, socketPath, rasterRoot, evidenceDir };
}

async function rows(sql: string, values: Array<string | number> = []): Promise<RowDataPacket[]> {
  if (!guard || !connection) throw new Error("Guarded F5 connection not initialized");
  const [result] = await connection.query<RowDataPacket[]>(sql, values);
  return result;
}
function jsonRecord(value: unknown): Record<string, any> {
  if (typeof value === "string") return JSON.parse(value) as Record<string, any>;
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  return {};
}
function assertNoDriverFields(value: object) {
  expect(Array.isArray(value)).toBe(false);
  for (const key of ["insertId", "affectedRows", "fieldCount", "warningStatus", "serverStatus", "protocol41", "fields"]) {
    expect(value).not.toHaveProperty(key);
  }
}
async function counts(): Promise<Counts> {
  const result = await rows("SELECT (SELECT COUNT(*) FROM files) AS files, (SELECT COUNT(*) FROM file_versions) AS versions, (SELECT COUNT(*) FROM layers) AS layers, (SELECT COUNT(*) FROM audit_logs) AS audits");
  const row = result[0];
  return { files: Number(row.files), versions: Number(row.versions), layers: Number(row.layers), audits: Number(row.audits) };
}
async function tree(root: string): Promise<Artifact[]> {
  const result: Artifact[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Symlink forbidden in F5 artefact tree");
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) {
        const bytes = await readFile(target);
        result.push({ key: path.relative(root, target).split(path.sep).join("/"), size: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
  await visit(root);
  return result.sort((a, b) => a.key.localeCompare(b.key));
}
async function snapshot() {
  return { counts: await counts(), storagePuts: localStorage.puts.length, rasterArtifacts: await tree(guard!.rasterRoot) };
}
async function gdalInfo(filename: string): Promise<GdalInfo> {
  const { stdout } = await execFileAsync("/usr/bin/gdalinfo", ["-json", filename], {
    timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GDAL_PAM_ENABLED: "NO", PROJ_NETWORK: "OFF" },
  });
  return JSON.parse(stdout) as GdalInfo;
}
function assertEpsg(info: GdalInfo, epsg: number) {
  expect(info.coordinateSystem?.wkt).toMatch(new RegExp(`(?:ID|AUTHORITY)\\["EPSG",\\s*"?${epsg}"?\\]`));
}
function errorChain(error: unknown) {
  const result: Array<{ message: string; code: string | null; sqlState: string | null }> = [];
  let current = error;
  for (let index = 0; index < 8 && current && typeof current === "object"; index++) {
    const item = current as { message?: unknown; code?: unknown; sqlState?: unknown; cause?: unknown };
    result.push({ message: String(item.message || ""), code: typeof item.code === "string" ? item.code : null, sqlState: typeof item.sqlState === "string" ? item.sqlState : null });
    current = item.cause;
  }
  return result;
}
function complete(name: string, evidence: unknown) { completedCases.push({ name, evidence }); }

async function assertOriginal(fileId: number, bytes: Buffer, filename: string) {
  const scanned = await ensureFileSafe(bytes, filename);
  expect(scanned.safe).toBe(true);
  expect(scanned.result.scanMethod).toBe("local");
  expect(scanned.result.fileHash).toBe(sha256(bytes));
  const file = await files().get({ id: fileId });
  assertNoDriverFields(file);
  expect(file).toMatchObject({ id: fileId, projectId: PROJECT, name: filename, originalName: filename, fileType: "geotiff", mimeType: "image/tiff", fileSize: bytes.length, uploadedBy: 2, isGeospatial: true, currentVersion: 1 });
  expect(typeof file.id).toBe("number");
  expect(file.s3Key).toMatch(new RegExp(`^projects/${PROJECT}/files/[^/]+-${filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  const capture = localStorage.puts.find((item) => item.key === file.s3Key);
  expect(capture).toEqual({ key: file.s3Key, url: file.s3Url, size: bytes.length, mimeType: "image/tiff", sha256: scanned.result.fileHash });
  const stored = await readFile(path.join(guard!.root, "objects", file.s3Key));
  expect(stored.equals(bytes)).toBe(true);
  const versions = await files().versions({ fileId });
  expect(versions).toHaveLength(1);
  const version = versions[0];
  assertNoDriverFields(version);
  expect(typeof version.id).toBe("number");
  expect(version.id).toBeGreaterThan(0);
  expect(version).toMatchObject({
    fileId, version: 1, s3Key: file.s3Key, s3Url: file.s3Url, fileSize: bytes.length,
    mimeType: "image/tiff", sha256: scanned.result.fileHash, uploadedBy: 2,
    metadata: { kind: "initial-upload", originalName: filename, fileType: "geotiff", source: "raster-ingestion", immutableReference: true },
  });
  const sqlFile = await rows("SELECT id,projectId,fileType,mimeType,fileSize,s3Key,s3Url,currentVersion,uploadedBy FROM files WHERE id=?", [fileId]);
  expect(sqlFile).toHaveLength(1);
  expect(sqlFile[0]).toMatchObject({ id: fileId, projectId: PROJECT, fileType: "geotiff", mimeType: "image/tiff", fileSize: bytes.length, s3Key: file.s3Key, s3Url: file.s3Url, currentVersion: 1, uploadedBy: 2 });
  const sqlVersions = await rows("SELECT id,fileId,version,s3Key,s3Url,fileSize,mimeType,sha256,uploadedBy,metadata FROM file_versions WHERE fileId=?", [fileId]);
  expect(sqlVersions).toHaveLength(1);
  expect(sqlVersions[0]).toMatchObject({ id: version.id, fileId, version: 1, s3Key: file.s3Key, s3Url: file.s3Url, fileSize: bytes.length, mimeType: "image/tiff", sha256: sha256(bytes), uploadedBy: 2 });
  expect(jsonRecord(sqlVersions[0].metadata)).toMatchObject({ source: "raster-ingestion", originalName: filename, immutableReference: true });
  const download = await files().downloadVersion({ fileId, version: 1 });
  expect(download).toEqual({ url: file.s3Url, filename: `${filename}.v1`, mimeType: "image/tiff", sha256: sha256(bytes) });
  expect(download.url).toBe(`/synthetic-f5-only/${version.s3Key}`);
  const ordinaryDownload = await files().download({ id: fileId });
  expect(ordinaryDownload).toEqual({ url: file.s3Url, filename, mimeType: "image/tiff" });
  expect(sha256(await readFile(path.join(guard!.root, "objects", version.s3Key)))).toBe(download.sha256);
  return { file, version, scanner: { method: scanned.result.scanMethod, sha256: scanned.result.fileHash } };
}

// Explicitly sequential: local trigger DDL must never overlap another test.
describe.skipIf(!enabled).sequential("F5 local real-driver raster initial version", () => {
  beforeAll(async () => {
    guard = await validateGuard();
    localStorage.root = guard.root;
    localStorage.authorized = true;
    connection = await createConnection({ user: "root", socketPath: guard.socketPath, database: "geoportal_f5" });
    const identity = await rows("SELECT DATABASE() AS db, VERSION() AS engineVersion");
    expect(identity[0].db).toBe("geoportal_f5");
    report.engineVersion = identity[0].engineVersion;
    for (const table of ["users", "projects", "project_members", "files", "file_versions", "layers", "audit_logs"]) {
      expect(Number((await rows(`SELECT COUNT(*) AS n FROM \`${table}\``))[0].n), `F5 requires empty ${table}; never deletes existing data`).toBe(0);
    }
    expect(await rows("SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='geoportal_f5'")).toHaveLength(0);
    const engines = await rows("SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA='geoportal_f5' AND TABLE_NAME IN ('files','file_versions','layers') ORDER BY TABLE_NAME");
    expect(engines).toHaveLength(3);
    expect(engines.every((item) => String(item.engine).toUpperCase() === "INNODB")).toBe(true);
    expect(await tree(path.join(guard.root, "objects"))).toEqual([]);
    expect(await tree(guard.rasterRoot)).toEqual([]);
    const fixturePath = path.join(guard.root, "fixture", "before_raw_epsg4326.tif");
    if (await realpath(fixturePath) !== fixturePath) throw new Error("F5 fixture cannot resolve outside its exact local path");
    fixture = await readFile(fixturePath);
    expect(fixture.length).toBeGreaterThan(8);
    expect(fixture.length).toBeLessThanOrEqual(MAX_SIZE);
    const sourceInfo = await gdalInfo(fixturePath);
    sourceGdalInfo = sourceInfo;
    expect(sourceInfo.driverShortName).toBe("GTiff");
    assertEpsg(sourceInfo, 4326);
    expect(sourceInfo.metadata?.IMAGE_STRUCTURE?.LAYOUT).not.toBe("COG");
    syntheticScopeConfirmed = true;
    await connection.query("INSERT INTO users (id,openId,role) VALUES (1,'f5-admin','admin'),(2,'f5-editor','editor'),(3,'f5-client','client'),(4,'f5-outsider','editor')");
    await connection.query("INSERT INTO projects (id,name,code,createdBy) VALUES (101,'Sintético F5','F5-01',1),(102,'Outro projeto sintético F5','F5-02',1)");
    await connection.query("INSERT INTO project_members (projectId,userId,role,addedBy) VALUES (101,2,'editor',1),(101,3,'viewer',1),(102,4,'editor',1)");
    report.setupCompleted = true;
    report.guard = { schema: "geoportal_f5", hostname: "127.0.0.1", socketOnly: true, nonSymlinkTemporaryRoot: true, externalCredentialsAbsent: true };
    report.transactionTables = engines;
    report.fixture = { filename: "before_raw_epsg4326.tif", bytes: fixture.length, sha256: sha256(fixture), sourceCrs: "EPSG:4326", sourceLayout: sourceInfo.metadata?.IMAGE_STRUCTURE?.LAYOUT || null, dimensions: sourceInfo.size };
  }, TIMEOUT);

  afterAll(async () => {
    try {
      if (guard && connection && syntheticScopeConfirmed) {
        report.finalCounts = await counts();
        report.rows = {
          files: await rows("SELECT id,projectId,name,originalName,fileType,mimeType,fileSize,s3Key,currentVersion,uploadedBy FROM files ORDER BY id"),
          versions: await rows("SELECT id,fileId,version,s3Key,fileSize,mimeType,sha256,uploadedBy,metadata FROM file_versions ORDER BY id"),
          layers: await rows("SELECT id,projectId,fileId,layerType,isVisible,isPublic,createdBy,metadata FROM layers ORDER BY id"),
          audit: await rows("SELECT action,entityType,entityId,projectId,userId FROM audit_logs ORDER BY id"),
        };
        report.rasterArtifacts = await tree(guard.rasterRoot);
      }
    } finally {
      try { if (connection) await connection.end(); }
      finally {
        localStorage.authorized = false;
        // Never write evidence at all when the initial local-only guard failed.
        if (guard) {
          report.storageObjects = localStorage.puts;
          report.completedCases = completedCases;
          await mkdir(guard.evidenceDir, { recursive: true });
          await writeFile(path.join(guard.evidenceDir, "raster-initial-version-report.json"), JSON.stringify(report, null, 2) + "\n");
        }
      }
    }
  }, TIMEOUT);

  it("persists exactly v1 of the scanned ORIGINAL while real GDAL creates a distinct EPSG:4674 COG and zoom-12 tiles", async () => {
    const result = await raster().ingestGeoTiff(payload(fixture));
    expect(result.success).toBe(true);
    assertNoDriverFields(result);
    expect(typeof result.fileId).toBe("number");
    expect(typeof result.layerId).toBe("number");
    const original = await assertOriginal(result.fileId, fixture, "before_raw_epsg4326.tif");
    // No dependency on optional response.version / response.versionId properties.
    expect(result.sourceSha256).toBe(original.version.sha256);
    expect(result.sourceBytes).toBe(fixture.length);
    expect(result.cogSha256).not.toBe(original.version.sha256);
    expect(result.crs).toBe("EPSG:4674");
    expect(result.descriptor).toMatchObject({ minZoom: 12, maxZoom: 12, expectedCrs: "EPSG:4674", nodata: 0 });
    expect(result.descriptor.cogKey).not.toBe(original.version.s3Key);
    const layerRows = await rows("SELECT id,projectId,fileId,layerType,isVisible,isPublic,createdBy,metadata FROM layers WHERE id=?", [result.layerId]);
    expect(layerRows).toHaveLength(1);
    const layer = layerRows[0];
    expect(layer).toMatchObject({ id: result.layerId, projectId: PROJECT, fileId: result.fileId, layerType: "raster", createdBy: 2 });
    expect(Number(layer.isVisible)).toBe(1);
    expect(Number(layer.isPublic)).toBe(0);
    const metadata = jsonRecord(layer.metadata);
    const ingestion = jsonRecord(metadata.rasterIngestion);
    expect(ingestion).toMatchObject({ status: "completed", requestedBy: 2, workerMode: "direct-local", sourceSha256: sha256(fixture), cogSha256: result.cogSha256 });
    expect(metadata.localRaster).toEqual(result.descriptor);
    const workerSource = await readFile(path.join(guard!.rasterRoot, String(ingestion.sourceKey)));
    expect(workerSource.equals(fixture)).toBe(true);
    expect(ingestion.sourceKey).not.toBe(original.version.s3Key);
    const cogPath = path.join(guard!.rasterRoot, result.descriptor.cogKey);
    const cog = await readFile(cogPath);
    expect(cog.equals(fixture)).toBe(false);
    expect(sha256(cog)).toBe(result.cogSha256);
    expect(cog.length).toBe(result.cogBytes);
    const info = await gdalInfo(cogPath);
    expect(info.driverShortName).toBe("GTiff");
    expect(info.metadata?.IMAGE_STRUCTURE?.LAYOUT).toBe("COG");
    assertEpsg(info, 4674);
    expect(info.bands?.length).toBeGreaterThan(0);
    expect(info.bands?.every((band) => band.noDataValue === 0 && (band.overviews?.length || 0) > 0)).toBe(true);
    const stac = jsonRecord(JSON.parse(await readFile(path.join(guard!.rasterRoot, String(ingestion.stacKey)), "utf8")));
    expect(stac.properties).toMatchObject({ "proj:epsg": 4674, "arqueo:processing": { layout: "COG" } });
    const manifest = jsonRecord(JSON.parse(await readFile(path.join(guard!.rasterRoot, String(ingestion.manifestKey)), "utf8")));
    expect(manifest).toMatchObject({ source: { sha256: result.cogSha256, crs: "EPSG:4674" }, tiles: { scheme: "xyz", minZoom: 12, maxZoom: 12 } });
    const tileArtifacts = (await tree(path.join(guard!.rasterRoot, result.descriptor.tilesKey))).filter((item) => item.key.endsWith(".png"));
    expect(tileArtifacts.length).toBeGreaterThan(0);
    expect(tileArtifacts.length).toBe(result.tileCount);
    expect(tileArtifacts.length).toBe(manifest.tiles.count);
    for (const tile of tileArtifacts) {
      expect(tile.key).toMatch(/^12\/\d+\/\d+\.png$/);
      const bytes = await readFile(path.join(guard!.rasterRoot, result.descriptor.tilesKey, tile.key));
      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    }
    const linked = await rows("SELECT f.id AS fileId,f.uploadedBy AS fileUserId,v.id AS versionId,v.fileId AS versionFileId,v.uploadedBy AS versionUserId,l.fileId AS layerFileId,l.createdBy AS layerUserId FROM files f JOIN file_versions v ON v.fileId=f.id JOIN layers l ON l.fileId=f.id WHERE f.id=?", [result.fileId]);
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ fileId: result.fileId, fileUserId: 2, versionId: original.version.id, versionFileId: result.fileId, versionUserId: 2, layerFileId: result.fileId, layerUserId: 2 });
    const audit = await rows("SELECT userId,projectId,entityId FROM audit_logs WHERE action='raster.ingest' AND entityId=?", [result.layerId]);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ userId: 2, projectId: PROJECT, entityId: result.layerId });
    const outsider = filesRouter.createCaller(context(4, "editor"));
    await expect(outsider.get({ id: result.fileId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(outsider.versions({ fileId: result.fileId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(outsider.downloadVersion({ fileId: result.fileId, version: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(outsider.download({ id: result.fileId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(files().downloadVersion({ fileId: result.fileId, version: 2 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await rows("SELECT id FROM files WHERE projectId=?", [OTHER_PROJECT])).toHaveLength(0);
    // Preserve only this known-synthetic pair for inspection after ROOT cleanup.
    const samples = path.join(guard!.evidenceDir, "samples");
    await mkdir(samples, { recursive: true });
    await writeFile(path.join(samples, "f5-original-epsg4326.tif"), fixture);
    await writeFile(path.join(samples, "f5-derived-epsg4674.cog.tif"), cog);
    await writeFile(path.join(samples, "f5-original-gdalinfo.json"), JSON.stringify(sourceGdalInfo, null, 2) + "\n");
    await writeFile(path.join(samples, "f5-cog-gdalinfo.json"), JSON.stringify(info, null, 2) + "\n");
    report.preservedSyntheticSamples = {
      original: { path: path.join(samples, "f5-original-epsg4326.tif"), bytes: fixture.length, sha256: sha256(fixture) },
      cog: { path: path.join(samples, "f5-derived-epsg4674.cog.tif"), bytes: cog.length, sha256: sha256(cog) },
      gdalInfo: [path.join(samples, "f5-original-gdalinfo.json"), path.join(samples, "f5-cog-gdalinfo.json")],
    };
    complete("success-original-v1-real-cog", { fileId: result.fileId, versionId: original.version.id, layerId: result.layerId, originalKey: original.version.s3Key, cogKey: result.descriptor.cogKey, originalSha256: original.version.sha256, cogSha256: result.cogSha256, originalBytes: fixture.length, cogBytes: cog.length, scanner: original.scanner, gdal: { layout: "COG", crs: "EPSG:4674", dimensions: info.size }, tiles: tileArtifacts.length, crossProjectReadDownloadDenied: true });
  }, TIMEOUT);

  it("retains the original and exactly v1 after a real worker TIFF-signature failure; layer stays failed and invisible", async () => {
    const invalid = Buffer.from("F5 invalid raster signature; safe local scanner payload, not a TIFF.");
    const filename = "worker-invalid-signature.tif";
    const before = await counts();
    const artifactsBefore = await tree(guard!.rasterRoot);
    const putCount = localStorage.puts.length;
    await expect(raster().ingestGeoTiff(payload(invalid, filename))).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("assinatura TIFF") });
    expect(localStorage.puts).toHaveLength(putCount + 1);
    const fileRows = await rows("SELECT id FROM files WHERE projectId=? AND originalName=?", [PROJECT, filename]);
    expect(fileRows).toHaveLength(1);
    const original = await assertOriginal(Number(fileRows[0].id), invalid, filename);
    const layerRows = await rows("SELECT id,fileId,isVisible,metadata FROM layers WHERE fileId=?", [original.file.id]);
    expect(layerRows).toHaveLength(1);
    expect(Number(layerRows[0].isVisible)).toBe(0);
    expect(jsonRecord(layerRows[0].metadata).rasterIngestion).toMatchObject({ status: "failed", error: expect.stringContaining("assinatura TIFF") });
    expect((await raster().listForMap({ projectId: PROJECT })).some((item) => item.id === layerRows[0].id)).toBe(false);
    const after = await counts();
    expect(after.files).toBe(before.files + 1);
    expect(after.versions).toBe(before.versions + 1);
    expect(after.layers).toBe(before.layers + 1);
    expect(await tree(guard!.rasterRoot)).toEqual(artifactsBefore);
    const failedAudit = await rows("SELECT userId,projectId FROM audit_logs WHERE action='raster.ingest_failed' AND entityId=?", [Number(layerRows[0].id)]);
    expect(failedAudit).toHaveLength(1);
    expect(failedAudit[0]).toMatchObject({ userId: 2, projectId: PROJECT });
    complete("worker-failure-preserves-original-v1", { fileId: original.file.id, versionId: original.version.id, layerId: layerRows[0].id, sha256: original.version.sha256, scanner: original.scanner, layerStatus: "failed", layerVisible: false, fileMetadataStatusObservedOnly: jsonRecord(original.file.metadata).rasterIngestion?.status ?? null });
  }, TIMEOUT);

  it("uses independent file IDs and object keys for concurrent uploads of the same filename without overwriting either original", async () => {
    const filename = "same-filename.tif";
    const first = Buffer.from("F5 concurrent original A; invalid TIFF signature but safe scanner bytes.");
    const second = Buffer.from("F5 concurrent original B with different content; also not a TIFF signature.");
    const before = await counts();
    const putCount = localStorage.puts.length;
    const requests = await Promise.allSettled([
      raster().ingestGeoTiff(payload(first, filename)),
      raster().ingestGeoTiff(payload(second, filename)),
    ]);
    for (const result of requests) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("assinatura TIFF") });
    }
    const captures = localStorage.puts.slice(putCount);
    expect(captures).toHaveLength(2);
    expect(new Set(captures.map((item) => item.key)).size).toBe(2);
    const fileRows = await rows("SELECT id,s3Key FROM files WHERE projectId=? AND originalName=? ORDER BY id", [PROJECT, filename]);
    expect(fileRows).toHaveLength(2);
    expect(new Set(fileRows.map((item) => Number(item.id))).size).toBe(2);
    const originals = [];
    for (const bytes of [first, second]) {
      const capture = captures.find((item) => item.sha256 === sha256(bytes));
      expect(capture).toBeDefined();
      const file = fileRows.find((item) => item.s3Key === capture!.key);
      expect(file).toBeDefined();
      const original = await assertOriginal(Number(file!.id), bytes, filename);
      const layerRows = await rows("SELECT fileId,isVisible,metadata FROM layers WHERE fileId=?", [original.file.id]);
      expect(layerRows).toHaveLength(1);
      expect(Number(layerRows[0].isVisible)).toBe(0);
      expect(jsonRecord(layerRows[0].metadata).rasterIngestion.status).toBe("failed");
      originals.push({ fileId: original.file.id, versionId: original.version.id, key: original.version.s3Key, sha256: original.version.sha256 });
    }
    // Re-read BOTH after both requests and version/download reads completed.
    for (const bytes of [first, second]) {
      const capture = captures.find((item) => item.sha256 === sha256(bytes))!;
      expect((await readFile(path.join(guard!.root, "objects", capture.key))).equals(bytes)).toBe(true);
    }
    const after = await counts();
    expect(after.files).toBe(before.files + 2);
    expect(after.versions).toBe(before.versions + 2);
    expect(after.layers).toBe(before.layers + 2);
    complete("concurrent-same-filename-independent-originals", { originals, noSecondCogProcessing: true, eachVersionCount: 1 });
  }, TIMEOUT);

  it("rolls back file + v1 on an actual SQL trigger failure before any layer or worker artefact; retains the already-written object as an explicit orphan", async () => {
    expect((await rows("SELECT DATABASE() AS db"))[0].db).toBe("geoportal_f5");
    const before = await snapshot();
    const filename = "rollback-original.tif";
    let thrown: unknown;
    try {
      await connection!.query(`CREATE TRIGGER ${TRIGGER} BEFORE INSERT ON \`geoportal_f5\`.\`file_versions\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${FORCED_FAILURE}'`);
      try { await raster().ingestGeoTiff(payload(fixture, filename)); }
      catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(Error);
      const chain = errorChain(thrown);
      expect(chain.map((item) => item.message).join("\n")).toContain(FORCED_FAILURE);
      expect(chain.some((item) => item.sqlState === "45000" || item.code === "ER_SIGNAL_EXCEPTION")).toBe(true);
      expect(await counts()).toEqual(before.counts);
      expect(await rows("SELECT id FROM files WHERE projectId=? AND originalName=?", [PROJECT, filename])).toHaveLength(0);
      expect(await tree(guard!.rasterRoot)).toEqual(before.rasterArtifacts);
      const captures = localStorage.puts.slice(before.storagePuts);
      expect(captures).toHaveLength(1);
      const orphan = captures[0];
      expect(orphan.sha256).toBe(sha256(fixture));
      expect((await readFile(path.join(guard!.root, "objects", orphan.key))).equals(fixture)).toBe(true);
      expect(await rows("SELECT id FROM files WHERE s3Key=?", [orphan.key])).toHaveLength(0);
      expect(await rows("SELECT id FROM file_versions WHERE s3Key=?", [orphan.key])).toHaveLength(0);
      complete("real-driver-version-insert-rollback", {
        sqlCountsBefore: before.counts, sqlCountsAfter: await counts(),
        driverCodes: chain.map((item) => item.code).filter(Boolean), sqlStates: chain.map((item) => item.sqlState).filter(Boolean),
        triggerMarkerObserved: true, orphan: { ...orphan, deliberatelyRetained: true, sqlReferences: 0 },
        workerEvidence: "No layer/audit insertion and no new/changed raster artefacts with a known-valid fixture; no mocked invocation counter.",
        crossStorageAtomicity: false,
      });
    } finally {
      await connection!.query(`DROP TRIGGER IF EXISTS ${TRIGGER}`);
    }
    expect(await rows("SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='geoportal_f5' AND TRIGGER_NAME='f5_reject_initial_version'")).toHaveLength(0);
  }, TIMEOUT);

  it("denies client, nonmember, unauthenticated and missing-project callers before storage/version/layer/worker writes", async () => {
    const before = await snapshot();
    const input = payload(fixture, "access-denied.tif");
    await expect(rasterRouter.createCaller(context(3, "client")).ingestGeoTiff(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(rasterRouter.createCaller(context(4, "editor")).ingestGeoTiff(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(rasterRouter.createCaller({ ...context(2, "editor"), user: null }).ingestGeoTiff(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(raster().ingestGeoTiff({ ...input, projectId: 999_999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(raster().ingestGeoTiff({ ...input, projectId: OTHER_PROJECT })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await snapshot()).toEqual(before);
    complete("access-guards-before-writes", { denied: ["client", "nonmember", "unauthenticated", "missing project", "other project"], sqlStorageRasterUnchanged: true });
  }, TIMEOUT);

  it("rejects a real MZ malware signature before any storage object or version exists", async () => {
    const before = await snapshot();
    const malware = Buffer.from("MZ F5 synthetic executable signature only; this is not an executable or TIFF.");
    const scanned = await ensureFileSafe(malware, "malware.tif");
    expect(scanned.safe).toBe(false);
    expect(scanned.result.scanMethod).toBe("local");
    expect(scanned.result.threats.join(" ")).toContain("MZ");
    await expect(raster().ingestGeoTiff(payload(malware, "malware.tif"))).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("segurança") });
    expect(await snapshot()).toEqual(before);
    complete("real-scanner-malware-before-writes", { signature: "MZ", method: scanned.result.scanMethod, rejectedSha256: scanned.result.fileHash, sqlStorageRasterUnchanged: true });
  }, TIMEOUT);

  it("rejects declared-size mismatch, over-limit size, invalid MIME and reversed zoom before persistence", async () => {
    const before = await snapshot();
    const input = payload(fixture, "validation-denied.tif");
    await expect(raster().ingestGeoTiff({ ...input, size: fixture.length + 1 })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Tamanho") });
    await expect(raster().ingestGeoTiff({ ...input, size: MAX_SIZE + 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(raster().ingestGeoTiff({ ...input, mimeType: "application/octet-stream" as RasterInput["mimeType"] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(raster().ingestGeoTiff({ ...input, minZoom: 13, maxZoom: 12 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await snapshot()).toEqual(before);
    complete("size-mime-zoom-before-writes", { rejected: ["decoded size mismatch", "over 100 MiB declared size", "unsupported MIME", "minZoom greater than maxZoom"], sqlStorageRasterUnchanged: true });
  }, TIMEOUT);
});
