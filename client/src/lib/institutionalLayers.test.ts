import { describe, expect, it } from "vitest";
import {
  completeViewportCollection,
  escapeAttribution,
  ibgeAttribution,
  IBGE_MUNICIPALITIES_2010,
  isIbgePublishedLayer,
  isIbgeVariant,
  viewportIssue,
  type IbgeViewportResult,
  type InstitutionalVariant,
} from "./institutionalLayers";

const variant: InstitutionalVariant = {
  id: 1,
  serviceType: "wfs",
  endpoint: "https://example.test/wfs",
  remoteLayer: IBGE_MUNICIPALITIES_2010,
  health: "healthy",
  publisher: "IBGE",
};
const response: IbgeViewportResult = {
  collection: { type: "FeatureCollection", features: [] },
  complete: true,
  matched: 0,
  queriedAt: "2026-11-02T23:00:00Z",
  attribution: "IBGE",
  featureCount: 0,
};

describe("camadas institucionais — helpers UI", () => {
  it("inclui só IBGE ou a camada municipal 2010 exata", () => {
    expect(isIbgeVariant(variant)).toBe(true);
    expect(isIbgeVariant({ publisher: "ibge", remoteLayer: "outro" })).toBe(
      true
    );
    expect(isIbgeVariant({ remoteLayer: IBGE_MUNICIPALITIES_2010 })).toBe(true);
    for (const publisher of ["IPHAN", "FUNAI", "INCRA"])
      expect(isIbgeVariant({ publisher, remoteLayer: "outra:camada" })).toBe(
        false
      );
    expect(isIbgeVariant(null)).toBe(false);
    expect(
      isIbgeVariant({ publisher: "Outro", remoteLayer: "/official2025" })
    ).toBe(false);
  });
  it("preserva entradas IBGE indisponíveis para explicar o estado", () => {
    expect(
      isIbgePublishedLayer({
        logicalLayer: "municipios",
        selected: null,
        primary: variant,
        isFallback: false,
        reason: "indisponível",
      })
    ).toBe(true);
  });
  it("aceita bbox lng/lat local de até dois graus por eixo", () => {
    expect(
      viewportIssue({ west: -48, east: -46, south: -16, north: -14 })
    ).toBeNull();
    expect(
      viewportIssue({ west: -48, east: -45.99, south: -16, north: -14 })
    ).toContain("Aproxime");
    expect(
      viewportIssue({ west: -48, east: -47, south: -16, north: -13 })
    ).toContain("Aproxime");
  });
  it("rejeita infinito, coordenadas invertidas e antimeridiano", () => {
    for (const bounds of [
      { west: NaN, east: -47, south: -16, north: -15 },
      { west: 180, east: -179, south: -16, north: -15 },
      { west: -181, east: -180, south: -16, north: -15 },
      { west: -48, east: -47, south: -16, north: -16 },
    ])
      expect(viewportIssue(bounds)).toContain("inválido");
  });
  it("não retorna geometria parcial, nem quando há feições", () => {
    expect(
      completeViewportCollection({
        ...response,
        complete: false,
        collection: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "Point", coordinates: [-47, -15] },
            },
          ],
        },
      })
    ).toBeNull();
    expect(completeViewportCollection(response)).toBe(response.collection);
  });
  it("escapa atribuição textual para o controle HTML do Leaflet", () => {
    expect(escapeAttribution('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
    );
    expect(ibgeAttribution({ attribution: "IBGE & parceiros" })).toBe(
      "Fonte: IBGE — IBGE &amp; parceiros"
    );
  });
});
