import { describe, expect, it } from "vitest";
import {
  ANEEL_SIGA_UFS,
  type AneelSigaPage,
  type AneelSigaRecord,
} from "@shared/aneelSiga";
import {
  ANEEL_SIGA_ALL_UFS,
  aneelSigaGeneratedDates,
  aneelSigaInput,
  aneelSigaPower,
  aneelSigaQueriedAt,
  aneelSigaStatus,
  isAneelSigaUfFilter,
} from "./aneelSigaPresentation";

// Synthetic fixtures only: these records are never imported by the UI.
const record: AneelSigaRecord = {
  recordId: 1,
  name: "Registro de teste",
  ceg: "CEG-TESTE",
  uf: "DF",
  generationType: null,
  phase: null,
  awardType: null,
  generatedAt: "2026-01-02",
  authorizedPowerKw: 100,
  monitoredPowerKw: null,
  centroid: { latitude: null, longitude: null, crs: null, approximate: true },
};
const page: AneelSigaPage = {
  source: "ANEEL",
  dataset: "SIGA diário",
  attribution: "Fonte: ANEEL — SIGA",
  license: "ODbL",
  sourceUrl: "https://example.test",
  resourceId: "fixture",
  queriedAt: "2026-01-03T00:00:00Z",
  totalRecords: 3,
  offset: 0,
  limit: 20,
  hasNext: false,
  rows: [
    record,
    { ...record, recordId: 2 },
    { ...record, recordId: 3, generatedAt: null },
  ],
  geoNotice: "fixture",
  preciseMapAvailable: false,
};

describe("ANEEL SIGA — apresentação sem consulta remota", () => {
  it("aceita somente todas as UFs ou as 27 siglas oficiais", () => {
    expect(ANEEL_SIGA_UFS).toHaveLength(27);
    expect(isAneelSigaUfFilter(ANEEL_SIGA_ALL_UFS)).toBe(true);
    for (const uf of ANEEL_SIGA_UFS) expect(isAneelSigaUfFilter(uf)).toBe(true);
    for (const value of [
      "",
      "df",
      "ZZ",
      "DF,GO",
      "all ",
      "https://example.test",
    ])
      expect(isAneelSigaUfFilter(value)).toBe(false);
  });

  it("envia páginas de 20 registros sem filtro UF quando todas são selecionadas", () => {
    expect(aneelSigaInput(ANEEL_SIGA_ALL_UFS, 0)).toEqual({
      offset: 0,
      limit: 20,
    });
    expect(aneelSigaInput("DF", 40)).toEqual({
      offset: 40,
      limit: 20,
      uf: "DF",
    });
  });

  it("não infere datas de geração a partir do horário da consulta", () => {
    expect(aneelSigaGeneratedDates(page)).toEqual(["2026-01-02"]);
    expect(aneelSigaGeneratedDates({ ...page, rows: [] })).toEqual([]);
    expect(
      aneelSigaGeneratedDates({
        ...page,
        rows: [{ ...record, generatedAt: null }],
      })
    ).toEqual([]);
  });

  it("preserva registros duplicados e não agrega sua potência", () => {
    const before = structuredClone(page);
    aneelSigaGeneratedDates(page);
    expect(page).toEqual(before);
    expect(page.rows).toHaveLength(3);
    expect(aneelSigaPower(record.authorizedPowerKw)).toBe("100");
  });

  it("distingue potência zero de potência ausente e rejeita não finitos", () => {
    expect(aneelSigaPower(0)).toBe("0");
    expect(aneelSigaPower(1234.5)).toBe("1.234,5");
    for (const value of [null, Number.NaN, Number.POSITIVE_INFINITY])
      expect(aneelSigaPower(value)).toBe("—");
  });

  it("não inventa horário de consulta quando o texto recebido não é uma data", () => {
    expect(aneelSigaQueriedAt("não declarado")).toBe("não declarado");
    expect(aneelSigaQueriedAt(page.queriedAt)).toBe(
      new Date(page.queriedAt).toLocaleString("pt-BR")
    );
  });

  it("a abertura da seleção continua manual mesmo se existir cache", () => {
    const result = aneelSigaStatus({
      requested: false,
      fetching: false,
      failed: false,
      hasPreviousPage: true,
    });
    expect(result.message).toContain("nenhum dado ANEEL foi solicitado");
    expect(result.oldData).toBe(false);
    expect(result.message).not.toContain("concluída");
  });

  it("uma falha inicial nunca é apresentada como consulta concluída", () => {
    const result = aneelSigaStatus({
      requested: true,
      fetching: false,
      failed: true,
      hasPreviousPage: false,
    });
    expect(result.message).toContain("Falha na consulta");
    expect(result.message).toContain("Nenhum resultado confirmado");
    expect(result.oldData).toBe(false);
    expect(result.message).not.toMatch(/concluída|pront[oa]/i);
  });

  it("uma falha na atualização mantém os dados explicitamente antigos e não atualizados", () => {
    const result = aneelSigaStatus({
      requested: true,
      fetching: false,
      failed: true,
      hasPreviousPage: true,
    });
    expect(result.message).toContain("Falha ao atualizar");
    expect(result.message).toContain("Dados antigos");
    expect(result.message).toContain("não foram atualizados");
    expect(result.oldData).toBe(true);
    expect(result.message).not.toMatch(/concluída|pront[oa]/i);
  });

  it("não antecipa sucesso enquanto há atualização em andamento", () => {
    const result = aneelSigaStatus({
      requested: true,
      fetching: true,
      failed: false,
      hasPreviousPage: true,
    });
    expect(result.oldData).toBe(true);
    expect(result.message).toContain("ainda não foram atualizados");
    expect(result.message).not.toContain("concluída");
  });

  it("só declara conclusão com dados e sem falha ou carregamento", () => {
    expect(
      aneelSigaStatus({
        requested: true,
        fetching: false,
        failed: false,
        hasPreviousPage: true,
      })
    ).toEqual({
      message: "Consulta concluída.",
      oldData: false,
    });
    expect(
      aneelSigaStatus({
        requested: true,
        fetching: false,
        failed: false,
        hasPreviousPage: false,
      }).message
    ).not.toContain("concluída");
  });
});
