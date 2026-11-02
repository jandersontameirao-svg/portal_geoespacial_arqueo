export type CoordinatePosition = number[];
export type PolygonRingCoordinates = CoordinatePosition[];
export type PolygonCoordinates = PolygonRingCoordinates[];
export type MultiPolygonCoordinates = PolygonCoordinates[];
export type PolygonCoordinateOrder = "stored-lat-lng" | "geojson-lng-lat";

export type StoredPolygonShape =
  | { type: "Polygon"; coordinates: PolygonCoordinates }
  | { type: "MultiPolygon"; coordinates: MultiPolygonCoordinates };

export interface PolygonValidationOptions {
  coordinateOrder?: PolygonCoordinateOrder;
  requireClosed?: boolean;
}

interface XY {
  x: number;
  y: number;
}

function isPosition(value: unknown): value is CoordinatePosition {
  return Array.isArray(value) && value.length >= 2 &&
    value.every(ordinate => typeof ordinate === "number" && Number.isFinite(ordinate));
}

function isRing(value: unknown): value is PolygonRingCoordinates {
  return Array.isArray(value) && value.length >= 3 && value.every(isPosition);
}

function isPolygon(value: unknown): value is PolygonCoordinates {
  return Array.isArray(value) && value.length > 0 && value.every(isRing);
}

function nearlyEqual(a: number, b: number): boolean {
  const tolerance = Number.EPSILON * 32 * Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= tolerance;
}

function samePoint(a: XY, b: XY): boolean {
  return nearlyEqual(a.x, b.x) && nearlyEqual(a.y, b.y);
}

function toXY(position: CoordinatePosition): XY {
  // Topology is invariant to swapping axes; the stored order is [lat,lng].
  return { x: position[1], y: position[0] };
}

function orientation(a: XY, b: XY, c: XY): -1 | 0 | 1 {
  const left = (b.x - a.x) * (c.y - a.y);
  const right = (b.y - a.y) * (c.x - a.x);
  const value = left - right;
  const tolerance = Number.EPSILON * 64 * Math.max(Math.abs(left), Math.abs(right), Number.MIN_VALUE);
  if (Math.abs(value) <= tolerance) return 0;
  return value > 0 ? 1 : -1;
}

function pointOnSegment(point: XY, start: XY, end: XY): boolean {
  if (orientation(start, end, point) !== 0) return false;
  const tolerance = Number.EPSILON * 64 * Math.max(
    1, Math.abs(point.x), Math.abs(point.y), Math.abs(start.x), Math.abs(start.y), Math.abs(end.x), Math.abs(end.y),
  );
  return point.x >= Math.min(start.x, end.x) - tolerance &&
    point.x <= Math.max(start.x, end.x) + tolerance &&
    point.y >= Math.min(start.y, end.y) - tolerance &&
    point.y <= Math.max(start.y, end.y) + tolerance;
}

type SegmentRelation = "none" | "point" | "crossing" | "overlap";

interface SegmentRef {
  componentIndex: number;
  ringIndex: number;
  segmentIndex: number;
  segmentCount: number;
  start: XY;
  end: XY;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  contactParameters: number[];
}

function coordinateTolerance(...values: number[]): number {
  return Number.EPSILON * 128 * Math.max(1, ...values.map(Math.abs));
}

function segmentRelation(a: XY, b: XY, c: XY, d: XY): SegmentRelation {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  const opposite = (left: -1 | 0 | 1, right: -1 | 0 | 1) =>
    (left === -1 && right === 1) || (left === 1 && right === -1);

  if (opposite(abC, abD) && opposite(cdA, cdB)) return "crossing";

  const touches = (abC === 0 && pointOnSegment(c, a, b)) ||
    (abD === 0 && pointOnSegment(d, a, b)) ||
    (cdA === 0 && pointOnSegment(a, c, d)) ||
    (cdB === 0 && pointOnSegment(b, c, d));
  if (!touches) return "none";

  if (abC === 0 && abD === 0 && cdA === 0 && cdB === 0) {
    const axis: "x" | "y" = Math.max(Math.abs(b.x - a.x), Math.abs(d.x - c.x)) >=
      Math.max(Math.abs(b.y - a.y), Math.abs(d.y - c.y)) ? "x" : "y";
    const overlapLength = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) -
      Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
    const tolerance = coordinateTolerance(a[axis], b[axis], c[axis], d[axis]);
    if (overlapLength > tolerance) return "overlap";
    if (overlapLength < -tolerance) return "none";
  }
  return "point";
}

