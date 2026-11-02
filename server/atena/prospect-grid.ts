/**
 * Geração determinística de unidades de prospecção.
 *
 * A entrada é GeoJSON em [lng, lat]. O cálculo acontece em uma UTM local
 * SIRGAS 2000 (metros) e a saída mantém duas representações explícitas:
 * `coordinates`/`geojson` em [lng, lat] e `storedCoordinates` em [lat, lng],
 * que é a ordem canônica da tabela de geometrias da Atena.
 *
 * Este módulo é puro: não lê banco, não escreve armazenamento e não conhece
 * autenticação. A autorização e a persistência ficam no router/UI.
 */
import type {
  Feature,
  FeatureCollection,
  Geometry,
  LineString,
  MultiLineString,
  MultiPolygon,
  Point,
  Polygon,
} from "geojson";
import { point } from "@turf/helpers";
import { localProjection, type Feat } from "./geo";
import { proj4 } from "./proj";

export const DEFAULT_PROSPECTION_SPACING_M = 30;
export const DEFAULT_LINE_OFFSET_M = 15;
export const DEFAULT_MAX_UNITS = 5000;

export type ProspectGeometry =
  | Feature<Polygon | MultiPolygon | LineString | MultiLineString>
  | Polygon
  | MultiPolygon
  | LineString
  | MultiLineString;

export type ProspectMode = "polygon" | "line";

export type ProspectGridParameters = {
  /** Espaçamento base. Para polígonos, é o fallback de dx/dy; para linhas, é longitudinal. */
  spacing?: number;
  /** Espaçamento leste-oeste da grade poligonal, em metros. */
  dx?: number;
  /** Espaçamento norte-sul da grade poligonal, em metros. */
  dy?: number;
  /** Deslocamento lateral da linha; 15 m por lado é o padrão aprovado. */
  lineOffsetM?: number;
  /** Alias de lineOffsetM aceito pela API pública. */
  offsetM?: number;
  /** Alterna o lado do eixo a cada unidade linear. */
  zigzag?: boolean;
  /** Limite duro para impedir grades acidentais gigantes. */
  maxUnits?: number;
  /** Prefixo dos IDs e nomes das unidades. */
  prefix?: string;
  /** Número inicial, útil quando várias feições de uma mesma camada são unidas. */
  startNumber?: number;
};

export type ProspectUnit = {
  id: string;
  number: number;
  name: string;
  mode: ProspectMode;
  coordinates: [number, number];
  /** Coordenadas canônicas de persistência: [lat, lng]. */
  storedCoordinates: [number, number];
  geometry: Feature<Point>;
  properties: {
    id: string;
    number: number;
    name: string;
    mode: ProspectMode;
    side?: "left" | "right" | "center";
    row?: number;
    column?: number;
    sourcePart?: number;
  };
};

export type ProspectGeneration = {
  mode: ProspectMode;
  units: ProspectUnit[];
  count: number;
  parameters: Required<Pick<ProspectGridParameters, "spacing" | "dx" | "dy" | "lineOffsetM" | "zigzag" | "maxUnits" | "prefix" | "startNumber">>;
  geojson: FeatureCollection<Point>;
};

export class ProspectGridError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_GEOMETRY"
      | "INVALID_PARAMETER"
      | "UNSUPPORTED_GEOMETRY"
      | "MAX_UNITS_EXCEEDED",
  ) {
    super(message);
    this.name = "ProspectGridError";
  }
}

type XY = [number, number];
type ProjectedPolygon = XY[][];
type ProjectedMultiPolygon = ProjectedPolygon[];

type NormalizedInput = {
  geometry: ProspectGeometry;
  parameters: ProspectGridParameters;
};

function isFeature(value: unknown): value is Feature {
  return !!value && typeof value === "object" && (value as { type?: unknown }).type === "Feature";
}

function geometryOf(input: ProspectGeometry): Geometry {
  return isFeature(input) ? input.geometry : input;
}

function normalizeInput(
  input: ProspectGeometry | { geometry: ProspectGeometry; parameters?: ProspectGridParameters },
  parameters: ProspectGridParameters = {},
): NormalizedInput {
  if (typeof input === "object" && input !== null && "geometry" in input && !("coordinates" in input)) {
    const wrapped = input as { geometry: ProspectGeometry; parameters?: ProspectGridParameters };
    return { geometry: wrapped.geometry, parameters: { ...(wrapped.parameters ?? {}), ...parameters } };
  }
  return { geometry: input as ProspectGeometry, parameters };
}

