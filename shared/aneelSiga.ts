export const ANEEL_SIGA_ENDPOINT = "https://dadosabertos.aneel.gov.br/api/3/action/datastore_search";
export const ANEEL_SIGA_RESOURCE_ID = "2f65a1b0-19b8-4360-8238-b34ab4693d55";
export const ANEEL_SIGA_SOURCE_URL = "https://dadosabertos.aneel.gov.br/dataset/siga-sistema-de-informacoes-de-geracao-da-aneel";
export const ANEEL_SIGA_ATTRIBUTION = "Fonte: ANEEL — SIGA";
export const ANEEL_SIGA_GEO_NOTICE = "Coordenadas de centróides aproximados; datum/EPSG não declarado. Não utilizado como camada cartográfica ou para interseção territorial.";
export const ANEEL_SIGA_UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"] as const;
export interface AneelSigaInput { offset?: number; limit?: number; uf?: string }
export interface AneelSigaRecord {
  recordId: number;
  name: string;
  ceg: string | null;
  uf: string | null;
  generationType: string | null;
  phase: string | null;
  awardType: string | null;
  generatedAt: string | null;
  authorizedPowerKw: number | null;
  monitoredPowerKw: number | null;
  centroid: { latitude: number | null; longitude: number | null; crs: null; approximate: true };
}
export interface AneelSigaPage {
  source: "ANEEL";
  dataset: "SIGA diário";
  attribution: string;
  license: "ODbL";
  sourceUrl: string;
  resourceId: string;
  queriedAt: string;
  totalRecords: number;
  offset: number;
  limit: number;
  hasNext: boolean;
  rows: AneelSigaRecord[];
  geoNotice: string;
  preciseMapAvailable: false;
}
