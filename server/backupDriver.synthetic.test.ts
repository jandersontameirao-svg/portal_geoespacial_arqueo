import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnection, type Connection, type RowDataPacket } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { backupRouter } from "./backupRouter";
import { backupTableRegistry } from "./backupTableRegistry";
import { buildBackupArtifact, type BackupArtifact, type BackupRows, verifyBackupArtifact } from "./backupManifest";
import { restoreLocalFilesystemArchive } from "./backupArchive";
import { LocalFilesystemBackupStore } from "./localFilesystemBackupStore";
import { sha256Buffer } from "./backupStore";
import type { TrpcContext } from "./_core/context";

// Intentionally skipped in ordinary runs: only the private, disposable executor
// may enable this suite. No driver mocks, no external configuration or OAuth.
const enabled = process.env.F4_DRIVER_SYNTHETIC === "1";
const fixed = new Date("2026-01-02T03:04:05.000Z");
const roots: string[] = [];
let database: NonNullable<Awaited<ReturnType<typeof getDb>>>;
let connection: Connection;
let source: LocalFilesystemBackupStore;
let target: LocalFilesystemBackupStore;
let targetRoot: string;
let artifact: BackupArtifact;
let restored: Awaited<ReturnType<typeof restoreLocalFilesystemArchive>>;
let result: Awaited<ReturnType<ReturnType<typeof backupRouter.createCaller>["create"]>>;
const report: Record<string, unknown> = { scope: "private-network-namespace-unix-socket-synthetic-only", mockedDriver: false };

function assertTarget() {
  const url = new URL(process.env.DATABASE_URL || "");
  const socket = url.searchParams.get("socketPath") || "";
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/geoportal_f4_driver" || !socket.startsWith("/tmp/atena-f4-driver.") || !socket.endsWith("/mysql.sock")) {
    throw new Error("F4 requires the disposable local MySQL socket and exact synthetic schema");
  }
  return socket;
}

function adminContext(): TrpcContext {
  return {
    user: { id: 1, openId: "f4-synthetic-admin", name: "F4 synthetic", email: "f4@example.invalid", role: "admin", loginMethod: "synthetic-test", mfaEnabled: false, mfaSecret: null, createdAt: fixed, updatedAt: fixed, lastSignedIn: fixed },
    req: { protocol: "http", headers: {}, ip: "127.0.0.1" } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

async function independentlyReadRows() {
  const tables: BackupRows = {};
  const fieldNames: Record<string, string[]> = {};
  for (const table of backupTableRegistry) {
    // Real mysql2 query with the date representation used by Drizzle rawQuery;
    // no synthetic row array and no change to the application's backup format.
    const [rows, fields] = await connection.query<RowDataPacket[]>({
      sql: `SELECT * FROM \`${table.name}\` ORDER BY \`${table.primaryKey}\``,
      typeCast(field, next) {
        return ["TIMESTAMP", "DATETIME", "DATE"].includes(field.type) ? field.string() : next();
      },
    });
    tables[table.name] = rows;
    fieldNames[table.name] = fields.map((field) => field.name).sort();
  }
  return { tables, fieldNames };
}

async function restoreIntoSeparateSyntheticSchema(tables: BackupRows) {
  // Test-only SQL restore, not a production restore implementation. Both schemas
  // are created/migrated by the disposable executor on the same Unix socket.
  const socketPath = assertTarget();
  const destination = await createConnection({ user: "root", socketPath, database: "geoportal_f4_restore", timezone: "Z" });
  try {
    for (const table of backupTableRegistry) {
      await destination.query(`DELETE FROM \`${table.name}\``);
      const [columns] = await destination.query<RowDataPacket[]>("SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.columns WHERE table_schema = ? AND table_name = ?", ["geoportal_f4_restore", table.name]);
      const types = new Map(columns.map((column) => [String(column.COLUMN_NAME), String(column.DATA_TYPE)]));
      for (const row of tables[table.name] || []) {
        const names = Object.keys(row);
        if (!names.every((name) => types.has(name))) throw new Error("Unexpected column in synthetic restore");
        const values = names.map((name) => {
          const value = row[name];
          if (value === null) return null;
          if (types.get(name) === "json") return JSON.stringify(value);
          if (types.get(name) === "timestamp" || types.get(name) === "datetime") return new Date(String(value));
          return value;
        });
        await destination.query(`INSERT INTO \`${table.name}\` (${names.map((name) => `\`${name}\``).join(",")}) VALUES (${names.map(() => "?").join(",")})`, values);
      }
    }
    const destinationDb = drizzle(destination);
    const after: BackupRows = {};
    for (const table of backupTableRegistry) {
      const [rows] = await destinationDb.execute(sql.raw(`SELECT * FROM \`${table.name}\` ORDER BY \`${table.primaryKey}\``));
      after[table.name] = rows as unknown as Array<Record<string, unknown>>;
    }
    return after;
  } finally { await destination.end(); }
}

