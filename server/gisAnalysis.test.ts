import { describe, expect, it } from "vitest";
import { polygon, point } from "@turf/helpers";
import { executeAnalysis } from "./gisAnalysis";

const areaA = polygon([[[-48.0, -16.0], [-47.98, -16.0], [-47.98, -15.98], [-48.0, -15.98], [-48.0, -16.0]]]);
const areaB = polygon([[[-47.99, -15.99], [-47.97, -15.99], [-47.97, -15.97], [-47.99, -15.97], [-47.99, -15.99]]]);

describe("motor de análise GIS", () => {
  it("calcula buffer geodésico em metros e registra proveniência", () => {
    const result = executeAnalysis({ operation: "buffer", inputs: [point([-47.93, -15.78])], bufferMeters: 1_000 });
    expect(result.output.features).toHaveLength(1);
    expect(result.output.features[0].geometry.type).toBe("Polygon");
    expect(result.areaSquareMeters).toBeGreaterThan(2_500_000);
    expect(result.areaSquareMeters).toBeLessThan(4_000_000);
    expect(result.provenance.parameters.bufferMeters).toBe(1_000);
    expect(result.provenance.parameters.units).toBe("meters");
  });

  it("intersecta e une áreas conhecidas", () => {
    const intersection = executeAnalysis({ operation: "intersection", inputs: [areaA, areaB] });
    const merged = executeAnalysis({ operation: "union", inputs: [areaA, areaB] });
    expect(intersection.output.features).toHaveLength(1);
    expect(intersection.areaSquareMeters).toBeGreaterThan(1_000_000);
    expect(merged.output.features).toHaveLength(1);
    expect(merged.areaSquareMeters).toBeGreaterThan(intersection.areaSquareMeters);
  });

  it("mede ADA em metros quadrados sem modificar a geometria", () => {
    const result = executeAnalysis({ operation: "area", inputs: [areaA] });
    expect(result.output.features).toHaveLength(1);
    expect(result.output.features[0].properties?.areaSquareMeters).toBeGreaterThan(1_000_000);
    expect(result.provenance.operation).toBe("area");
  });

  it("gera malha de pontos quadrada recortada, codificada e rotacionada", () => {
    const result = executeAnalysis({
      operation: "grid",
      inputs: [areaA],
      grid: { spacingMeters: 500, originCode: "ADA-01", rotationDegrees: 15 },
    });
    expect(result.output.features.length).toBeGreaterThan(1);
    expect(result.output.features.every((feature) => feature.geometry.type === "Point")).toBe(true);
    expect(result.output.features[0].properties?.code).toMatch(/^ADA-01-\d{4}$/);
    expect(result.output.features.every((feature) => feature.properties?.spacingMeters === 500)).toBe(true);
    expect(result.output.features.every((feature) => feature.properties?.pattern === "quadrada")).toBe(true);
    expect(result.provenance.parameters.clip).toBe(true);
  });

  it("gera malha triangular com linhas alternadas", () => {
    const result = executeAnalysis({
      operation: "grid",
      inputs: [areaA],
      grid: { spacingMeters: 500, pattern: "triangular" },
    });
    expect(result.output.features.length).toBeGreaterThan(1);
    expect(result.output.features.every((feature) => feature.geometry.type === "Point")).toBe(true);
    expect(result.output.features.every((feature) => feature.properties?.pattern === "triangular")).toBe(true);
  });

  it("rejeita buffer sem unidade métrica válida e malha sem área", () => {
    expect(() => executeAnalysis({ operation: "buffer", inputs: [areaA], bufferMeters: 0 })).toThrow("buffer");
    expect(() => executeAnalysis({ operation: "grid", inputs: [point([-47, -15])], grid: { spacingMeters: 100 } })).toThrow("Polygon");
  });
});
