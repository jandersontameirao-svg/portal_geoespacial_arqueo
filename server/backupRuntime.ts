import path from "node:path";
import { LocalFilesystemBackupStore } from "./localFilesystemBackupStore";
import type { BackupStore } from "./backupStore";

export type BackupRuntimeAvailability = {
  available: boolean;
  mode: "isolated-rehearsal" | "unconfigured" | "filesystem";
  reason: string;
  requiredCapabilities: string[];
};

export type RecoverableBackupRuntime = BackupRuntimeAvailability & {
  available: true;
  mode: "filesystem";
  source: BackupStore;
  target: BackupStore;
  sourceRoot: string;
  targetRoot: string;
};

export type UnavailableBackupRuntime = BackupRuntimeAvailability & { available: false };

/** Informação segura para UI/tRPC: nunca expõe stores nem caminhos do host. */
export function publicBackupAvailability(runtime: RecoverableBackupRuntime | UnavailableBackupRuntime): BackupRuntimeAvailability {
  return {
    available: runtime.available,
    mode: runtime.mode,
    reason: runtime.reason,
    requiredCapabilities: runtime.requiredCapabilities,
  };
}

/**
 * Seleciona explicitamente a capacidade de backup recuperável.
 *
 * - Sem configuração, o produto preserva o contrato de backup, mas informa que
 *   não pode prometer recuperação de blobs.
 * - No modo de ensaio isolado, essa indisponibilidade é intencional.
 * - Em servidor on-premise, ARQUEO_BACKUP_STORE=filesystem conecta um root
 *   persistente que implementa put/get/head/list por chave estável.
 */
export function getRecoverableBackupRuntime(environment = process.env): RecoverableBackupRuntime | UnavailableBackupRuntime {
  const rehearsal = environment.ARQUEO_EXECUTION_MODE === "isolated-rehearsal";
  const configuredStore = environment.ARQUEO_BACKUP_STORE;
  const sourceRoot = environment.ARQUEO_BACKUP_SOURCE_FILESYSTEM_ROOT;
  const targetRoot = environment.ARQUEO_BACKUP_FILESYSTEM_ROOT;
  if (configuredStore === "filesystem" && sourceRoot && targetRoot && path.isAbsolute(sourceRoot) && path.isAbsolute(targetRoot)) {
    const resolvedSourceRoot = path.resolve(sourceRoot);
    const resolvedTargetRoot = path.resolve(targetRoot);
    return {
      available: true,
      mode: "filesystem",
      source: new LocalFilesystemBackupStore(resolvedSourceRoot),
      target: new LocalFilesystemBackupStore(resolvedTargetRoot),
      sourceRoot: resolvedSourceRoot,
      targetRoot: resolvedTargetRoot,
      reason: "Adaptador filesystem recuperável configurado; a execução ainda exige banco disponível e leitura dos blobs fonte.",
      requiredCapabilities: ["put", "get", "head", "list", "filesystem fonte e destino persistentes", "controle de acesso do host"],
    };
  }
  if (rehearsal) {
    return {
      available: false,
      mode: "isolated-rehearsal",
      reason: "Backup recuperável indisponível no ambiente de ensaio isolado: nenhum storage de produção é conectado por desenho.",
      requiredCapabilities: ["adaptador privado com put/get/head/list", "volume persistente", "banco de homologação ou produção autorizado"],
    };
  }
  return {
    available: false,
    mode: "unconfigured",
    reason: "Backup recuperável indisponível: configure um adaptador privado com put/get/head/list. storage.ts atual não fornece recuperação de blobs por chave estável.",
    requiredCapabilities: ["adaptador privado com put/get/head/list", "versionamento/retenção", "credenciais de servidor", "restauração ensaiada"],
  };
}
