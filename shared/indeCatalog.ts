/** Catálogo federado INDE: visualização WMS remota; não oferece estatísticas nem análise vetorial. */
export interface IndeOrganization {
  id: string;
  label: string;
  name: string;
  level: string;
  endpoint: string;
  /** Elegibilidade de transporte, não confirmação de disponibilidade ou de conteúdo. */
  eligible: boolean;
  blocker: string | null;
}

export interface IndeBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface IndeLayer {
  name: string;
  /** Texto puro não confiável: renderizar como texto, nunca como HTML. */
  title: string;
  crs: string[];
  /** Coordenadas geográficas longitude/latitude, quando anunciadas e válidas. */
  bounds?: IndeBounds;
}

export interface IndeOrganizationsResult {
  organizations: IndeOrganization[];
  /** Página oficial que publica o catálogo, não endpoint fornecido pelo cliente. */
  sourceUrl: string;
  /** ISO UTC da coleta oficial do snapshot; não renovado durante a inicialização. */
  fetchedAt: string;
  /** ISO UTC da leitura da lista local revisada; não é uma sondagem dos serviços. */
  listFetchedAt: string;
}

export interface IndeLayersResult {
  organizationId: string;
  layers: IndeLayer[];
  version: string;
  fetchedAt: string;
  capabilitySha256: string;
  /** true quando há mais camadas nomeadas do que o limite retornado. */
  truncated: boolean;
}

export type IndeMapCrs = "EPSG:4326" | "EPSG:3857";
export type IndeMapBounds = [number, number, number, number];
export interface IndeMapImageInput {
  organizationId: string;
  layerName: string;
  /** Sempre [west, south, east, north] (lon/lat em 4326, x/y em 3857); eixos WMS são internos. */
  bounds: IndeMapBounds;
  width: number;
  height: number;
  crs: IndeMapCrs;
}
export interface IndeMapImageResult {
  dataUrl: string;
  crs: IndeMapCrs;
  bounds: IndeMapBounds;
  attribution: string;
}

export const INDE_CATALOG_LIMITS = Object.freeze({
  capabilitiesBytes: 8 * 1024 * 1024,
  imageBytes: 4 * 1024 * 1024,
  timeoutMs: 12_000,
  cacheTtlMs: 5 * 60_000,
  cacheEntries: 80,
  maxConcurrentRequests: 8,
  namedLayers: 1_000,
  maxWidth: 1_024,
  maxHeight: 512,
  maxPixels: 524_288,
  webMercatorExtent: 20_037_508.342789244,
});
