/** Registry fixo: candidatos não equivalem a serviços aprovados. Nunca recebe URLs do cliente. */
export const INSTITUTIONAL_PUBLISHERS = ["IPHAN", "FUNAI", "INCRA"] as const;
export type InstitutionalPublisher = (typeof INSTITUTIONAL_PUBLISHERS)[number];
export type InstitutionalProtocol = "wms" | "wfs";
export type InstitutionalBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};
export const INSTITUTIONAL_MAX_BYTES = 4 * 1024 * 1024;
export const INSTITUTIONAL_TIMEOUT_MS = 10_000;
export const INSTITUTIONAL_REMOTE_ONLY_MESSAGE =
  "Fonte institucional somente para consulta remota: não importar nem persistir feições. Use institutionalCatalog.queryViewport.";
export type InstitutionalSource = {
  publisher: InstitutionalPublisher;
  label: string;
  title: string;
  edition: string;
  presetId: string;
  stableTheme: string;
  attribution: string;
  sourceCrs: "EPSG:4674" | "EPSG:4326";
  remoteLayer: string | null;
  disabled: boolean;
  blocker: string | null;
  /** Somente preencher após prova positiva, com bbox pequeno contendo feições. */
  probeBounds: InstitutionalBounds | null;
  provenance: readonly string[];
  protocols: Partial<
    Record<
      InstitutionalProtocol,
      {
        endpoint: string;
        version: "1.1.1" | "1.0.0" | "2.0.0";
        verified: boolean;
        axisOrder: "longitude,latitude";
        bboxAxisOrder?: "longitude,latitude" | "latitude,longitude";
        bboxCrs?: "EPSG:4326" | "EPSG:4674" | "urn:ogc:def:crs:EPSG::4674";
        displayCrs: "EPSG:4674" | "EPSG:4326" | "EPSG:3857";
      }
    >
  >;
};
export const INSTITUTIONAL_SOURCES: readonly InstitutionalSource[] = [
  {
    publisher: "IPHAN",
    label: "IPHAN",
    title: "Proteção — Bens Materiais (SICG/IPHAN)",
    edition: "Edição não comprovada",
    presetId: "iphan-bens-protegidos-v1",
    stableTheme: "bens-protegidos",
    attribution: "Fonte: IPHAN",
    sourceCrs: "EPSG:4674",
    remoteLayer: "SICG:Bem_Protecao",
    disabled: false,
    blocker: null,
    probeBounds: { west: -35.05, south: -8.15, east: -34.8, north: -7.9 },
    provenance: [
      "IPHAN_VALIDACAO.json (2026-11-02; T05–T08)",
      "https://geoserver.iphan.gov.br/geoserver",
      "https://sicg.iphan.gov.br/sicg/manual/resultadosAnalises_bem.html",
    ],
    protocols: {
      wms: {
        endpoint: "https://geoserver.iphan.gov.br/geoserver/wms",
        version: "1.1.1",
        verified: true,
        axisOrder: "longitude,latitude",
        displayCrs: "EPSG:3857",
      },
      wfs: {
        endpoint: "https://geoserver.iphan.gov.br/geoserver/ows",
        version: "2.0.0",
        verified: true,
        axisOrder: "longitude,latitude",
        bboxAxisOrder: "latitude,longitude",
        bboxCrs: "urn:ogc:def:crs:EPSG::4674",
        displayCrs: "EPSG:4674",
      },
    },
  },
  {
    publisher: "FUNAI",
    label: "FUNAI",
    title: "Terras indígenas — FUNAI",
    edition: "Edição não comprovada",
    presetId: "funai-terras-indigenas-v1",
    stableTheme: "terras-indigenas",
    attribution: "Fonte: FUNAI",
    sourceCrs: "EPSG:4326",
    remoteLayer: "Funai:tis_poligonais",
    disabled: true,
    blocker:
      "TLS estrito falhou: UNABLE_TO_VERIFY_LEAF_SIGNATURE em capabilities WMS, GetMap e WFS 1.0.0; cadeia de certificados não verificável",
    probeBounds: null,
    provenance: [
      "FUNAI_VALIDACAO.json (2026-11-02)",
      "https://www.gov.br/funai/pt-br/atuacao/terras-indigenas/geoprocessamento-e-mapas",
    ],
    protocols: {
      wms: {
        endpoint: "https://geoserver.funai.gov.br/geoserver/Funai/ows",
        version: "1.1.1",
        verified: false,
        axisOrder: "longitude,latitude",
        displayCrs: "EPSG:3857",
      },
      wfs: {
        endpoint: "https://geoserver.funai.gov.br/geoserver/Funai/ows",
        version: "1.0.0",
        verified: false,
        axisOrder: "longitude,latitude",
        displayCrs: "EPSG:4326",
      },
    },
  },
  {
    publisher: "INCRA",
    label: "INCRA",
    title: "Territórios quilombolas — INCRA",
    edition: "Edição não comprovada",
    presetId: "incra-territorios-quilombolas-v1",
    stableTheme: "territorios-quilombolas",
    attribution: "Fonte: INCRA",
    sourceCrs: "EPSG:4674",
    remoteLayer: null,
    disabled: true,
    blocker:
      "INCRA legado com ENOTFOUND; workspace candidato INDE 404/sem tipos; WMS/WFS Ibama bloqueados HTTP 403; nenhuma camada OGC comprovada",
    probeBounds: null,
    provenance: [
      "INCRA_VALIDACAO.json (2026-11-02)",
      "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/quilombolas",
    ],
    protocols: {},
  },
];
export function getInstitutionalSource(
  publisher: InstitutionalPublisher
): InstitutionalSource {
  const source = INSTITUTIONAL_SOURCES.find(s => s.publisher === publisher);
  if (!source) throw new Error("Órgão fora do registry institucional");
  return source;
}
export const getInstitutionalPreset = getInstitutionalSource;
export function institutionalLogicalLayer(
  source: InstitutionalSource,
  type: InstitutionalProtocol
) {
  return `${source.publisher.toLowerCase()}:${source.stableTheme}:${type}`;
}
export function eligibleInstitutionalProtocols(
  source: InstitutionalSource
): InstitutionalProtocol[] {
  if (
    source.disabled ||
    !source.remoteLayer ||
    !source.probeBounds ||
    !source.provenance.length
  )
    return [];
  return (["wms", "wfs"] as const).filter(
    type => source.protocols[type]?.verified === true
  );
}
