import { describe, expect, it } from "vitest";
import {
  completeViewportCollection,
  escapeAttribution,
  ibgeAttribution,
  IBGE_MUNICIPALITIES_2010,
  isIbgePublishedLayer,
  isIbgeVariant,
  viewportIssue,
  institutionalPublisher,
  institutionalTitle,
  institutionalEdition,
  institutionalAttribution,
  isInstitutionalPublishedLayer,
  sourceIsRegistered,
  type InstitutionalSource,
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

describe("catálogo multiórgão — limites puros", () => {
  it("normaliza somente os quatro publicadores fixos, sem inferir por URL ou prefixo", () => {
    for (const publisher of ["IBGE", "IPHAN", "FUNAI", "INCRA"]) {
      expect(
        institutionalPublisher({
          publisher: ` ${publisher.toLowerCase()} `,
          remoteLayer: "org:camada",
        })
      ).toBe(publisher);
    }
    for (const publisher of [
      "FUNAI externo",
      "INCRAevil",
      "https://funai.gov.br",
      "OUTRO",
    ]) {
      expect(
        institutionalPublisher({
          publisher,
          remoteLayer: IBGE_MUNICIPALITIES_2010,
        })
      ).toBeNull();
    }
    expect(
      institutionalPublisher({ remoteLayer: "https://funai.gov.br/camada" })
    ).toBeNull();
  });
  it("usa o publicador da variante selecionada sem herdar a identidade da primária", () => {
    const layer = {
      logicalLayer: "camada",
      selected: { ...variant, publisher: "externo" },
      primary: variant,
      isFallback: true,
      reason: null,
    };
    expect(isInstitutionalPublishedLayer(layer)).toBe(false);
    expect(isIbgePublishedLayer(layer)).toBe(false);
    expect(
      isInstitutionalPublishedLayer({
        ...layer,
        selected: { ...variant, publisher: " IPHAN " },
      })
    ).toBe(true);
  });
  it("não atribui município/2010/IBGE a outros órgãos e escapa HTML", () => {
    for (const publisher of ["IPHAN", "FUNAI", "INCRA"]) {
      const org = {
        ...variant,
        publisher,
        remoteLayer: "org:camada",
        attribution: '<a href="x">A & B</a>',
      };
      expect(institutionalTitle(org)).toBe(publisher);
      expect(institutionalEdition(org)).toBe("não declarada");
      expect(institutionalAttribution(org)).toBe(
        `Fonte: ${publisher} — &lt;a href=&quot;x&quot;&gt;A &amp; B&lt;/a&gt;`
      );
      expect(institutionalTitle({ ...org, title: "Título validado" })).toBe(
        "Título validado"
      );
      expect(institutionalEdition({ ...org, edition: "2024" })).toBe("2024");
    }
  });
  it("distingue origem validada de tipos realmente cadastrados no banco", () => {
    const source: InstitutionalSource = {
      publisher: "FUNAI",
      label: "FUNAI",
      title: "Terras",
      edition: null,
      sourceCrs: null,
      status: "validated",
      blocker: null,
      presetId: "fixed",
      supportsWms: true,
      supportsWfs: true,
      registeredTypes: [],
      wmsVersion: "1.1.1",
    };
    expect(sourceIsRegistered(source)).toBe(false);
    expect(sourceIsRegistered({ ...source, registeredTypes: ["wms"] })).toBe(
      false
    );
    expect(
      sourceIsRegistered({ ...source, registeredTypes: ["WMS", " wfs "] })
    ).toBe(true);
    expect(
      sourceIsRegistered({
        ...source,
        supportsWfs: false,
        registeredTypes: ["wms"],
      })
    ).toBe(true);
    expect(
      sourceIsRegistered({ ...source, supportsWms: false, supportsWfs: false })
    ).toBe(false);
  });
});