function createSegmentRefs(rings: XY[][], componentIndex: number): SegmentRef[] {
  const segments: SegmentRef[] = [];
  for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
    const ring = rings[ringIndex];
    for (let segmentIndex = 0; segmentIndex < ring.length; segmentIndex++) {
      const start = ring[segmentIndex];
      const end = ring[(segmentIndex + 1) % ring.length];
      segments.push({
        componentIndex,
        ringIndex,
        segmentIndex,
        segmentCount: ring.length,
        start,
        end,
        minX: Math.min(start.x, end.x),
        maxX: Math.max(start.x, end.x),
        minY: Math.min(start.y, end.y),
        maxY: Math.max(start.y, end.y),
        contactParameters: [],
      });
    }
  }
  return segments;
}

function forEachSweepPair(segments: SegmentRef[], predicate: (a: SegmentRef, b: SegmentRef) => boolean): boolean {
  const ordered = [...segments].sort((a, b) => a.minX - b.minX || a.minY - b.minY ||
    a.componentIndex - b.componentIndex || a.ringIndex - b.ringIndex || a.segmentIndex - b.segmentIndex);
  const active: SegmentRef[] = [];
  for (const current of ordered) {
    let index = active.length - 1;
    while (index >= 0) {
      const previous = active[index];
      if (previous.maxX < current.minX - coordinateTolerance(previous.maxX, current.minX)) {
        const lastIndex = active.length - 1;
        if (index !== lastIndex) active[index] = active[lastIndex];
        active.pop();
        if (index >= active.length) index = active.length - 1;
      } else {
        index--;
      }
    }
    for (const previous of active) {
      const yTolerance = coordinateTolerance(previous.minY, previous.maxY, current.minY, current.maxY);
      if (previous.maxY < current.minY - yTolerance || current.maxY < previous.minY - yTolerance) continue;
      if (predicate(previous, current)) return true;
    }
    active.push(current);
  }
  return false;
}

function contactPoints(a: SegmentRef, b: SegmentRef): XY[] {
  const candidates = [a.start, a.end, b.start, b.end].filter(point =>
    pointOnSegment(point, a.start, a.end) && pointOnSegment(point, b.start, b.end),
  );
  return candidates.filter((point, index) => !candidates.slice(0, index).some(previous => samePoint(point, previous)));
}

function parameterOnSegment(point: XY, segment: SegmentRef): number {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const parameter = Math.abs(dx) >= Math.abs(dy)
    ? (point.x - segment.start.x) / dx
    : (point.y - segment.start.y) / dy;
  return Math.max(0, Math.min(1, parameter));
}

function recordPointContact(a: SegmentRef, b: SegmentRef): void {
  for (const point of contactPoints(a, b)) {
    a.contactParameters.push(parameterOnSegment(point, a));
    b.contactParameters.push(parameterOnSegment(point, b));
  }
}

