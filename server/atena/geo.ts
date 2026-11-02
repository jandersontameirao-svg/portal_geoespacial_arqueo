/**
 * Núcleo geoespacial da Atena. Todo cálculo geométrico passa por aqui, com
 * bibliotecas (turf, proj4, polyclip-ts). O modelo de linguagem nunca calcula.
 *
 * Convenções (ver docs/atena/README.md):
 * - Geometrias do banco: coordenadas [lat, lng] (mesma ordem do desenho manual
 *   e do export GeoJSON do servidor). Entrada turf/GeoJSON usa [lng, lat].
 * - Datum: SIRGAS 2000 (EPSG:4674) tratado como WGS84 (diferença sub-métrica).
 * - Áreas e comprimentos: projeção UTM SIRGAS 2000 local, em metros.
 *   Análises que cruzam fuso são recusadas, preservando a implementação PR8.
 * - Buffer: turf (geodésico), com 128 passos por quarto de círculo.
 */
import { proj4 } from "./proj";
import buffer from "@turf/buffer";
import intersect from "@turf/intersect";
import union from "@turf/union";
import { featureCollection, point, lineString } from "@turf/helpers";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import { collectCoordinatePositions, normalizeStoredPolygonCoordinates, storedPolygonToGeoJSON, type StoredPolygonShape } from "../../shared/geometry-coordinates";


/** Envelope do Brasil em [lat, lng]. Fora dele a análise é recusada. */
export const BR_ENVELOPE = { latMin: -34.5, latMax: 6.0, lngMin: -74.5, lngMax: -34.0 };
export const MAX_EXTENT_KM2 = 2500;
export const MAX_FEATURES = 5000;
export const BUFFER_STEPS = 128;

export type GeoType = "Point" | "LineString" | "Polygon" | "MultiPolygon";

export type SourceRow = {
  id: number;
  name: string;
  type: "marker" | "polyline" | "polygon";
  coordinates: string; // JSON armazenado: [lat,lng]
  layerId: number | null;
};

export type Feat = {
  id: number;
  name: string;
  type: GeoType;
  /** GeoJSON na ordem [lng, lat] */
  feature: Feature<any>;
};

export type GeoIssue = { code: string; message: string; featureId?: number };

export const ROW_TYPE: Record<SourceRow["type"], GeoType> = {
  marker: "Point",
  polyline: "LineString",
  polygon: "Polygon",
};

function inEnvelope(lat: number, lng: number) {
  return lat >= BR_ENVELOPE.latMin && lat <= BR_ENVELOPE.latMax && lng >= BR_ENVELOPE.lngMin && lng <= BR_ENVELOPE.lngMax;
}

/**
 * Converte uma linha do banco em feição GeoJSON, verificando ordem, envelope,
 * validade e fechamento de anéis. Não corrige dados silenciosamente.
 */
