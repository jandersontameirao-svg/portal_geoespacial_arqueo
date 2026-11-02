import { describe, expect, it } from "vitest";
import { normalizeShapefileResult } from "./geodataService";

const pointFeature = {
  type: "Feature" as const,
  geometry: { type: "Point", coordinates: [-47.93, -15.78] },
  properties: { nome: "Feição de teste" },
};

describe("normalização de Shapefile", () => {
  it("normaliza uma FeatureCollection única para GeoJSON utilizável no mapa", () => {
    const result = normalizeShapefileResult({ type: "FeatureCollection", features: [pointFeature] });
    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.type).toBe("Point");
  });

  it("agrega múltiplas coleções retornadas por um ZIP com várias camadas", () => {
    const result = normalizeShapefileResult([
      { type: "FeatureCollection", features: [pointFeature] },
      { type: "FeatureCollection", features: [{ ...pointFeature, properties: { nome: "Outra" } }] },
    ]);
    expect(result.features).toHaveLength(2);
  });

  it("rejeita ZIP sem feições legíveis", () => {
    expect(() => normalizeShapefileResult({ type: "FeatureCollection", features: [] })).toThrow("não contém feições");
  });
});
