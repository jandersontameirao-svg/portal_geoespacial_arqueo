import { REMOTE_CONNECTIONS } from "./remote-contracts";
import type { RemoteConnection } from "./remote-types";

export type OfficialState =
  | "OPERACIONAL"
  | "PARCIAL"
  | "RESTRITA"
  | "INDISPONÍVEL"
  | "NÃO INTEGRADA";

export type OfficialGeometryMode = "vector" | "image" | "tabular" | "none";

export interface OfficialRecord {
  id: string;
  institution: string;
  state: OfficialState;
  serviceUrl?: string;
  layerName?: string;
  serviceType: string;
  license: string;
  version: string;
  crs: string;
  attributeNames: string[];
  geometryMode: OfficialGeometryMode;
  queryable: boolean;
  localGeoJsonPath?: string;
  wmsUrl?: string;
  wmsLayer?: string;
  wmsVersion?: string;
  attribution?: string;
  remote?: RemoteConnection;
  provenanceFile: string;
  restriction: string;
}

/**
 * V3 source-of-truth. URLs are copied from the validated review artifacts and
 * are intentionally not accepted from request input. A source remains PARCIAL
 * until the application has a confirmed, licensed and bounded integration.
 */
export const OFFICIAL_RECORDS: readonly OfficialRecord[] = [
  {
    id: "funai-terras-indigenas-wfs",
    institution: "Fundação Nacional dos Povos Indígenas (FUNAI)",
    state: "PARCIAL",
    serviceUrl: "https://geoserver.funai.gov.br/geoserver/Funai/ows?service=WFS&version=1.0.0&request=GetCapabilities",
    layerName: "Funai:tis_poligonais",
    serviceType: "WFS 1.0.0",
    license: "Reprodução com atribuição declarada na fonte; licença aberta específica não confirmada.",
    version: "WFS 1.0.0; página oficial modificada em 2026-07-29",
    crs: "EPSG:4674",
    attributeNames: ["uf_sigla"],
    geometryMode: "vector",
    queryable: false,
    provenanceFile: "provenance/funai.json",
    restriction: "Capabilities públicas, mas GetFeature e DescribeFeatureType retornaram 403; não consultar nem ingerir até nova autorização.",
  },
  {
    id: "ibama",
    institution: "Instituto Brasileiro do Meio Ambiente e dos Recursos Naturais Renováveis (IBAMA)",
    state: "RESTRITA",
    serviceUrl: "https://pamgia.ibama.gov.br/server/services/01_Publicacoes_Bases/adm_embargos_ibama_a/MapServer/WFSServer",
    layerName: "adm_embargos_ibama_a",
    serviceType: "WFS / ArcGIS FeatureServer anunciado",
    license: "Não confirmada.",
    version: "Página oficial atualizada em 2026-06-17; endpoint sem versão explícita",
    crs: "Não confirmado",
    attributeNames: [],
    geometryMode: "vector",
    queryable: false,
    provenanceFile: "provenance/ibama.json",
    restriction: "Capabilities, metadados, consulta e download retornaram 403 por segurança da fonte; não fazer bypass.",
  },
  {
    id: "icmbio-limite-ucs-federais-2026",
    institution: "ICMBio",
    state: "PARCIAL",
    serviceUrl: "https://geoservicos.inde.gov.br/geoserver/ICMBio/ows?service=wfs&version=2.0.0&request=GetCapabilities",
    layerName: "ICMBio:limiteucsfederais_a",
    serviceType: "WFS 2.0.0 / GeoJSON",
    license: "Não confirmada; acesso HTTPS público não equivale a licença de redistribuição.",
    version: "Dados até 30/06/2026; página temática atualizada em 15/10/2026",
    crs: "EPSG:4674 (SIRGAS 2000)",
    attributeNames: [],
    geometryMode: "vector",
    queryable: false,
    wmsUrl: "https://geoservicos.inde.gov.br/geoserver/ICMBio/ows",
    wmsLayer: "ICMBio:limiteucsfederais_a",
    wmsVersion: "1.3.0",
    attribution: "ICMBio / INDE",
    provenanceFile: "provenance/icmbio.json",
    restriction: "WFS acessível, porém recorte validado vazio e licença não confirmada. WMS pode ser exibido somente como imagem.",
  },
  {
    id: "incra-acervo-fundiario-v3-20261101",
    institution: "Instituto Nacional de Colonização e Reforma Agrária (INCRA)",
    state: "INDISPONÍVEL",
    serviceUrl: "https://acervofundiario.incra.gov.br/Conversao01/faces/index.xhtml",
    layerName: "Não determinável",
    serviceType: "Endpoint geoespacial não determinável",
    license: "Não confirmada.",
    version: "Não confirmada; rodada V3 de 2026-11-01",
    crs: "Não determinável",
    attributeNames: [],
    geometryMode: "none",
    queryable: false,
    provenanceFile: "provenance/incra.json",
    restriction: "Hostname oficial não resolveu DNS no ambiente de validação; não inventar endpoint.",
  },
  {
    id: "iphan-sicg-bem-protecao-wfs",
    institution: "Instituto do Patrimônio Histórico e Artístico Nacional (IPHAN)",
    state: "PARCIAL",
    serviceUrl: "https://geoserver.iphan.gov.br/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=SICG%3ABem_Protecao&outputFormat=application%2Fjson&count=5&srsName=EPSG%3A4674",
    layerName: "SICG:Bem_Protecao",
    serviceType: "WFS 2.0.0 / GeoJSON",
    license: "Não confirmada explicitamente.",
    version: "GeoServer 2.17.1; WFS 2.0.0; updateSequence 3555",
    crs: "EPSG:4674 (SIRGAS 2000)",
    attributeNames: ["id_bem", "identificacao_bem", "co_iphan", "no_logradouro", "ds_natureza", "ds_classificacao", "ds_protecao", "sintese_bem", "dt_cadastro"],
    geometryMode: "vector",
    queryable: false,
    provenanceFile: "provenance/iphan.json",
    restriction: "Fonte pública validada, mas sem licença de reutilização confirmada; esta implementação não consulta nem copia dados IPHAN.",
  },
  {
    id: "MMA-CNUC-2026-07",
    institution: "Ministério do Meio Ambiente e Mudança do Clima (MMA)",
    state: "PARCIAL",
    serviceUrl: "https://dados.mma.gov.br/dataset/44b6dc8a-dc82-4a84-8d95-1b0da7c85dac/resource/72dd3d2d-3cca-4b97-b382-a1c90531e379/download/cnuc_2026_07.csv",
    layerName: "CNUC_2026_07 (CSV sem geometria)",
    serviceType: "Download CSV via CKAN",
    license: "Creative Commons Atribuição (CC BY) para o catálogo tabular.",
    version: "CNUC_2026_07; dados até julho de 2026",
    crs: "Não informado no CSV",
    attributeNames: ["ID_UC", "Nome da UC", "UF", "Municípios Abrangidos", "Código WDPA"],
    geometryMode: "tabular",
    queryable: false,
    provenanceFile: "provenance/mma.json",
    restriction: "A geometria espacial anunciada retornou 403 e nenhum serviço vetorial foi confirmado; não desenhar polígonos a partir da tabela.",
  },
  {
    id: "osm-v3-20261101",
    institution: "OpenStreetMap Foundation / OpenStreetMap",
    state: "PARCIAL",
    serviceUrl: "https://api.openstreetmap.org/api/0.6/map?bbox={left},{bottom},{right},{top}",
    layerName: "OpenStreetMap map data elements",
    serviceType: "OpenStreetMap API v0.6; amostra GeoJSON local validada",
    license: "Open Database License 1.0 (ODbL); atribuição a OpenStreetMap e colaboradores obrigatória.",
    version: "API 0.6; amostra validada em 2026-11-01",
    crs: "EPSG:4326 / WGS 84 (GeoJSON CRS84 lon,lat)",
    attributeNames: ["osm_id", "osm_type", "visible", "version", "changeset", "timestamp", "tags", "geometry"],
    geometryMode: "vector",
    queryable: true,
    localGeoJsonPath: "data/osm_sample.geojson",
    attribution: "© OpenStreetMap contributors",
    provenanceFile: "provenance/osm.json",
    restriction: "Somente a amostra local limitada é exibida. Não há download contínuo nem chamada remota de bbox ampla.",
  },
  {
    id: "fcp-certificacao-quilombola",
    institution: "Fundação Cultural Palmares (FCP)",
    state: "PARCIAL",
    serviceUrl: "https://docs.google.com/spreadsheets/d/1WBjixnnjJWrDXsA2WvElj65rrZ4nkNM-u5LclRV0lGs/export?format=csv&gid=680278480",
    layerName: "Comunidades Quilombolas Certificadas (tabela)",
    serviceType: "Google Sheets CSV export; sem geometria",
    license: "Não confirmada; atribuição à FCP até confirmação jurídica.",
    version: "Planilha acessível em 2026-11-01",
    crs: "Não aplicável: não contém geometria ou coordenadas",
    attributeNames: ["UF", "MUNICÍPIO", "CÓDIGO DO IBGE", "COMUNIDADE", "ETAPA DO PROCESSO DE TITULAÇÃO"],
    geometryMode: "tabular",
    queryable: false,
    provenanceFile: "provenance/palmares.json",
    restriction: "Lista tabular pública apenas; não inferir coordenadas nem fabricar polígonos quilombolas.",
  },
  {
    id: "sgb-cprm-ocorrencias-recursos-minerais-wfs",
    institution: "SGB/CPRM",
    state: "PARCIAL",
    serviceUrl: "https://geoservicos.sgb.gov.br/geoserver/ows",
    layerName: "geosgb:ocorrencias_recursos_minerais",
    serviceType: "WFS 2.0.0 / GeoJSON; WMS somente imagem",
    license: "Não confirmada.",
    version: "WFS 2.0.0; DescribeFeatureType v3.2",
    crs: "EPSG:4326 na consulta; também EPSG:4674 anunciado",
    attributeNames: ["id_afloramento", "origem", "municipio", "uf", "tipo_afloramento", "descricao", "longitude", "latitude", "datum"],
    geometryMode: "vector",
    queryable: false,
    provenanceFile: "provenance/sgb.json",
    restriction: "WFS público respondeu, mas bbox validado não teve feições e não há licença confirmada; não afirmar operação.",
  },
  {
    id: "ibge-municipal-2025",
    institution: "Instituto Brasileiro de Geografia e Estatística (IBGE)",
    state: "PARCIAL",
    serviceUrl: "https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_municipais/municipio_2025/UFs/SP/SP_Municipios_2025.zip",
    layerName: "SP_Municipios_2025",
    serviceType: "Cache vetorial imutável de download oficial Shapefile",
    license: "Arquivos públicos do FTP IBGE; observar Nota Metodológica vigente. Licença aberta específica não confirmada.",
    version: "Malha 2025; cache validado 2026-11-01; SHA256 5211a6fde8d334c45b59c98248881ae01c61652504f1c5b3b15b166dfb450e70",
    crs: "GeoJSON EPSG:4326 lon/lat; origem SIRGAS 2000 EPSG:4674",
    attributeNames: ["CD_MUN", "NM_MUN", "CD_UF", "SIGLA_UF", "AREA_KM2"],
    geometryMode: "vector",
    queryable: true,
    provenanceFile: "server/data/ibge-provenance.json",
    attribution: "IBGE — Malha Municipal Digital 2025",
    restriction: "645 municípios completos de SP. Fora de SP, AII bloqueada. Integração local testada; login e persistência reais ainda não homologados.",
  },
];