export function parseRow(row: SourceRow): { ok: true; value: Feat } | { ok: false; issue: GeoIssue } {
  const issue = (code: string, message: string) => ({ ok: false as const, issue: { code, message, featureId: row.id } });
  let raw: any;
  try {
    raw = JSON.parse(row.coordinates);
  } catch {
    return issue("GEOMETRIA_INVALIDA", `"${row.name}": coordenadas ilegíveis.`);
  }
  const type = ROW_TYPE[row.type];
  if (!type) return issue("GEOMETRIA_INVALIDA", `"${row.name}": tipo desconhecido.`);

  let storedShape: StoredPolygonShape | null = null;
  let pairs: number[][];
  if (type === "Point") {
    if (!Array.isArray(raw) || raw.length < 2 || !raw.every(Number.isFinite)) {
      return issue("GEOMETRIA_INVALIDA", `"${row.name}": coordenada de ponto inválida.`);
    }
    pairs = [raw];
  } else if (type === "LineString") {
    if (!Array.isArray(raw) || raw.length < 2 || raw.some(p => !Array.isArray(p) || p.length < 2 || !p.every(Number.isFinite))) {
      return issue("GEOMETRIA_INVALIDA", `"${row.name}": pares de coordenadas de linha inválidos.`);
    }
    pairs = raw;
  } else {
    try {
      storedShape = normalizeStoredPolygonCoordinates(raw);
      pairs = collectCoordinatePositions(storedShape.coordinates);
    } catch (error) {
      return issue("GEOMETRIA_INVALIDA", `"${row.name}": ${error instanceof Error ? error.message : "estrutura poligonal inválida."}`);
    }
  }
  // Verificação de ordem: o banco guarda [lat,lng]. Ordem invertida é recusada.
  const outOfEnvelope = pairs.filter(([lat, lng]) => !inEnvelope(lat, lng));
  if (outOfEnvelope.length > 0) {
    const swapped = pairs.every(([a, b]) => inEnvelope(b, a));
    if (swapped) {
      return issue("ORDEM_INVERTIDA", `"${row.name}": coordenadas gravadas como [lng,lat]. Corrija a importação antes de analisar.`);
    }
    return issue("FORA_DO_BRASIL", `"${row.name}": coordenadas fora do envelope do Brasil ou com ordem inconsistente.`);
  }

  const lngLat = pairs.map(([lat, lng, ...rest]) => [lng, lat, ...rest]);
  let feature: Feature<any>;
  if (type === "Point") {
    feature = point(lngLat[0]);
  } else if (type === "LineString") {
    if (lngLat.length < 2) return issue("GEOMETRIA_INVALIDA", `"${row.name}": linha com menos de 2 vértices.`);
    feature = lineString(lngLat);
  } else {
    if (!storedShape) return issue("GEOMETRIA_INVALIDA", `"${row.name}": polígono vazio.`);
    try {
      feature = { type: "Feature", properties: {}, geometry: storedPolygonToGeoJSON(raw) } as Feature<Polygon | MultiPolygon>;
    } catch (error) {
      return issue("GEOMETRIA_INVALIDA", `"${row.name}": ${error instanceof Error ? error.message : "estrutura poligonal inválida."}`);
    }
  }
  return { ok: true, value: { id: row.id, name: row.name, type: storedShape?.type ?? type, feature } };
}

/** Parse em lote: retorna feições válidas e lista de problemas bloqueantes. */
export function parseRows(rows: SourceRow[]) {
  const feats: Feat[] = [];
  const issues: GeoIssue[] = [];
  for (const row of rows) {
    const r = parseRow(row);
    if (r.ok) feats.push(r.value);
    else issues.push(r.issue);
  }
  return { feats, issues };
}

/**
 * Projeção métrica das análises: UTM SIRGAS 2000 (decisão aprovada).
 * A zona é a do centro do extent. Extent que cruza fuso é recusado com mensagem clara.
 * Erro de escala medido: < 0,1% em área dentro de ±2° do meridiano central da zona.
 */
