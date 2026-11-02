import { describe, expect, it } from "vitest";
import { buildAtlasVectorOverlays } from "./atlasVectorOverlay";

const polygon = { type: "Feature", properties: { name: "Área 1" }, geometry: { type: "Polygon", coordinates: [[[-48, -16], [-47, -16], [-47, -15], [-48, -16]]] } };

describe("overlays vetoriais do Atlas", () => {
  it("inclui somente camadas selecionadas, com estilo limitado e geometria válida", () => {
    const overlays = buildAtlasVectorOverlays([
      { id: 1, name: "Resultado", layerData: { type: "FeatureCollection", features: [polygon, { type: "Feature", geometry: null }] }, defaultStyle: { color: "#0088aa", weight: 30, fillOpacity: 2 } },
      { id: 2, name: "Não selecionada", layerData: { type: "FeatureCollection", features: [polygon] }, defaultStyle: {} },
    ], [{ layerId: 1, opacity: 0.4, includeInLegend: true }]);
    expect(overlays).toHaveLength(1);
    expect(overlays[0].data.features).toHaveLength(1);
    expect(overlays[0].weight).toBe(8);
    expect(overlays[0].fillOpacity).toBe(0.85);
    expect(overlays[0].includeInLegend).toBe(true);
  });

  it("bloqueia coleta vetorial além do limite do worker", () => {
    const many = Array.from({ length: 5001 }, (_, id) => ({ ...polygon, properties: { id } }));
    expect(() => buildAtlasVectorOverlays([{ id: 1, name: "Muitas", layerData: { type: "FeatureCollection", features: many }, defaultStyle: {} }], [{ layerId: 1, opacity: 1, includeInLegend: true }])).toThrow("5.000");
  });
});