function ringBoundarySamples(segments: SegmentRef[]): XY[] {
  const ordered = [...segments].sort((a, b) => a.segmentIndex - b.segmentIndex);
  if (ordered.length === 0) return [];
  const lengths = ordered.map(segment => Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y));
  const cumulative = [0];
  for (const length of lengths) cumulative.push(cumulative[cumulative.length - 1] + length);
  const perimeter = cumulative[cumulative.length - 1];
  const tolerance = coordinateTolerance(perimeter);
  const positions = ordered.flatMap((segment, index) => segment.contactParameters.map(parameter =>
    cumulative[index] + parameter * lengths[index],
  )).sort((a, b) => a - b);
  const contacts: number[] = [];
  for (const position of positions) {
    if (contacts.length === 0 || position - contacts[contacts.length - 1] > tolerance) contacts.push(position);
  }
  if (contacts.length === 0) return [ordered[0].start];

  const pointAt = (distance: number): XY => {
    const wrapped = ((distance % perimeter) + perimeter) % perimeter;
    let low = 0, high = ordered.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (cumulative[middle + 1] < wrapped) low = middle + 1;
      else high = middle;
    }
    const segment = ordered[low];
    const parameter = (wrapped - cumulative[low]) / lengths[low];
    return {
      x: segment.start.x + (segment.end.x - segment.start.x) * parameter,
      y: segment.start.y + (segment.end.y - segment.start.y) * parameter,
    };
  };

  const samples: XY[] = [];
  for (let index = 0; index < contacts.length; index++) {
    const start = contacts[index];
    const end = index + 1 < contacts.length ? contacts[index + 1] : contacts[0] + perimeter;
    if (end - start > tolerance) samples.push(pointAt((start + end) / 2));
  }
  return samples.length > 0 ? samples : [ordered[0].start];
}

function ringPoints(ring: PolygonRingCoordinates, label: string): XY[] {
  const points = ring.map(toXY);
  if (points.length > 1 && samePoint(points[0], points[points.length - 1])) points.pop();
  if (points.length < 3) throw new Error(`${label}: anel precisa de pelo menos três vértices distintos.`);
  for (let i = 0; i < points.length; i++) {
    if (samePoint(points[i], points[(i + 1) % points.length])) {
      throw new Error(`${label}: anel contém segmento degenerado.`);
    }
  }

  let twiceArea = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
    minX = Math.min(minX, current.x); maxX = Math.max(maxX, current.x);
    minY = Math.min(minY, current.y); maxY = Math.max(maxY, current.y);
  }
  const bboxArea = (maxX - minX) * (maxY - minY);
  const areaTolerance = Number.EPSILON * 64 * Math.max(bboxArea, Number.MIN_VALUE);
  if (Math.abs(twiceArea) <= areaTolerance) throw new Error(`${label}: área nula ou numericamente degenerada.`);

  const segments = createSegmentRefs([points], 0);
  const selfIntersects = forEachSweepPair(segments, (a, b) => {
    if (a.componentIndex === b.componentIndex && a.ringIndex === b.ringIndex) {
      const delta = Math.abs(a.segmentIndex - b.segmentIndex);
      if (delta === 1 || delta === a.segmentCount - 1) return false;
    }
    return segmentRelation(a.start, a.end, b.start, b.end) !== "none";
  });
  if (selfIntersects) throw new Error(`${label}: anel autointersectante.`);
  return points;
}

function ringsIntersect(a: XY[], b: XY[]): boolean {
  const segments = [...createSegmentRefs([a], 0), ...createSegmentRefs([b], 1)];
  return forEachSweepPair(segments, (left, right) =>
    left.componentIndex !== right.componentIndex &&
    segmentRelation(left.start, left.end, right.start, right.end) !== "none",
  );
}

