import type { FeatureCollection } from "geojson";

export interface OfficialBbox { west: number; south: number; east: number; north: number }
export interface QueryScope { userId: number; projectId?: number }
export interface RemoteConnection {
  kind: "wfs" | "arcgis" | "ogcapi" | "overpass" | "json" | "csv" | "gviz" | "wms";
  enabled?: boolean;
  cacheAllowed?: boolean;
  bboxCrsSuffix?: boolean;
  tableDelimiter?: ";" | ",";
  tableEncoding?: string;
  tableFilterColumns?: readonly string[];
  baseUrl: string;
  layer: string;
  serviceVersion: string;
  edition: string;
  crs: string;
  srsName?: string;
  outputFormat?: string;
  bboxAxisOrder: "lnglat" | "latlng";
  responseAxisOrder: "lnglat" | "latlng";
  geometryComplete: boolean;
  publicQueryPermitted: boolean;
  license: string;
  licenseUrl: string;
  validatedAt: string;
  probeStatus: number;
  probeFeatureCount: number;
  restriction: string;
}
export interface RemoteProvenance {
  institutionId: string; endpoint: string; serviceVersion: string; edition: string;
  geometryComplete: boolean; queriedAt: string; cacheExpiresAt: string; cacheHit: boolean;
  license: string; crs: string;
}
export interface RemoteQueryResult {
  geojson: FeatureCollection;
  complete: boolean;
  matched: number | null;
  provenance: RemoteProvenance;
  rows?: Array<Record<string, string>>;
}
