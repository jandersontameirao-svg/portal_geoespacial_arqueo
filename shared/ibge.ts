/** Preset deliberadamente restrito: não é proxy OGC genérico nem edição 2025. */
export const IBGE_PRESET_ID = "ibge-municipios-2010-v1";
export const IBGE_ATTRIBUTION = "Fonte: IBGE";
export const IBGE_REMOTE_LAYER =
  "CGEO:C02_recortes_territoriais_municipio_2010";
export const IBGE_EDITION = 2010;
export const IBGE_MAX_BYTES = 4 * 1024 * 1024;
export const IBGE_TIMEOUT_MS = 10_000;
export const IBGE_PRESETS = [
  {
    serviceType: "wms",
    endpoint: "https://geoservicos.ibge.gov.br/geoserver/wms",
    logicalLayer: "ibge:municipios:2010:wms",
    name: "IBGE — Municípios 2010 (WMS)",
    displayCrs: "EPSG:3857",
  },
  {
    serviceType: "wfs",
    endpoint: "https://geoservicos.ibge.gov.br/geoserver/wfs",
    logicalLayer: "ibge:municipios:2010:wfs",
    name: "IBGE — Municípios 2010 (WFS remoto)",
    displayCrs: "EPSG:4674",
  },
] as const;
export type IbgeBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};
export const IBGE_PROBE_BOUNDS: Readonly<IbgeBounds> = Object.freeze({
  west: -47.89,
  south: -15.8,
  east: -47.88,
  north: -15.79,
});
export const IBGE_REMOTE_ONLY_MESSAGE =
  "IBGE é consulta remota, não importação: use queryIbgeViewport para consultar o viewport sem criar cópias permanentes.";