function pointStrictlyInsideRing(point: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if (pointOnSegment(point, a, b)) return false;
    const crosses = (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointOnRingBoundary(point: XY, ring: XY[]): boolean {
  for (let i = 0; i < ring.length; i++) {
    if (pointOnSegment(point, ring[i], ring[(i + 1) % ring.length])) return true;
  }
  return false;
}

function pointStrictlyInsidePolygon(point: XY, rings: XY[][]): boolean {
  if (!pointStrictlyInsideRing(point, rings[0])) return false;
  return !rings.slice(1).some(hole =>
    pointStrictlyInsideRing(point, hole) || pointOnRingBoundary(point, hole),
  );
}

function validatePolygonTopology(shape: StoredPolygonShape): void {
  const polygons = shape.type === "Polygon" ? [shape.coordinates] : shape.coordinates;
  const validated = polygons.map((polygon, polygonIndex) => {
    if (polygon.length === 0) throw new Error(`Polígono ${polygonIndex + 1} sem anel exterior.`);
    const rings = polygon.map((ring, ringIndex) => ringPoints(
      ring,
      ringIndex === 0
        ? `Polígono ${polygonIndex + 1}, anel exterior`
        : `Polígono ${polygonIndex + 1}, furo ${ringIndex}`,
    ));
    const exterior = rings[0];
    for (let i = 1; i < rings.length; i++) {
      const hole = rings[i];
      if (ringsIntersect(exterior, hole) || !pointStrictlyInsideRing(hole[0], exterior)) {
        throw new Error(`Polígono ${polygonIndex + 1}, furo ${i}: está fora ou toca o anel exterior.`);
      }
      for (let previous = 1; previous < i; previous++) {
        const otherHole = rings[previous];
        if (ringsIntersect(otherHole, hole) ||
            pointStrictlyInsideRing(hole[0], otherHole) ||
            pointStrictlyInsideRing(otherHole[0], hole)) {
          throw new Error(`Polígono ${polygonIndex + 1}: furos sobrepostos ou aninhados.`);
        }
      }
    }
    return rings;
  });

  for (let i = 0; i < validated.length; i++) {
    for (let j = i + 1; j < validated.length; j++) {
      const a = validated[i], b = validated[j];
      const aSegments = createSegmentRefs(a, 0);
      const bSegments = createSegmentRefs(b, 1);
      const invalidBoundaryInteraction = forEachSweepPair([...aSegments, ...bSegments], (left, right) => {
        if (left.componentIndex === right.componentIndex) return false;
        const relation = segmentRelation(left.start, left.end, right.start, right.end);
        if (relation === "crossing" || relation === "overlap") return true;
        if (relation === "point") recordPointContact(left, right);
        return false;
      });
      const aExteriorSegments = aSegments.filter(segment => segment.ringIndex === 0);
      const bExteriorSegments = bSegments.filter(segment => segment.ringIndex === 0);
      const interiorsOverlap = ringBoundarySamples(aExteriorSegments).some(point => pointStrictlyInsidePolygon(point, b)) ||
        ringBoundarySamples(bExteriorSegments).some(point => pointStrictlyInsidePolygon(point, a));
      if (invalidBoundaryInteraction || interiorsOverlap) {
        throw new Error(`MultiPolygon: os componentes ${i + 1} e ${j + 1} têm interiores sobrepostos, fronteiras cruzadas ou segmento de fronteira compartilhado.`);
      }
    }
  }
}

/**
 * Normalize the persisted representation used by geometry rows.
 * Legacy flat rings remain readable; nested Polygon and MultiPolygon ring sets
 * retain every exterior, interior ring, and component. Invalid topology fails
 * explicitly instead of being silently rendered or omitted.
 */
export function normalizeStoredPolygonCoordinates(value: unknown): StoredPolygonShape {
  let shape: StoredPolygonShape;
  if (isRing(value)) {
    shape = { type: "Polygon", coordinates: [value] };
  } else if (isPolygon(value)) {
    shape = { type: "Polygon", coordinates: value };
  } else if (Array.isArray(value) && value.length > 0 && value.every(isPolygon)) {
    shape = { type: "MultiPolygon", coordinates: value };
  } else {
    throw new Error("Coordenadas poligonais armazenadas em formato inválido.");
  }
  validatePolygonTopology(shape);
  return shape;
}

/** Validate topology, WGS84 ranges and optionally GeoJSON/KML ring closure. */
export function validatePolygonCoordinates(
  value: unknown,
  options: PolygonValidationOptions = {},
): StoredPolygonShape {
  const shape = normalizeStoredPolygonCoordinates(value);
  const coordinateOrder = options.coordinateOrder ?? "stored-lat-lng";
  const polygons = shape.type === "Polygon" ? [shape.coordinates] : shape.coordinates;
  for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex++) {
    for (let ringIndex = 0; ringIndex < polygons[polygonIndex].length; ringIndex++) {
      const ring = polygons[polygonIndex][ringIndex];
      for (const position of ring) {
        const latitude = coordinateOrder === "stored-lat-lng" ? position[0] : position[1];
        const longitude = coordinateOrder === "stored-lat-lng" ? position[1] : position[0];
        if (latitude < -90 || latitude > 90) {
          throw new Error(`Polígono ${polygonIndex + 1}, anel ${ringIndex + 1}: latitude fora do intervalo WGS84.`);
        }
        if (longitude < -180 || longitude > 180) {
          throw new Error(`Polígono ${polygonIndex + 1}, anel ${ringIndex + 1}: longitude fora do intervalo WGS84.`);
        }
      }
      if (options.requireClosed) {
        const first = ring[0], last = ring[ring.length - 1];
        if (ring.length < 4 || first.length !== last.length || first.some((ordinate, index) => ordinate !== last[index])) {
          const label = ringIndex === 0 ? "anel exterior" : `furo ${ringIndex}`;
          throw new Error(`Polígono ${polygonIndex + 1}, ${label} não está fechado.`);
        }
      }
    }
  }
  return shape;
}

/** Validate any stored geometry payload before client/server persistence. */
export function validateStoredGeometryCoordinates(
  type: "marker" | "polyline" | "polygon",
  value: unknown,
  options: PolygonValidationOptions = {},
): void {
  if (type === "polygon") {
    validatePolygonCoordinates(value, options);
    return;
  }
  const positions = type === "marker"
    ? (isPosition(value) ? [value] : [])
    : (Array.isArray(value) && value.every(isPosition) ? value : []);
  if (positions.length < (type === "marker" ? 1 : 2)) {
    throw new Error(type === "marker" ? "Coordenadas do marcador inválidas." : "Coordenadas da linha inválidas.");
  }
  for (const position of positions) {
    const [latitude, longitude] = position;
    if (latitude < -90 || latitude > 90) throw new Error("Latitude fora do intervalo WGS84.");
    if (longitude < -180 || longitude > 180) throw new Error("Longitude fora do intervalo WGS84.");
  }
}

/** Validate GeoJSON/KML linear-ring closure without changing the input geometry. */
export function validateClosedPolygonCoordinates(
  value: unknown,
  coordinateOrder: PolygonCoordinateOrder = "stored-lat-lng",
): StoredPolygonShape {
  return validatePolygonCoordinates(value, { coordinateOrder, requireClosed: true });
}

/**
 * Recursively swaps the first two ordinates of every coordinate position.
 * The remaining ordinates (for example altitude) are retained unchanged.
 */
export function swapCoordinateOrderTree(value: unknown): unknown {
  if (isPosition(value)) return [value[1], value[0], ...value.slice(2)];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Estrutura de coordenadas vazia ou inválida.");
  }
  return value.map(swapCoordinateOrderTree);
}

