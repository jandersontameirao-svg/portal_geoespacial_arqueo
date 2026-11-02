import { describe, expect, it } from "vitest";
import {
  collectCoordinatePositions,
  normalizeStoredPolygonCoordinates,
  storedPolygonToGeoJSON,
  swapCoordinateOrderTree,
  validateClosedPolygonCoordinates,
  validatePolygonCoordinates,
  validateStoredGeometryCoordinates,
} from "../../shared/geometry-coordinates";

const exteriorA = [
  [-23.5, -46.6],
  [-23.5, -46.59],
  [-23.49, -46.59],
  [-23.49, -46.6],
];
const holeA = [
  [-23.498, -46.598],
  [-23.498, -46.596],
  [-23.496, -46.596],
  [-23.496, -46.598],
];

describe("coordenadas poligonais armazenadas", () => {
  it("normaliza o anel legado como Polygon sem alterar posições", () => {
    const shape = normalizeStoredPolygonCoordinates(exteriorA);
    expect(shape.type).toBe("Polygon");
    expect(shape.coordinates).toEqual([exteriorA]);
  });

  it("preserva o exterior e todos os anéis internos de Polygon", () => {
    const shape = normalizeStoredPolygonCoordinates([exteriorA, holeA]);
    expect(shape.type).toBe("Polygon");
    expect(shape.coordinates).toEqual([exteriorA, holeA]);
  });

  it("preserva cada componente e furo de MultiPolygon", () => {
    const exteriorB = exteriorA.map(([lat, lng]) => [lat + 0.02, lng + 0.02]);
    const holeB = holeA.map(([lat, lng]) => [lat + 0.02, lng + 0.02]);
    const shape = normalizeStoredPolygonCoordinates([[exteriorA, holeA], [exteriorB, holeB]]);
    expect(shape.type).toBe("MultiPolygon");
    expect(shape.coordinates).toEqual([[exteriorA, holeA], [exteriorB, holeB]]);
  });

  it("converte todos os anéis para GeoJSON [lng,lat] e coleta cada vértice", () => {
    const geometry = storedPolygonToGeoJSON([exteriorA, holeA]);
    expect(geometry.type).toBe("Polygon");
    const coordinates = geometry.coordinates as number[][][];
    expect(coordinates[0]).toEqual([...exteriorA.map(([lat, lng]) => [lng, lat]), [-46.6, -23.5]]);
    expect(coordinates[1]).toEqual([...holeA.map(([lat, lng]) => [lng, lat]), [-46.598, -23.498]]);
    expect(collectCoordinatePositions([exteriorA, holeA])).toHaveLength(exteriorA.length + holeA.length);
  });

  it("fecha exterior e furos ao converter MultiPolygon para GeoJSON", () => {
    const secondExterior = exteriorA.map(([lat, lng]) => [lat + 0.02, lng + 0.02]);
    const geometry = storedPolygonToGeoJSON([[exteriorA, holeA], [secondExterior, holeA.map(([lat, lng]) => [lat + 0.02, lng + 0.02])]]);
    expect(geometry.type).toBe("MultiPolygon");
    const coordinates = geometry.coordinates as number[][][][];
    expect(coordinates).toHaveLength(2);
    for (const polygon of coordinates) {
      for (const ring of polygon) expect(ring[0]).toEqual(ring[ring.length - 1]);
    }
  });

  it("rejeita anel externo aberto sem corrigi-lo silenciosamente", () => {
    expect(() => validateClosedPolygonCoordinates([exteriorA])).toThrow(/não está fechado/i);
  });

  it("rejeita furo fora do exterior e componente MultiPolygon sobreposto", () => {
    const outsideHole = [
      [-23.505, -46.605], [-23.505, -46.604], [-23.504, -46.604],
      [-23.504, -46.605], [-23.505, -46.605],
    ];
    expect(() => normalizeStoredPolygonCoordinates([exteriorA, outsideHole]))
      .toThrow(/fora ou toca o anel exterior/i);
    const overlappingExterior = exteriorA.map(([lat, lng]) => [lat + 0.001, lng + 0.001]);
    expect(() => normalizeStoredPolygonCoordinates([[exteriorA], [overlappingExterior]]))
      .toThrow(/interiores sobrepostos|fronteiras cruzadas|segmento de fronteira compartilhado/i);
  });

  it("permite componentes MultiPolygon que compartilham somente o vértice (1,1)", () => {
    const first = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
    const second = [[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]];
    const shape = normalizeStoredPolygonCoordinates([[first], [second]]);
    expect(shape.type).toBe("MultiPolygon");
    expect(shape.coordinates).toEqual([[first], [second]]);
  });

  it("permite contato pontual no interior de uma aresta sem sobreposição de interiores", () => {
    const square = [[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]];
    const triangle = [[1, 2], [0.5, 3], [1.5, 3], [1, 2]];
    const shape = normalizeStoredPolygonCoordinates([[square], [triangle]]);
    expect(shape.type).toBe("MultiPolygon");
    expect(shape.coordinates).toEqual([[square], [triangle]]);
  });

  it("rejeita cruzamento, interior contido e segmento de fronteira compartilhado", () => {
    const square = [[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]];
    const crossing = [[0.5, 1], [1, 2.5], [1.5, 1], [1, 0.5], [0.5, 1]];
    const contained = [[0.5, 0.5], [0.5, 1.5], [1.5, 1.5], [1.5, 0.5], [0.5, 0.5]];
    const sharedSegment = [[0, 2], [0, 3], [2, 3], [2, 2], [0, 2]];
    const topologyError = /interiores sobrepostos|fronteiras cruzadas|segmento de fronteira compartilhado/i;

    expect(() => normalizeStoredPolygonCoordinates([[square], [crossing]])).toThrow(topologyError);
    expect(() => normalizeStoredPolygonCoordinates([[square], [contained]])).toThrow(topologyError);
    expect(() => normalizeStoredPolygonCoordinates([[square], [sharedSegment]])).toThrow(topologyError);
  });

  it("permite componente de MultiPolygon inteiramente dentro de um furo disjunto", () => {
    const island = [
      [-23.4977, -46.5977], [-23.4977, -46.5963], [-23.4963, -46.5963],
      [-23.4963, -46.5977], [-23.4977, -46.5977],
    ];
    const shape = normalizeStoredPolygonCoordinates([[exteriorA, holeA], [island]]);
    expect(shape.type).toBe("MultiPolygon");
    expect(shape.coordinates).toEqual([[exteriorA, holeA], [island]]);
  });

  it("rejeita anel autointersectante e latitude fora do intervalo WGS84", () => {
    const bowTie = [
      [-23.5, -46.6], [-23.49, -46.59], [-23.5, -46.59],
      [-23.49, -46.6], [-23.5, -46.6],
    ];
    expect(() => normalizeStoredPolygonCoordinates([bowTie]))
      .toThrow(/área nula|autointersectante/i);
    const invalidLatitude = [[95, 10], [95, 11], [94, 11], [94, 10], [95, 10]];
    expect(() => validatePolygonCoordinates([invalidLatitude], { requireClosed: true }))
      .toThrow(/latitude fora do intervalo WGS84/i);
  });

  it("valida fechamentos KML em ordem GeoJSON sem inverter a checagem de faixas", () => {
    const geoJsonRing = [[
      [-46.6, -23.5], [-46.59, -23.5], [-46.59, -23.49],
      [-46.6, -23.49], [-46.6, -23.5],
    ]];
    expect(validateClosedPolygonCoordinates(geoJsonRing, "geojson-lng-lat").type).toBe("Polygon");
  });

  it("valida payloads de marker, polyline e Polygon antes de gravação server-side", () => {
    expect(() => validateStoredGeometryCoordinates("marker", [91, 10]))
      .toThrow(/latitude fora do intervalo WGS84/i);
    expect(() => validateStoredGeometryCoordinates("polyline", [[-23.5, -46.6]]))
      .toThrow(/coordenadas da linha inválidas/i);
    expect(() => validateStoredGeometryCoordinates("polygon", [exteriorA], { requireClosed: true }))
      .toThrow(/não está fechado/i);
    expect(() => validateStoredGeometryCoordinates("polyline", [[-23.5, -46.6], [-23.49, -46.59]]))
      .not.toThrow();
  });

  it("troca recursivamente a ordem e mantém a terceira ordenada", () => {
    expect(swapCoordinateOrderTree([[-46.6, -23.5, 740]])).toEqual([[-23.5, -46.6, 740]]);
  });

  it("rejeita arrays vazios, posições não finitas e estruturas poligonais malformadas", () => {
    expect(() => swapCoordinateOrderTree([])).toThrow(/vazia ou inválida/i);
    expect(() => normalizeStoredPolygonCoordinates([[[-23.5, Number.NaN], [-23.4, -46.5], [-23.3, -46.4]]])).toThrow(/inválido/i);
    expect(() => normalizeStoredPolygonCoordinates([[[1, 2], [3, 4]]])).toThrow(/inválido/i);
  });
});