function normalizeParameters(parameters: ProspectGridParameters): ProspectGeneration["parameters"] {
  const spacing = parameters.spacing ?? DEFAULT_PROSPECTION_SPACING_M;
  const dx = parameters.dx ?? spacing;
  const dy = parameters.dy ?? spacing;
  const lineOffsetM = parameters.lineOffsetM ?? parameters.offsetM ?? DEFAULT_LINE_OFFSET_M;
  const maxUnits = parameters.maxUnits ?? DEFAULT_MAX_UNITS;
  const prefix = (parameters.prefix ?? "UP").trim() || "UP";
  const startNumber = parameters.startNumber ?? 1;
  const finitePositive = (value: number, label: string) => {
    if (!Number.isFinite(value) || value <= 0) {
      throw new ProspectGridError(`${label} deve ser um número finito maior que zero.`, "INVALID_PARAMETER");
    }
    return value;
  };
  finitePositive(spacing, "spacing");
  finitePositive(dx, "dx");
  finitePositive(dy, "dy");
  if (!Number.isFinite(lineOffsetM) || lineOffsetM < 0) {
    throw new ProspectGridError("lineOffsetM deve ser um número finito não negativo.", "INVALID_PARAMETER");
  }
  if (!Number.isInteger(maxUnits) || maxUnits < 1 || maxUnits > DEFAULT_MAX_UNITS) {
    throw new ProspectGridError(`maxUnits deve ser um inteiro entre 1 e ${DEFAULT_MAX_UNITS}.`, "INVALID_PARAMETER");
  }
  if (!Number.isInteger(startNumber) || startNumber < 1) {
    throw new ProspectGridError("startNumber deve ser um inteiro positivo.", "INVALID_PARAMETER");
  }
  return {
    spacing,
    dx,
    dy,
    lineOffsetM,
    zigzag: parameters.zigzag ?? true,
    maxUnits,
    prefix,
    startNumber,
  };
}

function coordinatesOf(geometry: Geometry): any {
  if (geometry.type === "LineString") return [geometry.coordinates as number[][]];
  if (geometry.type === "MultiLineString") return geometry.coordinates as unknown as number[][][][];
  if (geometry.type === "Polygon") return geometry.coordinates as number[][][];
  if (geometry.type === "MultiPolygon") return geometry.coordinates as number[][][][];
  throw new ProspectGridError(
    `A geometria deve ser Polygon, MultiPolygon, LineString ou MultiLineString; recebido ${geometry.type}.`,
    geometry.type === "Point" ? "UNSUPPORTED_GEOMETRY" : "INVALID_GEOMETRY",
  );
}

function flattenCoordinates(geometry: Geometry): number[][] {
  const coordinates = coordinatesOf(geometry) as any;
  const out: number[][] = [];
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      out.push([value[0], value[1]]);
      return;
    }
    value.forEach(walk);
  };
  walk(coordinates);
  return out;
}

function projectionFor(geometry: Geometry) {
  const coords = flattenCoordinates(geometry);
  if (coords.length < 2) {
    throw new ProspectGridError("A geometria precisa ter pelo menos duas coordenadas válidas.", "INVALID_GEOMETRY");
  }
  // localProjection já aplica a convenção UTM da Atena. MultiLineString não
  // faz parte do helper legado, então uma linha sintética é usada apenas para
  // calcular a zona; nenhum segmento é alterado.
  const lineGeometry: LineString = { type: "LineString", coordinates: coords };
  const feat: Feat = {
    id: 0,
    name: "unidades de prospecção",
    type: "LineString",
    feature: { type: "Feature", properties: {}, geometry: lineGeometry },
  };
  return localProjection([feat]);
}

function projectPosition(position: number[], code: string): XY {
  const projected = proj4("EPSG:4674", code, [position[0], position[1]]);
  return [Number(projected[0]), Number(projected[1])];
}

function unprojectPosition(position: XY, code: string): [number, number] {
  const geographic = proj4(code, "EPSG:4674", position);
  return [Number(geographic[0]), Number(geographic[1])];
}

function closeRing(ring: XY[]): XY[] {
  if (ring.length < 3) throw new ProspectGridError("Anel poligonal sem posições suficientes.", "INVALID_GEOMETRY");
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
}