export function getOfficialRecord(id: string): OfficialRecord | undefined {
  const legacy = OFFICIAL_RECORDS.find(record => record.id === id);
  if (!legacy) return undefined;
  const remote = REMOTE_CONNECTIONS[id];
  return { ...legacy, remote,
    queryable: Boolean(remote?.enabled !== false && remote?.publicQueryPermitted && remote.probeStatus === 200 && remote.kind !== "wms"),
    serviceUrl: remote?.baseUrl ?? legacy.serviceUrl,
    serviceType: remote ? `Conexão remota ${remote.kind.toUpperCase()}` : "Conexão remota ainda não comprovada",
    layerName: remote?.layer || legacy.layerName,
    version: remote ? `${remote.serviceVersion}; edição ${remote.edition || "não confirmada"}` : legacy.version,
    license: remote?.license ?? legacy.license,
    crs: remote?.crs ?? legacy.crs,
    geometryMode: remote?.kind === "csv" || remote?.kind === "gviz" ? "tabular" : legacy.geometryMode,
    restriction: remote ? remote.restriction : `Sem consulta remota comprovada; nenhuma amostra ou base local será usada automaticamente. ${legacy.restriction}`,
  };
}

export function getPublicOfficialCatalog() {
  return OFFICIAL_RECORDS.map(legacy => {
    const { localGeoJsonPath: _local, ...record } = getOfficialRecord(legacy.id)!;
    return {
    ...record,
    connectionMode: record.queryable ? "remote" as const : "unavailable" as const,
    wms: record.wmsUrl && record.wmsLayer
      ? { url: record.wmsUrl, layer: record.wmsLayer, version: record.wmsVersion ?? "1.3.0", kind: "image" as const }
      : null,
    vector: { queryable: record.queryable, mode: record.geometryMode },
  }; });
}

export const OFFICIAL_LIMITS = {
  cacheTtlMs: 5 * 60 * 1000,
  maxCacheEntries: 32,
  requestTimeoutMs: 10_000,
  maxResponseBytes: 4 * 1024 * 1024,
  maxFeatures: 200,
  maxBboxSpanDegrees: 10,
} as const;
