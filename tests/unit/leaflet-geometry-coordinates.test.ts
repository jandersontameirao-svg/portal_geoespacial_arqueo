import { describe, expect, it } from "vitest";
import { closeLeafletPolygonRings } from "../../client/src/lib/leaflet-geometry-coordinates";

const openExterior = [
  [-15.781, -47.931],
  [-15.781, -47.924],
  [-15.774, -47.923],
];

const openHole = [
  [-15.780, -47.930],
  [-15.780, -47.928],
  [-15.779, -47.928],
];

describe("closeLeafletPolygonRings", () => {
  it("closes the implicit exterior ring without losing any vertex", () => {
    const closed = closeLeafletPolygonRings(openExterior) as number[][];
    expect(closed).toEqual([...openExterior, openExterior[0]]);
    expect(closed).toHaveLength(openExterior.length + 1);
  });

  it("preserves and closes both the exterior and interior ring", () => {
    const polygon = closeLeafletPolygonRings([openExterior, openHole]) as number[][][];
    expect(polygon).toEqual([
      [...openExterior, openExterior[0]],
      [...openHole, openHole[0]],
    ]);
    expect(polygon).toHaveLength(2);
  });

  it("preserves all components and rings in nested MultiPolygon coordinates", () => {
    const secondExterior = [
      [-15.770, -47.920],
      [-15.770, -47.918],
      [-15.768, -47.918],
    ];
    const multi = closeLeafletPolygonRings([
      [openExterior, openHole],
      [secondExterior],
    ]) as number[][][][];
    expect(multi).toEqual([
      [[...openExterior, openExterior[0]], [...openHole, openHole[0]]],
      [[...secondExterior, secondExterior[0]]],
    ]);
    expect(multi).toHaveLength(2);
  });

  it("does not add a duplicate when the ring is already closed", () => {
    const alreadyClosed = [...openExterior, openExterior[0]];
    expect(closeLeafletPolygonRings(alreadyClosed)).toEqual(alreadyClosed);
  });

  it("fails explicitly for empty or malformed rings instead of dropping positions", () => {
    expect(() => closeLeafletPolygonRings([])).toThrow(/vazia ou inválida/);
    expect(() => closeLeafletPolygonRings([[0, Number.NaN], [1, 2], [3, 4]])).toThrow(/posição ou um anel inválido/);
  });
});
