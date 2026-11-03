import type { FeatureCollection } from "geojson";
export const IBGE_MUNICIPALITIES_2010 =
  "CGEO:C02_recortes_territoriais_municipio_2010";
export const INSTITUTIONAL_PUBLISHERS = [
  "IBGE",
  "IPHAN",
  "FUNAI",
  "INCRA",
] as const;
export type InstitutionalPublisher = (typeof INSTITUTIONAL_PUBLISHERS)[number];
export type InstitutionalSource = {
  publisher: Exclude<InstitutionalPublisher, "IBGE">;
  label: string;
  title: string;
  edition: string | null;
  sourceCrs: string | null;
  status: "validated" | "blocked";
  blocker: string | null;
  presetId: string;
  supportsWms: boolean;
  supportsWfs: boolean;
  registeredTypes: string[];
  wmsVersion: "1.1.1";
};
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
  wmsVersion?: "1.1.1";
  title?: string | null;
  edition?: string | null;
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
export function institutionalPublisher(
  variant?: Pick<InstitutionalVariant, "publisher" | "remoteLayer"> | null
): InstitutionalPublisher | null {
  if (!variant) return null;
  const publisher = variant.publisher?.trim().toUpperCase();
  if (INSTITUTIONAL_PUBLISHERS.includes(publisher as InstitutionalPublisher))
    return publisher as InstitutionalPublisher;
  // Compatibility for the exact legacy IBGE layer only; never infer a publisher from a URL.
  return !publisher && variant.remoteLayer === IBGE_MUNICIPALITIES_2010
    ? "IBGE"
    : null;
}
export function isIbgeVariant(
  variant?: Pick<InstitutionalVariant, "publisher" | "remoteLayer"> | null
): boolean {
  return institutionalPublisher(variant) === "IBGE";
}
export function isIbgePublishedLayer(
  layer: InstitutionalPublishedLayer
): boolean {
  return isIbgeVariant(layer.selected ?? layer.primary);
}
export function isInstitutionalPublishedLayer(
  layer: InstitutionalPublishedLayer
): boolean {
  return institutionalPublisher(layer.selected ?? layer.primary) !== null;
}
export function sourceIsRegistered(source: InstitutionalSource): boolean {
  const expected = [
    source.supportsWms && "wms",
    source.supportsWfs && "wfs",
  ].filter(Boolean);
  const registered = source.registeredTypes.map(type =>
    type.trim().toLowerCase()
  );
  return (
    expected.length > 0 &&
    expected.every(type => registered.includes(type as string))
  );
}
export function institutionalTitle(variant: InstitutionalVariant): string {
  if (variant.title?.trim()) return variant.title;
  return isIbgeVariant(variant) &&
    variant.remoteLayer === IBGE_MUNICIPALITIES_2010
    ? "Municípios · referência 2010"
    : (institutionalPublisher(variant) ?? "Fonte institucional");
}
export function institutionalEdition(variant: InstitutionalVariant): string {
  return (
    variant.edition?.trim() ||
    (isIbgeVariant(variant) && variant.remoteLayer === IBGE_MUNICIPALITIES_2010
      ? "2010"
      : "não declarada")
  );
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
export function institutionalAttribution(
  variant: Pick<
    InstitutionalVariant,
    "publisher" | "remoteLayer" | "attribution"
  >
): string {
  return escapeAttribution(
    `Fonte: ${institutionalPublisher(variant) ?? "institucional"}${variant.attribution ? ` — ${variant.attribution}` : ""}`
  );
}
