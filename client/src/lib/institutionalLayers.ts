import type { FeatureCollection } from "geojson";

export const IBGE_MUNICIPALITIES_2010 =
  "CGEO:C02_recortes_territoriais_municipio_2010";
export type ViewportBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};
export type InstitutionalVariant = {
  id: number;
  serviceId?: number;
  publisher?: string;
  serviceType: "wms" | "wfs";
  endpoint: string;
  remoteLayer: string;
  attribution?: string | null;
  health: string;
  displayCrs?: string;
};
export type InstitutionalPublishedLayer = {
  logicalLayer: string;
  selected: InstitutionalVariant | null;
  primary?: InstitutionalVariant | null;
  isFallback: boolean;
  reason: string | null;
};
export type IbgeViewportResult = {
  collection: FeatureCollection;
  complete: boolean;
  matched: number | null;
  queriedAt: string;
  attribution: string;
  featureCount: number;
};
export type InstitutionalLayerStatus = {
  message: string;
  state: "idle" | "loading" | "ready" | "error";
  featureCount?: number;
  matched?: number | null;
  queriedAt?: string;
  attribution?: string;
};
export function isIbgeVariant(
  variant?: Pick<InstitutionalVariant, "publisher" | "remoteLayer"> | null
): boolean {
  return (
    !!variant &&
    (variant.publisher?.trim().toUpperCase() === "IBGE" ||
      variant.remoteLayer === IBGE_MUNICIPALITIES_2010)
  );
}
export function isIbgePublishedLayer(
  layer: InstitutionalPublishedLayer
): boolean {
  return isIbgeVariant(layer.selected) || isIbgeVariant(layer.primary);
}
export function viewportIssue(bounds: ViewportBounds): string | null {
  const { west, south, east, north } = bounds;
  if (
    ![west, south, east, north].every(Number.isFinite) ||
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    east <= west ||
    north <= south
  )
    return "Recorte inválido ou cruzando o antimeridiano. Reposicione o mapa.";
  if (east - west > 2 || north - south > 2)
    return "Aproxime o mapa: o recorte deve ter no máximo 2° de largura e altura.";
  return null;
}
export function completeViewportCollection(
  result: IbgeViewportResult
): FeatureCollection | null {
  return result.complete === true &&
    result.collection?.type === "FeatureCollection" &&
    Array.isArray(result.collection.features)
    ? result.collection
    : null;
}
export function escapeAttribution(value: string): string {
  return value.replace(
    /[&<>"']/g,
    character =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!
  );
}
export function ibgeAttribution(
  variant: Pick<InstitutionalVariant, "attribution">
): string {
  return escapeAttribution(
    `Fonte: IBGE${variant.attribution ? ` — ${variant.attribution}` : ""}`
  );
}