/** Collect every coordinate position in a nested GeoJSON coordinate array. */
export function collectCoordinatePositions(value: unknown, output: CoordinatePosition[] = []): CoordinatePosition[] {
  if (isPosition(value)) {
    output.push(value);
    return output;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Estrutura de coordenadas vazia ou inválida.");
  }
  for (const child of value) collectCoordinatePositions(child, output);
  return output;
}

function closeStoredRing(ring: PolygonRingCoordinates): PolygonRingCoordinates {
  const first = ring[0];
  const last = ring[ring.length - 1];
  const isClosed = first.length === last.length && first.every((ordinate, index) => ordinate === last[index]);
  return isClosed ? ring : [...ring, [...first]];
}

/** Convert stored [lat,lng] polygon coordinates to a GeoJSON geometry. */
export function storedPolygonToGeoJSON(value: unknown):
  | { type: "Polygon"; coordinates: unknown }
  | { type: "MultiPolygon"; coordinates: unknown } {
  const shape = validatePolygonCoordinates(value, { coordinateOrder: "stored-lat-lng" });
  if (shape.type === "Polygon") {
    const closedRings = shape.coordinates.map(closeStoredRing);
    return { type: "Polygon", coordinates: swapCoordinateOrderTree(closedRings) };
  }
  const closedPolygons = shape.coordinates.map(polygon => polygon.map(closeStoredRing));
  return { type: "MultiPolygon", coordinates: swapCoordinateOrderTree(closedPolygons) };
}
