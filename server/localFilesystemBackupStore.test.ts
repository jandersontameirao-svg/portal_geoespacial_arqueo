import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BackupConflictError, BackupKeyError } from "./backupStore";
import { LocalFilesystemBackupStore } from "./localFilesystemBackupStore";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
async function createTestStore() {
  const root = await mkdtemp(path.join(tmpdir(), "arqueo-store-test-"));
  roots.push(root);
  return { root, store: new LocalFilesystemBackupStore(root) };
}

describe("LocalFilesystemBackupStore", () => {
  it("persiste bytes binários, informa hash e lista de forma determinística", async () => {
    const { store } = await createTestStore();
    const body = Buffer.from([0, 255, 1, 2, 3, 0]);
    const head = await store.put("backups/a/objects/blob.bin", body);
    const loaded = await store.get("backups/a/objects/blob.bin");
    expect(loaded?.body.equals(body)).toBe(true);
    expect(loaded?.head).toEqual(head);
    await store.put("backups/a/manifest.json", "{}\n");
    expect((await store.list("backups/a")).map((item) => item.key)).toEqual(["backups/a/manifest.json", "backups/a/objects/blob.bin"]);
  });

  it("é idempotente para mesmos bytes e recusa sobrescrita diferente", async () => {
    const { store } = await createTestStore();
    const first = await store.put("backups/a/artifact.json", "primeiro");
    expect(await store.put("backups/a/artifact.json", "primeiro")).toEqual(first);
    await expect(store.put("backups/a/artifact.json", "segundo")).rejects.toBeInstanceOf(BackupConflictError);
  });

  it("bloqueia traversal, caminhos absolutos e barras Windows", async () => {
    const { store } = await createTestStore();
    for (const key of ["../escape", "/tmp/escape", "backups/../../escape", "backups\\escape", ""])
      await expect(store.put(key, "x")).rejects.toBeInstanceOf(BackupKeyError);
  });

  it("não confia em metadata: head recalcula hash após corrupção externa", async () => {
    const { root, store } = await createTestStore();
    const before = await store.put("backups/a/object.bin", "original");
    await writeFile(path.join(root, "backups", "a", "object.bin"), "alterado");
    const after = await store.head("backups/a/object.bin");
    expect(after?.sha256).not.toBe(before.sha256);
    expect((await readFile(path.join(root, "backups", "a", "object.bin"))).toString()).toBe("alterado");
  });
});
