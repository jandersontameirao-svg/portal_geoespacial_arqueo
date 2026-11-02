import { describe, expect, it } from "vitest";
import { getRecoverableBackupRuntime, publicBackupAvailability } from "./backupRuntime";

describe("runtime de backup recuperável", () => {
  it("declara indisponibilidade explícita no ensaio isolado", () => {
    const runtime = getRecoverableBackupRuntime({ ARQUEO_EXECUTION_MODE: "isolated-rehearsal" } as NodeJS.ProcessEnv);
    expect(runtime).toMatchObject({ available: false, mode: "isolated-rehearsal" });
    expect(runtime.reason).toContain("ensaio isolado");
  });

  it("não habilita filesystem sem as duas raízes absolutas", () => {
    const runtime = getRecoverableBackupRuntime({ ARQUEO_BACKUP_STORE: "filesystem", ARQUEO_BACKUP_FILESYSTEM_ROOT: "/backups" } as NodeJS.ProcessEnv);
    expect(runtime).toMatchObject({ available: false, mode: "unconfigured" });
  });

  it("habilita o adaptador apenas com origem e destino explícitos", () => {
    const runtime = getRecoverableBackupRuntime({ ARQUEO_BACKUP_STORE: "filesystem", ARQUEO_BACKUP_SOURCE_FILESYSTEM_ROOT: "/var/lib/arqueo/files", ARQUEO_BACKUP_FILESYSTEM_ROOT: "/var/lib/arqueo/backups" } as NodeJS.ProcessEnv);
    expect(runtime).toMatchObject({ available: true, mode: "filesystem", sourceRoot: "/var/lib/arqueo/files", targetRoot: "/var/lib/arqueo/backups" });
    expect(publicBackupAvailability(runtime)).toEqual(expect.objectContaining({ available: true, mode: "filesystem" }));
    expect(publicBackupAvailability(runtime)).not.toHaveProperty("sourceRoot");
    expect(publicBackupAvailability(runtime)).not.toHaveProperty("source");
  });
});
