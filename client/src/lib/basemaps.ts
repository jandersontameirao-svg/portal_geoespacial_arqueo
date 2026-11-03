export type BasemapAvailability = "available" | "legacy-available" | "requires-approved-provider" | "planned-review";

export interface BasemapDefinition {
  id: string;
  name: string;
  kind: "xyz" | "wmts";
  availability: BasemapAvailability;
  url?: string;
  attribution: string;
  description: string;
  licenseUrl?: string;
  minZoom?: number;
  maxZoom?: number;
  /** Aplicar antes de carregar as imagens; CORS depende também do servidor remoto. */
  crossOrigin?: boolean | "anonymous" | "use-credentials";
}

/**
 * Catálogo explícito de fundos remotos, sem fallback entre provedores.
 * IDs históricos são persistidos em mapas salvos: não renomear.
 * OSM/OpenTopo permitem uso interativo pequeno, respeitando atribuição, Referer
 * e cache HTTP. Não usar para scraping, prefetch, download de áreas ou offline.
 * Disponibilidade e CORS verificados pontualmente em 02/11/2026, sem SLA.
 */
export const BASEMAPS: BasemapDefinition[] = [
  {
    id: "esri-imagery",
    name: "ESRI Satélite",
    kind: "xyz",
    availability: "available",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community",
    description: "Imagem de referência para visualização. Não é declarada como ortofoto certificada; resolução e cobertura variam conforme o local.",
    licenseUrl: "https://www.esri.com/en-us/legal/terms/full-master-agreement",
    minZoom: 0,
    maxZoom: 23,
    crossOrigin: "anonymous",
  },
  {
    id: "esri-light-gray",
    name: "ESRI Light Gray",
    kind: "xyz",
    availability: "legacy-available",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "Sources: Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS User Community",
    description: "Tile raster legado Esri, verificado em 02/11/2026. Em suporte maduro e previsto para retirada em dezembro de 2029; substituir por basemap vetorial compatível antes desse prazo. Cobertura e detalhe variam conforme o local.",
    licenseUrl: "https://www.esri.com/arcgis-blog/products/arcgis-living-atlas/announcements/sunsetting-legacy-basemaps",
    minZoom: 0,
    maxZoom: 16,
    crossOrigin: "anonymous",
  },
  {
    id: "esri-dark-gray",
    name: "ESRI Dark Gray",
    kind: "xyz",
    availability: "legacy-available",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "Sources: Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS User Community",
    description: "Tile raster legado Esri, verificado em 02/11/2026. Em suporte maduro e previsto para retirada em dezembro de 2029; substituir por basemap vetorial compatível antes desse prazo. Cobertura e detalhe variam conforme o local.",
    licenseUrl: "https://www.esri.com/arcgis-blog/products/arcgis-living-atlas/announcements/sunsetting-legacy-basemaps",
    minZoom: 0,
    maxZoom: 16,
    crossOrigin: "anonymous",
  },
  {
    id: "osm-approved-provider",
    name: "OpenStreetMap",
    kind: "xyz",
    availability: "available",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors — https://www.openstreetmap.org/copyright",
    description: "Servidor público oficial OSM para visualização interativa pequena, sem SLA. Manter atribuição visível, Referer válido e cache HTTP; não usar para download de áreas, prefetch, scraping ou offline. Não é fallback de outros fundos.",
    licenseUrl: "https://operations.osmfoundation.org/policies/tiles/",
    minZoom: 0,
    maxZoom: 19,
    crossOrigin: "anonymous",
  },
  {
    id: "opentopo-approved-provider",
    name: "OpenTopoMap",
    kind: "xyz",
    availability: "available",
    url: "https://tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "Dados: © OpenStreetMap contributors — https://www.openstreetmap.org/copyright | Elevação: SRTM, Sonny | Cartografia: © OpenTopoMap — https://opentopomap.org (CC-BY-SA 3.0 — https://creativecommons.org/licenses/by-sa/3.0/)",
    description: "Servidor raster oficial OpenTopoMap, verificado em 02/11/2026, para visualização interativa pequena entre zooms 1 e 17, sem garantia de disponibilidade. Preservar atribuição e CC-BY-SA 3.0 na impressão; sem download em massa, prefetch ou offline. Sem troca automática por backup ou outro fundo.",
    licenseUrl: "https://opentopomap.org/about",
    minZoom: 1,
    maxZoom: 17,
    crossOrigin: "anonymous",
  },
];

export const DEFAULT_BASEMAP = BASEMAPS[0];

export const SELECTABLE_BASEMAPS = BASEMAPS.filter((basemap) => basemap.availability === "available" || basemap.availability === "legacy-available");
