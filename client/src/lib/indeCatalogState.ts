/** Pure frontend contract. No browser, authentication, transport or shared-router dependency. */
export const INDE_MAX_LAYERS = 4;
export const INDE_MERCATOR_MAX_LATITUDE = 85.0511287798066;
export const INDE_LIMIT_MESSAGE =
  "No máximo 4 camadas INDE simultâneas. Desative uma camada antes de ativar outra.";
export type IndeViewMode = "2d" | "3d";
export type IndeCrs = "EPSG:4326" | "EPSG:3857";
export type IndeBounds = [number, number, number, number];
export interface IndeOrganization {
  id: string;
  label: string;
  name: string;
  level: string;
  endpoint: string;
  eligible: boolean;
  blocker: string | null;
}
export interface IndeRemoteLayer {
  name: string;
  title: string;
  crs: string[];
  bounds?: { west: number; south: number; east: number; north: number };
}
export interface IndeSelectedLayer {
  id: string;
  organizationId: string;
  layerName: string;
  title: string;
  attribution: string;
  crs: string[];
  opacity?: number;
}
export type IndeLayerState = "idle" | "loading" | "ready" | "error";
export interface IndeLayerStatus {
  state: IndeLayerState;
  message: string;
  viewMode?: IndeViewMode;
  attribution?: string;
}
export interface IndeMapImageInput {
  organizationId: string;
  layerName: string;
  bounds: IndeBounds;
  width: number;
  height: number;
  crs: IndeCrs;
}
export interface IndeMapImage {
  dataUrl: string;
  crs: IndeCrs;
  bounds: IndeBounds;
  attribution: string;
}
export interface IndeGlobeImage extends Omit<IndeMapImage, "crs" | "bounds"> {
  crs: "EPSG:4326";
  bounds: [-180, -90, 180, 90];
}
export interface IndeOrganizationsResult {
  organizations: IndeOrganization[];
  sourceUrl: string;
  fetchedAt: string;
}
export interface IndeLayersResult {
  organizationId: string;
  layers: IndeRemoteLayer[];
  version: string;
  fetchedAt: string;
  capabilitySha256: string;
  truncated: boolean;
}

/** A separator-containing layer name cannot collide with another organization. */
export function indeLayerId(organizationId: string, layerName: string): string {
  return `${encodeURIComponent(organizationId)}:${encodeURIComponent(layerName)}`;
}
export function normalizeIndeCrs(crs: readonly string[]): string[] {
  return Array.from(new Set(crs.map(value => value.trim().toUpperCase())));
}
export function indeCrsIssue(
  crs: readonly string[],
  viewMode: IndeViewMode
): string | null {
  const required: IndeCrs = viewMode === "2d" ? "EPSG:3857" : "EPSG:4326";
  return normalizeIndeCrs(crs).includes(required)
    ? null
    : `Indisponível em ${viewMode === "2d" ? "2D" : "3D"}: esta camada não anuncia ${required}. Nenhum CRS alternativo será usado.`;
}
export function indeSelectedLayer(
  organization: IndeOrganization,
  layer: IndeRemoteLayer
): IndeSelectedLayer {
  return {
    id: indeLayerId(organization.id, layer.name),
    organizationId: organization.id,
    layerName: layer.name,
    title: layer.title || layer.name,
    attribution: `${organization.label} — ${organization.name} · catálogo INDE`,
    crs: normalizeIndeCrs(layer.crs),
  };
}
export function toggleIndeSelection(
  selected: readonly IndeSelectedLayer[],
  layer: IndeSelectedLayer | string,
  checked: boolean,
  viewMode: IndeViewMode
): { selected: IndeSelectedLayer[]; notice: string | null } {
  const id = typeof layer === "string" ? layer : layer.id;
  if (!checked)
    return { selected: selected.filter(item => item.id !== id), notice: null };
  if (selected.some(item => item.id === id))
    return { selected: [...selected], notice: null };
  if (typeof layer === "string")
    return {
      selected: [...selected],
      notice: "Selecione uma camada anunciada pela instituição.",
    };
  const issue = indeCrsIssue(layer.crs, viewMode);
  if (issue) return { selected: [...selected], notice: issue };
  if (selected.length >= INDE_MAX_LAYERS)
    return { selected: [...selected], notice: INDE_LIMIT_MESSAGE };
  return {
    selected: [...selected, { ...layer, crs: normalizeIndeCrs(layer.crs) }],
    notice: null,
  };
}

export interface IndeCatalogState {
  identity: string | null;
  selected: IndeSelectedLayer[];
  statuses: Record<string, IndeLayerStatus>;
  notice: string | null;
}
export function emptyIndeCatalogState(
  identity: string | null
): IndeCatalogState {
  return { identity, selected: [], statuses: {}, notice: null };
}
export type IndeCatalogAction =
  | { type: "identity"; identity: string | null }
  | { type: "clear"; identity: string | null }
  | {
      type: "toggle";
      identity: string;
      layer: IndeSelectedLayer | string;
      checked: boolean;
      viewMode: IndeViewMode;
    }
  | { type: "report"; identity: string; id: string; status: IndeLayerStatus };
export function indeCatalogReducer(
  state: IndeCatalogState,
  action: IndeCatalogAction
): IndeCatalogState {
  if (action.type === "identity")
    return state.identity === action.identity
      ? state
      : emptyIndeCatalogState(action.identity);
  if (action.identity !== state.identity || !action.identity) return state;
  if (action.type === "clear") return emptyIndeCatalogState(state.identity);
  if (action.type === "report") {
    if (!state.selected.some(layer => layer.id === action.id)) return state;
    return {
      ...state,
      statuses: { ...state.statuses, [action.id]: action.status },
    };
  }
  const next = toggleIndeSelection(
    state.selected,
    action.layer,
    action.checked,
    action.viewMode
  );
  const active = new Set(next.selected.map(layer => layer.id));
  return {
    ...state,
    ...next,
    statuses: Object.fromEntries(
      Object.entries(state.statuses).filter(([id]) => active.has(id))
    ),
  };
}

