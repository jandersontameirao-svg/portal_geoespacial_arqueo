import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import type { getDb } from "./db";
import { backupTableRegistry } from "./backupTableRegistry";
import type { BackupRows } from "./backupManifest";

type SnapshotDatabase = Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "execute">;

/**
 * Drizzle/mysql2 raw SELECT resolves [RowDataPacket[], FieldPacket[]], not rows.
 * Keep row values untouched: ENUM labels, SQL timestamp strings, DECIMAL strings,
 * JSON, NULL and numbers retain the driver's representation. Unknown envelopes
 * fail closed; never turn an export failure into an apparently empty table.
 */
export function extractMysql2SelectRows(result: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(result) || result.length !== 2 || !Array.isArray(result[0]) || !Array.isArray(result[1])) {
    throw new Error("Contrato inesperado de SELECT Drizzle/mysql2: esperado [rows, fields]");
  }
  const rows: unknown[] = result[0];
  if (rows.some((row) => row === null || typeof row !== "object" || Array.isArray(row) || row instanceof Date || Buffer.isBuffer(row))) {
    throw new Error("Contrato inesperado de SELECT Drizzle/mysql2: rows deve conter registros, não arrays ou metadados");
  }
  return rows as Array<Record<string, unknown>>;
}

/** Only versioned physical table names are accepted, never request input. */
export async function snapshotRegisteredTables(database: SnapshotDatabase): Promise<BackupRows> {
  const backupData: BackupRows = {};
  for (const table of backupTableRegistry) {
    try {
      const result = await database.execute(sql.raw(`SELECT * FROM \`${table.name}\` ORDER BY \`${table.primaryKey}\``));
      backupData[table.name] = extractMysql2SelectRows(result);
    } catch (error) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Snapshot abortado: não foi possível exportar ${table.name}`, cause: error });
    }
  }
  return backupData;
}