function projectedPolygons(geometry: Geometry, code: string): ProjectedMultiPolygon {
  const projected = geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.type === "MultiPolygon"
      ? geometry.coordinates
      : null;
  if (!projected) throw new ProspectGridError("A grade poligonal requer Polygon ou MultiPolygon.", "UNSUPPORTED_GEOMETRY");
  return projected.map(polygon => polygon.map(ring => closeRing(ring.map(position => projectPosition(position, code)))));
}

function onSegment(pointXY: XY, a: XY, b: XY): boolean {
  const cross = (pointXY[0] - a[0]) * (b[1] - a[1]) - (pointXY[1] - a[1]) * (b[0] - a[0]);
  if (Math.abs(cross) > 1e-7) return false;
  return pointXY[0] >= Math.min(a[0], b[0]) - 1e-7 && pointXY[0] <= Math.max(a[0], b[0]) + 1e-7 &&
    pointXY[1] >= Math.min(a[1], b[1]) - 1e-7 && pointXY[1] <= Math.max(a[1], b[1]) + 1e-7;
}

/** Ray casting com fronteira incluída; furos são tratados separadamente. */
function pointInRing(pointXY: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (onSegment(pointXY, a, b)) return true;
    const crosses = (a[1] > pointXY[1]) !== (b[1] > pointXY[1]);
    if (crosses && pointXY[0] < ((b[0] - a[0]) * (pointXY[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function pointInPolygons(pointXY: XY, polygons: ProjectedMultiPolygon): boolean {
  return polygons.some(rings => pointInRing(pointXY, rings[0]) && !rings.slice(1).some(hole => pointInRing(pointXY, hole)));
}

function boundsOf(values: XY[]): { minX: number; maxX: number; minY: number; maxY: number } {
  if (values.length === 0) throw new ProspectGridError("Geometria sem coordenadas.", "INVALID_GEOMETRY");
  return {
    minX: Math.min(...values.map(value => value[0])),
    maxX: Math.max(...values.map(value => value[0])),
    minY: Math.min(...values.map(value => value[1])),
    maxY: Math.max(...values.map(value => value[1])),
  };
}

function idFor(prefix: string, number: number): string {
  return `${prefix}-${String(number).padStart(3, "0")}`;
}

function makeUnit(
  projected: XY,
  code: string,
  mode: ProspectMode,
  number: number,
  prefix: string,
  properties: Omit<ProspectUnit["properties"], "id" | "number" | "name" | "mode"> = {},
): ProspectUnit {
  const coordinates = unprojectPosition(projected, code);
  const id = idFor(prefix, number);
  const name = id;
  const storedCoordinates: [number, number] = [coordinates[1], coordinates[0]];
  const unitProperties: ProspectUnit["properties"] = { id, number, name, mode, ...properties };
  return {
    id,
    number,
    name,
    mode,
    coordinates,
    storedCoordinates,
    geometry: point(coordinates, unitProperties),
    properties: unitProperties,
  };
}

function assertBound(count: number, maxUnits: number) {
  if (count > maxUnits) {
    throw new ProspectGridError(
      `A geração produziria ${count} unidades, acima do limite maxUnits=${maxUnits}. Aumente o espaçamento ou reduza a área.`,
      "MAX_UNITS_EXCEEDED",
    );
  }
}

function generatePolygon(
  geometry: Geometry,
  parameters: ProspectGeneration["parameters"],
): ProspectUnit[] {
  const projection = projectionFor(geometry);
  const polygons = projectedPolygons(geometry, projection.code);
  const vertices = polygons.flat(2);
  const bounds = boundsOf(vertices);
  const columns = Math.max(1, Math.floor((bounds.maxX - bounds.minX) / parameters.dx));
  const rows = Math.max(1, Math.floor((bounds.maxY - bounds.minY) / parameters.dy));
  assertBound(columns * rows, parameters.maxUnits);
  const units: ProspectUnit[] = [];
  for (let row = 0; row < rows; row++) {
    const y = bounds.minY + (row + 0.5) * parameters.dy;
    for (let column = 0; column < columns; column++) {
      const x = bounds.minX + (column + 0.5) * parameters.dx;
      if (!pointInPolygons([x, y], polygons)) continue;
      const number = parameters.startNumber + units.length;
      units.push(makeUnit([x, y], projection.code, "polygon", number, parameters.prefix, { row, column }));
    }
  }
  assertBound(units.length, parameters.maxUnits);
  return units;
}

type ProjectedLine = XY[];

function projectedLines(geometry: Geometry, code: string): ProjectedLine[] {
  if (geometry.type === "LineString") return [geometry.coordinates.map(position => projectPosition(position, code))];
  if (geometry.type === "MultiLineString") return geometry.coordinates.map(line => line.map(position => projectPosition(position, code)));
  throw new ProspectGridError("A geração linear requer LineString ou MultiLineString.", "UNSUPPORTED_GEOMETRY");
}

function lineLength(line: ProjectedLine): number {
  let length = 0;
  for (let i = 1; i < line.length; i++) length += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  return length;
}

function positionAt(line: ProjectedLine, distance: number): { position: XY; tangent: XY } {
  let left = distance;
  for (let i = 1; i < line.length; i++) {
    const dx = line[i][0] - line[i - 1][0];
    const dy = line[i][1] - line[i - 1][1];
    const segmentLength = Math.hypot(dx, dy);
    if (segmentLength === 0) continue;
    if (left <= segmentLength || i === line.length - 1) {
      const ratio = Math.max(0, Math.min(1, left / segmentLength));
      return {
        position: [line[i - 1][0] + dx * ratio, line[i - 1][1] + dy * ratio],
        tangent: [dx / segmentLength, dy / segmentLength],
      };
    }
    left -= segmentLength;
  }
  const last = line[line.length - 1];
  const previous = line[line.length - 2] ?? last;
  const dx = last[0] - previous[0], dy = last[1] - previous[1], length = Math.hypot(dx, dy) || 1;
  return { position: last, tangent: [dx / length, dy / length] };
}

function generateLine(
  geometry: Geometry,
  parameters: ProspectGeneration["parameters"],
): ProspectUnit[] {
  const projection = projectionFor(geometry);
  const lines = projectedLines(geometry, projection.code);
  const counts = lines.map(line => Math.max(1, Math.floor(lineLength(line) / parameters.spacing) + 1));
  assertBound(counts.reduce((sum, count) => sum + count, 0), parameters.maxUnits);
  const units: ProspectUnit[] = [];
  for (let part = 0; part < lines.length; part++) {
    const line = lines[part];
    if (line.length < 2 || lineLength(line) === 0) continue;
    for (let i = 0; i < counts[part]; i++) {
      const station = i * parameters.spacing;
      const { position, tangent } = positionAt(line, station);
      const side = !parameters.zigzag ? "center" : (units.length % 2 === 0 ? "left" : "right");
      const sign = side === "left" ? 1 : side === "right" ? -1 : 0;
      const offset = parameters.lineOffsetM * sign;
      const offsetPosition: XY = [position[0] - tangent[1] * offset, position[1] + tangent[0] * offset];
      const number = parameters.startNumber + units.length;
      units.push(makeUnit(offsetPosition, projection.code, "line", number, parameters.prefix, {
        side,
        sourcePart: part,
      }));
    }
  }
  assertBound(units.length, parameters.maxUnits);
  return units;
}

export function exportGeoJSON(unitsOrGeneration: ProspectUnit[] | ProspectGeneration): FeatureCollection<Point> {
  const units = Array.isArray(unitsOrGeneration) ? unitsOrGeneration : unitsOrGeneration.units;
  return {
    type: "FeatureCollection",
    features: units.map(unit => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: unit.coordinates },
      properties: { ...unit.properties },
    })),
  };
}

export function generateProspectionUnits(
  input: ProspectGeometry | { geometry: ProspectGeometry; parameters?: ProspectGridParameters },
  parameters: ProspectGridParameters = {},
): ProspectGeneration {
  const normalized = normalizeInput(input, parameters);
  const geometry = geometryOf(normalized.geometry);
  const normalizedParameters = normalizeParameters(normalized.parameters);
  coordinatesOf(geometry);
  const mode: ProspectMode = geometry.type === "Polygon" || geometry.type === "MultiPolygon" ? "polygon" :
    geometry.type === "LineString" || geometry.type === "MultiLineString" ? "line" : "polygon";
  const units = mode === "polygon" ? generatePolygon(geometry, normalizedParameters) : generateLine(geometry, normalizedParameters);
  const result: ProspectGeneration = {
    mode,
    units,
    count: units.length,
    parameters: normalizedParameters,
    geojson: { type: "FeatureCollection", features: [] },
  };
  result.geojson = exportGeoJSON(result);
  return result;
}

/** Alias nominal para consumidores que chamam a operação de grade. */
export const generateProspectionGrid = generateProspectionUnits;
export const generateProspectionGridForPolygon = generateProspectionUnits;
export const generateProspectionGridForLine = generateProspectionUnits;