/** Fit the real viewport to the backend image budget without stretching normal aspect ratios. */
export function indeImageSize(
  viewportWidth: number,
  viewportHeight: number
): { width: number; height: number } {
  if (
    ![viewportWidth, viewportHeight].every(
      value => Number.isFinite(value) && value > 0
    )
  )
    throw new Error(
      "Dimensões do mapa indisponíveis; aguarde o mapa ficar visível."
    );
  const ratio = viewportWidth / viewportHeight;
  if (ratio < 32 / 512 || ratio > 1024 / 32)
    throw new Error(
      "Proporção do mapa incompatível com o limite WMS; amplie o painel do mapa."
    );
  const scale = Math.min(1, 1024 / viewportWidth, 512 / viewportHeight);
  const upscale = Math.max(scale, 32 / viewportWidth, 32 / viewportHeight);
  return {
    width: Math.min(1024, Math.max(32, Math.round(viewportWidth * upscale))),
    height: Math.min(512, Math.max(32, Math.round(viewportHeight * upscale))),
  };
}

/** Reject crossing/wrapped viewports instead of silently requesting another longitude range. */
export function indeMercatorViewport(bounds: IndeBounds): {
  geographicBounds: IndeBounds;
  bounds: IndeBounds;
} {
  const [west, south, east, north] = bounds;
  if (!bounds.every(Number.isFinite))
    throw new Error("Recorte do mapa contém coordenadas inválidas.");
  if (west < -180 || east > 180 || west >= east || east - west > 360)
    throw new Error(
      "Recorte cruza o antimeridiano ou uma cópia do mundo. Reposicione o mapa entre −180° e 180°; a imagem WMS não foi solicitada."
    );
  if (south >= north) throw new Error("Recorte do mapa sem área válida.");
  const clamp = (latitude: number) =>
    Math.max(
      -INDE_MERCATOR_MAX_LATITUDE,
      Math.min(INDE_MERCATOR_MAX_LATITUDE, latitude)
    );
  const s = clamp(south),
    n = clamp(north);
  if (s >= n)
    throw new Error(
      "Recorte fora da faixa válida do Web Mercator (±85,0511°)."
    );
  const radius = 6378137;
  const x = (longitude: number) => (radius * longitude * Math.PI) / 180;
  const y = (latitude: number) =>
    Math.max(
      -20037508.342789244,
      Math.min(
        20037508.342789244,
        radius * Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360))
      )
    );
  return {
    geographicBounds: [west, s, east, n],
    bounds: [x(west), y(s), x(east), y(n)],
  };
}

/** Transport validation is not visual readiness: the renderer must still decode/load the PNG. */
export function assertIndeMapImage(
  image: IndeMapImage,
  request: IndeMapImageInput
): void {
  if (image.crs !== request.crs)
    throw new Error(
      `Resposta WMS com CRS diferente do solicitado (${request.crs}).`
    );
  if (
    !Array.isArray(image.bounds) ||
    image.bounds.length !== 4 ||
    image.bounds.some(
      (value, index) =>
        !Number.isFinite(value) ||
        Math.abs(value - request.bounds[index]) >
          Math.max(1e-8, Math.abs(request.bounds[index]) * 1e-10)
    )
  )
    throw new Error(
      "Resposta WMS com recorte diferente do solicitado; imagem não exibida."
    );
  const prefix = "data:image/png;base64,";
  if (
    typeof image.dataUrl !== "string" ||
    !image.dataUrl.startsWith(prefix) ||
    image.dataUrl.length > 8 * 1024 * 1024
  )
    throw new Error(
      "Resposta WMS inválida: esperado somente PNG data URL dentro do limite de tamanho."
    );
  const encoded = image.dataUrl.slice(prefix.length);
  if (
    encoded.length < 44 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded
    )
  )
    throw new Error("PNG WMS contém base64 inválido.");
  const header = atob(encoded.slice(0, 44));
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    signature.some((byte, index) => header.charCodeAt(index) !== byte) ||
    [0, 0, 0, 13].some(
      (byte, index) => header.charCodeAt(index + 8) !== byte
    ) ||
    header.slice(12, 16) !== "IHDR"
  )
    throw new Error("Resposta WMS não tem cabeçalho PNG válido.");
  const uint32 = (offset: number) =>
    header.charCodeAt(offset) * 0x1000000 +
    header.charCodeAt(offset + 1) * 0x10000 +
    header.charCodeAt(offset + 2) * 0x100 +
    header.charCodeAt(offset + 3);
  if (uint32(16) !== request.width || uint32(20) !== request.height)
    throw new Error(
      `Dimensões da imagem WMS diferentes das solicitadas (${request.width}×${request.height}).`
    );
}
export function isIndeRequestCurrent<T>(
  signal: AbortSignal,
  token: T,
  current: T | undefined
): boolean {
  return !signal.aborted && token === current;
}
export function indeErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Serviço WMS indisponível; tente novamente.";
}

/** Leaflet's attribution control interprets HTML, so every remote credit must be escaped. */
export function indeLeafletAttribution(attribution: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return `Fonte: ${attribution}`.replace(
    /[&<>"']/g,
    character => entities[character]
  );
}
