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
}

/**
 * Catálogo de mapas de fundo. Não inclui o tile público padrão do OSM como
 * fallback: ele pode bloquear tráfego incompatível com sua política. A escolha
 * de um provedor OSM ou OpenTopo em produção deve ser registrada e aprovada.
 */
export const BASEMAPS: BasemapDefinition[] = [
  {
    id: "esri-imagery",
    name: "ESRI Satélite",
    kind: "xyz",
    availability: "available",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    description: "Imagem de referência para visualização. Não é declarada como ortofoto certificada.",
    licenseUrl: "https://www.esri.com/en-us/legal/terms/full-master-agreement",
  },
  {
    id: "esri-light-gray",
    name: "ESRI Light Gray",
    kind: "xyz",
    availability: "legacy-available",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "Sources: Esri, HERE, Garmin, INCREMENT P, © OpenStreetMap contributors, and the GIS User Community",
    description: "Tile raster legado Esri, verificado em 29/10/2026. Em suporte maduro e previsto para retirada em dezembro de 2029; substituir por basemap vetorial compatível antes desse prazo.",
    licenseUrl: "https://www.esri.com/arcgis-blog/products/arcgis-living-atlas/announcements/sunsetting-legacy-basemaps",
  },
  {
    id: "esri-dark-gray",
    name: "ESRI Dark Gray",
    kind: "xyz",
    availability: "legacy-available",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "© Esri",
    description: "Tile raster legado Esri, verificado em 29/10/2026. Em suporte maduro e previsto para retirada em dezembro de 2029; substituir por basemap vetorial compatível antes desse prazo.",
    licenseUrl: "https://www.esri.com/arcgis-blog/products/arcgis-living-atlas/announcements/sunsetting-legacy-basemaps",
  },
  {
    id: "osm-approved-provider",
    name: "OpenStreetMap",
    kind: "xyz",
    availability: "requires-approved-provider",
    attribution: "© OpenStreetMap contributors",
    description: "Requer provedor aprovado ou infraestrutura própria; o tile público padrão não é usado como fallback pelo Portal.",
    licenseUrl: "https://operations.osmfoundation.org/policies/tiles/",
  },
  {
    id: "opentopo-approved-provider",
    name: "OpenTopo",
    kind: "xyz",
    availability: "requires-approved-provider",
    attribution: "Dados topográficos conforme provedor aprovado",
    description: "Disponível somente após validação de contrato, limites e atribuição do provedor selecionado.",
  },
];

export const DEFAULT_BASEMAP = BASEMAPS[0];

export const SELECTABLE_BASEMAPS = BASEMAPS.filter((basemap) => basemap.availability === "available" || basemap.availability === "legacy-available");