describe.skipIf(!enabled)("F4 real Drizzle/mysql2 backup contract", () => {
  beforeAll(async () => {
    const socketPath = assertTarget();
    connection = await createConnection({ user: "root", socketPath, database: "geoportal_f4_driver", timezone: "Z" });
    database = (await getDb())!;
    expect(database).toBeTruthy();
    // Reset only the dedicated synthetic schemas; no production data exists.
    for (const table of [...backupTableRegistry].reverse()) await connection.query(`DELETE FROM \`${table.name}\``);
    await connection.query("INSERT INTO users (id,openId,name,email,role,createdAt,updatedAt,lastSignedIn) VALUES (1,'f4-synthetic-admin','F4 synthetic',NULL,'admin',?,?,?),(2,'f4-editor','Editor','editor@example.invalid','editor',?,?,?),(3,'f4-client','Client',NULL,'client',?,?,?)", Array(9).fill(fixed));
    await connection.query("INSERT INTO projects (id,name,code,description,aoiGeometry,aoiBounds,status,createdBy,createdAt,updatedAt) VALUES (101,'Projeto sintético α','F4-SYN-01',NULL,?,?,'active',1,?,?),(102,'Outro sintético','F4-SYN-02','NULL/text fidelity',NULL,NULL,'archived',1,?,?)", [JSON.stringify({ type: "Polygon", coordinates: [[[-47,-15],[-47.1,-15],[-47,-15.1],[-47,-15]]] }), JSON.stringify({ north:-15,south:-15.1,east:-47,west:-47.1 }),fixed,fixed,fixed,fixed]);
    const metadata = { synthetic: true, nested: { flags: ["application-data"], fields: { legitimate: true } }, nullable: null, count: 7 };
    for (const [offset, label] of ["kml", "geojson", "geotiff"].entries()) {
      await connection.query("INSERT INTO files (id,projectId,name,originalName,fileType,mimeType,fileSize,s3Key,s3Url,isGeospatial,metadata,uploadedBy,uploadedAt,updatedAt) VALUES (?,?,?, ?,?,NULL,?,?,?,1,?,1,?,?)", [201+offset,101,`Synthetic ${label}`,`synthetic.${label}`,label,32,`synthetic/f4/${label}.fixture`,`/synthetic/f4/${label}.fixture`,JSON.stringify(metadata),fixed,fixed]);
    }
    await connection.query("INSERT INTO file_versions (id,fileId,version,s3Key,s3Url,fileSize,sha256,mimeType,metadata,uploadedBy,uploadedAt) VALUES (301,201,1,'synthetic/f4/kml.fixture','/synthetic/f4/kml.fixture',32,NULL,NULL,?,1,?)", [JSON.stringify({ synthetic: true, fileType: "kml" }),fixed]);
    await connection.query("INSERT INTO saved_maps (id,projectId,name,viewMode,center,zoom,heading,pitch,activeLayers,createdBy,createdAt,updatedAt) VALUES (401,101,'Mapa sintético','2d',?,'12.345678','90.000001',NULL,?,1,?,?)", [JSON.stringify({ lat:-15,lon:-47 }),JSON.stringify([]),fixed,fixed]);
    const sourceRoot = await mkdtemp(path.join(tmpdir(), "atena-f4-source-"));
    targetRoot = await mkdtemp(path.join(tmpdir(), "atena-f4-archive-"));
    roots.push(sourceRoot, targetRoot);
    source = new LocalFilesystemBackupStore(sourceRoot);
    target = new LocalFilesystemBackupStore(targetRoot);
    for (const label of ["kml", "geojson", "geotiff"]) await source.put(`synthetic/f4/${label}.fixture`, Buffer.from(`F4 synthetic bytes only: ${label}; NOT A COG`, "utf8"));
    vi.stubEnv("ARQUEO_BACKUP_STORE", "filesystem");
    vi.stubEnv("ARQUEO_BACKUP_SOURCE_FILESYSTEM_ROOT", sourceRoot);
    vi.stubEnv("ARQUEO_BACKUP_FILESYSTEM_ROOT", targetRoot);
    const [version] = await connection.query<RowDataPacket[]>("SELECT VERSION() AS version");
    report.engine = version[0].version;
    report.timestampRepresentation = "Drizzle raw typeCast SQL string -> JSON preserves string -> SQL restore -> same Drizzle string";
    report.blobs = "generic synthetic fixture bytes; no assertion of valid GeoTIFF/COG";
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (connection) await connection.end();
    for (const root of roots) await rm(root, { recursive: true, force: true });
    const directory = process.env.F4_EVIDENCE_DIR;
    if (directory) {
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "driver-contract-report.json"), JSON.stringify(report, null, 2) + "\n");
    }
  });

  it("observes actual execute tuple, fields and row types, and reproduces the legacy extraction", async () => {
    const raw = await database.execute(sql.raw("SELECT * FROM files ORDER BY id"));
    const [rows, fields] = raw;
    expect(raw).toHaveLength(2);
    expect(Array.isArray(rows)).toBe(true);
    expect(Array.isArray(fields)).toBe(true);
    expect((rows as unknown[]).length).toBe(3);
    expect(fields.some((field) => field.name === "fileType")).toBe(true);
    const first = (rows as unknown as Array<Record<string, unknown>>)[0];
    expect(typeof first.id).toBe("number");
    expect(first.fileType).toBe("kml");
    expect(first.mimeType).toBeNull();
    expect(first.metadata).toMatchObject({ nested: { fields: { legitimate: true } } });
    expect(first.uploadedAt).toBe("2026-01-02 03:04:05");
    const legacy = Array.isArray(raw) ? raw : (raw as any)[0] || [];
    expect(legacy).toHaveLength(2);
    expect(Array.isArray(legacy[0])).toBe(true);
    report.driverTuple = { elements: raw.length, realRows: (rows as unknown[]).length, fieldPackets: fields.length, legacyReportedRows: legacy.length, legacyFirstEntryIsArray: true, timestampIsSqlString: true, enumIsLabel: true, jsonIsObject: true };
  });

  it("backs up real SQL rows through the actual router, with exact counts and no driver fields", async () => {
    const expected = await independentlyReadRows();
    const before = buildBackupArtifact(expected.tables, { backupId: "f4-independent-baseline", createdAt: fixed.toISOString() });
    result = await backupRouter.createCaller(adminContext()).create({ description: "F4 synthetic driver integration" });
    expect(result.recoverable).toBe(true);
    const bytes = await readFile(path.join(targetRoot, "backups", result.backupId, "artifact.json"));
    artifact = JSON.parse(bytes.toString("utf8")) as BackupArtifact;
    expect(verifyBackupArtifact(artifact)).toEqual({ valid: true, errors: [] });
    expect(artifact.manifest.totals.rows).toBe(before.manifest.totals.rows);
    for (const table of backupTableRegistry) {
      const actualRows = artifact.tables[table.name] || [];
      expect(actualRows.length, table.name).toBe((expected.tables[table.name] || []).length);
      for (const row of actualRows) {
        expect(Array.isArray(row), table.name).toBe(false);
        expect(Object.keys(row).sort(), table.name).toEqual(expected.fieldNames[table.name]);
      }
    }
    expect(artifact.manifest.tables).toEqual(before.manifest.tables);
    expect(artifact.manifest.integrity.payloadSha256).toBe(before.manifest.integrity.payloadSha256);
    expect(artifact.tables.files?.map((file) => file.fileType)).toEqual(["kml", "geojson", "geotiff"]);
    expect(artifact.tables.saved_maps?.[0].zoom).toBe("12.345678");
    expect(artifact.tables.saved_maps?.[0].pitch).toBeNull();
    expect(artifact.tables.files?.[0].uploadedAt).toBe("2026-01-02 03:04:05");
    expect(artifact.tables.files?.[0].metadata).toMatchObject({ nested: { fields: { legitimate: true } } });
    report.export = { tables: artifact.manifest.tables, totalRecords: artifact.manifest.totals.rows, payloadSha256: artifact.manifest.integrity.payloadSha256, artifactSha256: sha256Buffer(bytes), driverFieldsIncluded: false, emptyTablesCorrect: true, typesPreserved: ["integer", "enum-label", "JSON-object", "NULL", "DECIMAL-string", "timestamp-SQL-string-by-Drizzle"] };
  });

  it("restores archive bytes and all tabular hashes to memory and a different synthetic SQL schema", async () => {
    expect(artifact, "requires the successful router backup case").toBeTruthy();
    restored = await restoreLocalFilesystemArchive({ backupId: result.backupId, store: target });
    expect(restored.tables).toEqual(artifact.tables);
    expect(restored.objects).toHaveLength(3);
    for (const object of restored.objects) {
      const original = await source.get(object.logicalKey);
      expect(sha256Buffer(object.bytes)).toBe(original?.head.sha256);
    }
    const sqlRestored = await restoreIntoSeparateSyntheticSchema(restored.tables);
    const after = buildBackupArtifact(sqlRestored, { backupId: artifact.manifest.backupId, createdAt: artifact.manifest.createdAt });
    expect(after.manifest.tables).toEqual(artifact.manifest.tables);
    expect(after.manifest.integrity.payloadSha256).toBe(artifact.manifest.integrity.payloadSha256);
    const file = sqlRestored.files?.[0];
    expect(typeof file?.id).toBe("number");
    expect(file?.fileType).toBe("kml");
    expect(file?.mimeType).toBeNull();
    expect(file?.uploadedAt).toBe("2026-01-02 03:04:05");
    expect(file?.metadata).toMatchObject({ nested: { fields: { legitimate: true } } });
    expect(sqlRestored.saved_maps?.[0].zoom).toBe("12.345678");
    expect((await backupRouter.createCaller(adminContext()).verifyRestore({ backupId: result.backupId })).success).toBe(true);
    report.restore = { memoryRoundtrip: true, sqlDestination: "geoportal_f4_restore (same private Unix socket, different schema)", perTableHashesMatch: true, payloadSha256: after.manifest.integrity.payloadSha256, restoredObjects: restored.objects.length, allObjectHashesMatch: true, timestampIsSameSqlStringAfterSQL: true, driverFieldsIncluded: false, routerVerifyRestore: true };
  });
});
