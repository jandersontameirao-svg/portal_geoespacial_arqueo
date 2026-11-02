import { describe, expect, it, vi } from "vitest";
import { extractMysql2SelectRows, snapshotRegisteredTables } from "./backupTableSnapshot";
import { backupTableRegistry } from "./backupTableRegistry";

describe("strict mysql2 SELECT extraction (pure guards, not driver integration)", () => {
  it("returns only rows, preserving references and application fields metadata", () => {
    const rows = [{ id: 1, fileType: "geotiff", metadata: { fields: { application: true } }, nullable: null }];
    const fields = [{ name: "id", columnLength: 11, orgTable: "files" }];
    const extracted = extractMysql2SelectRows([rows, fields]);
    expect(extracted).toBe(rows);
    expect(extracted[0].metadata).toEqual({ fields: { application: true } });
    expect(extracted).not.toContain(fields);
  });
  it("accepts empty SELECT rows without treating fields as a row", () => {
    expect(extractMysql2SelectRows([[], [{ name: "id" }]])).toEqual([]);
  });
  it("rejects headers from non-SELECT results", () => {
    expect(() => extractMysql2SelectRows([{ affectedRows: 1 }, []])).toThrow("esperado [rows, fields]");
  });
  it("rejects direct row arrays instead of guessing a different driver", () => {
    expect(() => extractMysql2SelectRows([{ id: 1 }, { id: 2 }])).toThrow();
  });
  it("rejects absent, malformed or extra envelopes", () => {
    for (const value of [null, undefined, {}, [], [[]], [[], null], [[], [], []]]) expect(() => extractMysql2SelectRows(value)).toThrow();
  });
  it("rejects nested multi-results, scalar rows and non-record row values", () => {
    for (const row of [[], 1, "scalar", null, new Date(), Buffer.from("metadata")]) expect(() => extractMysql2SelectRows([[row], []])).toThrow("rows deve conter registros");
  });
  it("iterates the exact registry and accepts empty registered tables", async () => {
    const execute = vi.fn(async () => [[], []]);
    const tables = await snapshotRegisteredTables({ execute } as unknown as Parameters<typeof snapshotRegisteredTables>[0]);
    expect(Object.keys(tables)).toEqual(backupTableRegistry.map((table) => table.name));
    expect(execute).toHaveBeenCalledTimes(backupTableRegistry.length);
  });
  it("aborts on unexpected result rather than emitting a silent empty backup", async () => {
    const execute = vi.fn(async () => ({ unexpected: true }));
    await expect(snapshotRegisteredTables({ execute } as unknown as Parameters<typeof snapshotRegisteredTables>[0])).rejects.toThrow("Snapshot abortado");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
