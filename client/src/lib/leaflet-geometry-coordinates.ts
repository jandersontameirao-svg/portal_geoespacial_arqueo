type CoordinatePosition = number[];

function isCoordinatePosition(value: unknown): value is CoordinatePosition {
  return Array.isArray(value)
    && value.length >= 2
    && value.every((ordinate) => typeof ordinate === "number" && Number.isFinite(ordinate));
}

function samePosition(left: CoordinatePosition, right: CoordinatePosition): boolean {
  return left.length === right.length && left.every((ordinate, index) => ordinate === right[index]);
}

/**
 * Leaflet polygons close their rings visually but often return open LatLng arrays.
 * This helper adds only the implicit closing position, preserving every vertex,
 * every interior ring and all Polygon/MultiPolygon nesting.
 */
export function closeLeafletPolygonRings(value: unknown): unknown {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("A estrutura de anéis do desenho está vazia ou inválida.");
  }

  if (value.every(isCoordinatePosition)) {
    const ring = value.map((position) => [...position]);
    if (samePosition(ring[0], ring[ring.length - 1])) return ring;
    return [...ring, [...ring[0]]];
  }

  if (!value.every(Array.isArray)) {
    throw new Error("O desenho contém uma posição ou um anel inválido.");
  }

  return value.map(closeLeafletPolygonRings);
}