export function localProjection(feats: Feat[]) {
  const coords: number[][] = [];
  for (const f of feats) collect(f.feature.geometry, coords);
  if (coords.length === 0) throw new Error("Sem coordenadas para projetar");
  const lngs = coords.map(c => c[0]), lats = coords.map(c => c[1]);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const lng0 = (minLng + maxLng) / 2;
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const zoneOf = (lng: number) => Math.floor((lng + 180) / 6) + 1;
  const zone = zoneOf(lng0);
  if (zoneOf(minLng) !== zone || zoneOf(maxLng) !== zone) {
    throw new Error(`O extent cruza mais de um fuso UTM (zonas ${zoneOf(minLng)} e ${zoneOf(maxLng)}). Divida a análise por fuso.`);
  }
  const south = lat0 < 0;
  const def = `+proj=utm +zone=${zone}${south ? " +south" : ""} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
  const code = `SIRGAS2000_UTM_${zone}${south ? "S" : "N"}`;
  proj4.defs(code, def);
  const epsgUtm = south ? `EPSG:${31960 + zone}` : `SIRGAS 2000 UTM zona ${zone}N`;
  return { code, lat0, lng0, utmZone: zone, epsgUtm, def };
}

function collect(geom: any, out: number[][]) {
  if (!geom) return;
  if (geom.type === "Point") out.push(geom.coordinates);
  else if (geom.type === "LineString") out.push(...geom.coordinates);
  else if (geom.type === "Polygon") geom.coordinates.forEach((r: number[][]) => out.push(...r));
  else if (geom.type === "MultiPolygon") geom.coordinates.forEach((p: number[][][]) => p.forEach(r => out.push(...r)));
}

/** Extent em km² estimado pelo bbox em UTM local. */
export function extentKm2(feats: Feat[], proj: { code: string }) {
  const coords: number[][] = [];
  for (const f of feats) collect(f.feature.geometry, coords);
  const xs: number[] = [], ys: number[] = [];
  for (const c of coords) {
    const [x, y] = proj4("EPSG:4674", proj.code, c);
    xs.push(x); ys.push(y);
  }
  return ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))) / 1e6;
}

/** Área líquida (m²), subtraindo todos os furos, na projeção local. */
export function ringAreaM2(geom: Polygon | MultiPolygon, proj: { code: string }): number {
  const polys: number[][][][] = geom.type === "Polygon" ? [geom.coordinates as any] : (geom.coordinates as any);
  let total = 0;
  for (const rings of polys) {
    const areaOfRing = (coordinates: number[][]) => {
      const ring = coordinates.map(c => proj4("EPSG:4674", proj.code, c));
      let a = 0;
      for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      return Math.abs(a) / 2;
    };
    const exterior = areaOfRing(rings[0] ?? []);
    const holes = rings.slice(1).reduce((sum, ring) => sum + areaOfRing(ring), 0);
    total += Math.max(0, exterior - holes);
  }
  return total;
}

/** Comprimento (m) de uma linha, na projeção local. */

export function lineLengthM(feat: Feature<any>, proj: { code: string }): number {
  const coords = (feat.geometry.coordinates as number[][]).map(c => proj4("EPSG:4674", proj.code, c));
  let d = 0;
  for (let i = 0; i < coords.length - 1; i++) d += Math.hypot(coords[i + 1][0] - coords[i][0], coords[i + 1][1] - coords[i][1]);
  return d;
}

/** União dos polígonos de referência (ex.: ADA com várias partes). */
export function unionPolygons(feats: Feat[]): Feature<Polygon | MultiPolygon> | null {
  if (feats.length === 0) return null;
  let acc: Feature<Polygon | MultiPolygon> = feats[0].feature as any;
  for (let i = 1; i < feats.length; i++) {
    const u = union(featureCollection([acc as any, feats[i].feature as any]));
    if (!u) continue;
    acc = u as any;
  }
  return acc;
}

export type IntersectRow = {
  sourceId: number;
  sourceName: string;
  sourceAreaM2: number;
  intersectionAreaM2: number;
  percentInside: number;
  pieces: Feature<Polygon | MultiPolygon> | null;
};

/** Interseção de polígonos de origem com a referência. Áreas em m² (UTM local). */
export function intersectWithReference(sources: Feat[], ref: Feature<Polygon | MultiPolygon>, proj: { code: string }): IntersectRow[] {
  const rows: IntersectRow[] = [];
  for (const s of sources) {
    const sFeat = s.feature as Feature<Polygon | MultiPolygon>;
    const sourceArea = ringAreaM2(sFeat.geometry, proj);
    const inter = intersect(featureCollection([sFeat as any, ref as any])) as Feature<Polygon | MultiPolygon> | null;
    const interArea = inter ? ringAreaM2(inter.geometry, proj) : 0;
    rows.push({
      sourceId: s.id,
      sourceName: s.name,
      sourceAreaM2: sourceArea,
      intersectionAreaM2: interArea,
      percentInside: sourceArea > 0 ? (interArea / sourceArea) * 100 : 0,
      pieces: inter,
    });
  }
  return rows;
}

/** Buffer geodésico em metros. Retorna polígonos. */
export function bufferFeature(f: Feat, distanceM: number): Feature<Polygon | MultiPolygon> | null {
  return buffer(f.feature as any, distanceM, { units: "meters", steps: BUFFER_STEPS }) as any;
}

/**
 * Converte uma geometria GeoJSON [lng,lat] em um registro por polígono, na
 * ordem canônica [lat,lng] usada pelo desenho manual. Multipolígono vira uma
 * linha por parte, sem perda de partes ou furos.
 */
export function toStoredPolygons(geom: Polygon | MultiPolygon): string[] {
  const parts = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  return parts.map(rings => JSON.stringify(rings.map(ring => ring.slice(0, -1).map(([lng, lat]) => [lat, lng]))));
}

export function describeIssues(issues: GeoIssue[]) {
  return issues.map(i => i.message);
}
