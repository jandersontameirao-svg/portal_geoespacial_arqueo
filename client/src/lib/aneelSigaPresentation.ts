import {
  ANEEL_SIGA_UFS,
  type AneelSigaInput,
  type AneelSigaPage,
} from "@shared/aneelSiga";

export const ANEEL_SIGA_PAGE_SIZE = 20;
export const ANEEL_SIGA_ALL_UFS = "all";
export type AneelSigaUf = (typeof ANEEL_SIGA_UFS)[number];
export type AneelSigaUfFilter = AneelSigaUf | typeof ANEEL_SIGA_ALL_UFS;

export function isAneelSigaUfFilter(value: string): value is AneelSigaUfFilter {
  return (
    value === ANEEL_SIGA_ALL_UFS || ANEEL_SIGA_UFS.some(uf => uf === value)
  );
}

export function aneelSigaInput(
  uf: AneelSigaUfFilter,
  offset: number
): Omit<AneelSigaInput, "uf"> & { uf?: AneelSigaUf } {
  return {
    offset,
    limit: ANEEL_SIGA_PAGE_SIZE,
    ...(uf === ANEEL_SIGA_ALL_UFS ? {} : { uf }),
  };
}

/** Dates are provenance returned by this page, not a client-side freshness estimate. */
export function aneelSigaGeneratedDates(page: AneelSigaPage): string[] {
  return Array.from(
    new Set(
      page.rows.flatMap(row => (row.generatedAt ? [row.generatedAt] : []))
    )
  );
}

export function aneelSigaPower(value: number | null): string {
  return value !== null && Number.isFinite(value)
    ? value.toLocaleString("pt-BR", { maximumFractionDigits: 3 })
    : "—";
}

export function aneelSigaQueriedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR");
}

export function aneelSigaStatus({
  requested,
  fetching,
  failed,
  hasPreviousPage,
}: {
  requested: boolean;
  fetching: boolean;
  failed: boolean;
  hasPreviousPage: boolean;
}): { message: string; oldData: boolean } {
  if (!requested) {
    return {
      message:
        "Consulta manual: nenhum dado ANEEL foi solicitado nesta seleção.",
      oldData: false,
    };
  }
  if (fetching) {
    return {
      message: hasPreviousPage
        ? "Consultando ANEEL… os dados anteriores ainda não foram atualizados."
        : "Consultando ANEEL…",
      oldData: hasPreviousPage,
    };
  }
  if (failed) {
    return {
      message: hasPreviousPage
        ? "Falha ao atualizar os dados ANEEL. Dados antigos da última consulta bem-sucedida; não foram atualizados."
        : "Falha na consulta ANEEL. Nenhum resultado confirmado para esta seleção.",
      oldData: hasPreviousPage,
    };
  }
  return {
    message: hasPreviousPage
      ? "Consulta concluída."
      : "Aguardando o resultado da consulta.",
    oldData: false,
  };
}
