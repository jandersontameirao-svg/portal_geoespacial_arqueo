import { describe, expect, it } from "vitest";
import {
  INDE_LIMIT_MESSAGE,
  INDE_MERCATOR_MAX_LATITUDE,
  assertIndeMapImage,
  emptyIndeCatalogState,
  indeCatalogReducer,
  indeCrsIssue,
  indeImageSize,
  indeLayerId,
  indeLeafletAttribution,
  indeMercatorViewport,
  indeSelectedLayer,
  isIndeRequestCurrent,
  normalizeIndeCrs,
  toggleIndeSelection,
  type IndeMapImage,
  type IndeMapImageInput,
  type IndeOrganization,
  type IndeSelectedLayer,
} from "../client/src/lib/indeCatalogState";

const organization: IndeOrganization = {
  id: "org",
  label: "Instituição",
  name: "Nome institucional",
  level: "Nacional",
  endpoint: "https://example.gov.br/wms",
  eligible: true,
  blocker: null,
};
function layer(index = 1, crs = ["EPSG:3857", "EPSG:4326"]): IndeSelectedLayer {
  return indeSelectedLayer(organization, {
    name: `org:layer${index}`,
    title: `Camada ${index}`,
    crs,
  });
}
function pngHeader(width: number, height: number): string {
  const header = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return `data:image/png;base64,${header.toString("base64")}`;
}
const globeInput: IndeMapImageInput = {
  organizationId: "org",
  layerName: "layer",
  bounds: [-180, -90, 180, 90],
  crs: "EPSG:4326",
  width: 512,
  height: 256,
};
const globeImage = (): IndeMapImage => ({
  dataUrl: pngHeader(512, 256),
  crs: "EPSG:4326",
  bounds: [-180, -90, 180, 90],
  attribution: "Crédito do publicador",
});

describe("INDE: seleção explícita e limite independente do legado", () => {
  it("começa vazia, usa id estável e mantém crédito textual", () => {
    expect(emptyIndeCatalogState("1").selected).toEqual([]);
    expect(layer().id).toBe("org:org%3Alayer1");
    expect(indeLayerId("a:b", "c")).not.toBe(indeLayerId("a", "b:c"));
    expect(layer().attribution).toBe(
      "Instituição — Nome institucional · catálogo INDE"
    );
  });
  it("não duplica e desliga imediatamente", () => {
    const once = toggleIndeSelection([], layer(), true, "2d");
    const duplicate = toggleIndeSelection(once.selected, layer(), true, "2d");
    expect(duplicate.selected).toHaveLength(1);
    expect(
      toggleIndeSelection(duplicate.selected, layer().id, false, "2d").selected
    ).toEqual([]);
  });
  it("recusa a quinta sem remover ou substituir as quatro anteriores", () => {
    const selected = [1, 2, 3, 4].map(index => layer(index));
    expect(toggleIndeSelection(selected, layer(5), true, "2d")).toEqual({
      selected,
      notice: INDE_LIMIT_MESSAGE,
    });
  });
  it("permite desligar uma seleção incompatível com o novo modo", () => {
    const only2d = layer(1, ["EPSG:3857"]);
    const selected = toggleIndeSelection([], only2d, true, "2d").selected;
    expect(selected).toHaveLength(1);
    expect(indeCrsIssue(selected[0].crs, "3d")).toContain(
      "não anuncia EPSG:4326"
    );
    expect(
      toggleIndeSelection(selected, only2d.id, false, "3d").selected
    ).toEqual([]);
  });
});

describe("INDE: CRS exato sem substituição silenciosa", () => {
  it("normaliza caixa e espaços inclusive CRS herdado", () => {
    expect(normalizeIndeCrs(["epsg:3857", " EPSG:3857 ", "epsg:4326"])).toEqual(
      ["EPSG:3857", "EPSG:4326"]
    );
    expect(indeCrsIssue([" epsg:3857 "], "2d")).toBeNull();
  });
  it("não considera CRS:84 ou EPSG:900913 equivalentes para os pedidos", () => {
    expect(indeCrsIssue(["CRS:84"], "3d")).toContain("não anuncia EPSG:4326");
    expect(indeCrsIssue(["EPSG:900913"], "2d")).toContain(
      "não anuncia EPSG:3857"
    );
  });
  it("recusa ativação incompatível sem produzir seleção", () => {
    const result = toggleIndeSelection([], layer(1, ["EPSG:4326"]), true, "2d");
    expect(result.selected).toEqual([]);
    expect(result.notice).toBe(
      "Indisponível em 2D: esta camada não anuncia EPSG:3857. Nenhum CRS alternativo será usado."
    );
  });
});

describe("INDE: identidade e status protegido", () => {
  it("limpa seleção e status na mudança de usuário ou logout", () => {
    let state = emptyIndeCatalogState("user-a");
    state = indeCatalogReducer(state, {
      type: "toggle",
      identity: "user-a",
      layer: layer(),
      checked: true,
      viewMode: "2d",
    });
    state = indeCatalogReducer(state, {
      type: "report",
      identity: "user-a",
      id: layer().id,
      status: { state: "ready", message: "load" },
    });
    expect(state.statuses[layer().id].state).toBe("ready");
    expect(
      indeCatalogReducer(state, { type: "identity", identity: "user-b" })
    ).toEqual(emptyIndeCatalogState("user-b"));
    expect(
      indeCatalogReducer(state, { type: "identity", identity: null })
    ).toEqual(emptyIndeCatalogState(null));
  });
  it("não aceita ação anônima ou callback de outro usuário", () => {
    const state = emptyIndeCatalogState("user-b");
    expect(
      indeCatalogReducer(state, {
        type: "toggle",
        identity: "user-a",
        layer: layer(),
        checked: true,
        viewMode: "2d",
      })
    ).toBe(state);
    expect(
      indeCatalogReducer(emptyIndeCatalogState(null), {
        type: "clear",
        identity: null,
      })
    ).toEqual(emptyIndeCatalogState(null));
  });
  it("não declara pronta ao selecionar e remove status ao desligar", () => {
    let state = indeCatalogReducer(emptyIndeCatalogState("1"), {
      type: "toggle",
      identity: "1",
      layer: layer(),
      checked: true,
      viewMode: "2d",
    });
    expect(state.statuses).toEqual({});
    state = indeCatalogReducer(state, {
      type: "report",
      identity: "1",
      id: layer().id,
      status: { state: "loading", message: "aguardando" },
    });
    state = indeCatalogReducer(state, {
      type: "toggle",
      identity: "1",
      layer: layer().id,
      checked: false,
      viewMode: "2d",
    });
    expect(state.statuses).toEqual({});
    expect(
      indeCatalogReducer(state, {
        type: "report",
        identity: "1",
        id: layer().id,
        status: { state: "ready", message: "resposta atrasada" },
      })
    ).toBe(state);
  });
});

describe("INDE: recorte 2D em metros Web Mercator", () => {
  it("projeta longitude/latitude, sem enviar graus como EPSG:3857", () => {
    const viewport = indeMercatorViewport([-1, -1, 1, 1]);
    expect(viewport.bounds[0]).toBeCloseTo(-111319.490793, 5);
    expect(viewport.bounds[1]).toBeCloseTo(-111325.142866, 5);
    expect(viewport.bounds[2]).toBeCloseTo(111319.490793, 5);
    expect(viewport.bounds[3]).toBeCloseTo(111325.142866, 5);
    expect(viewport.geographicBounds).toEqual([-1, -1, 1, 1]);
  });
  it("limita latitude à faixa Mercator, não ao polo", () => {
    const result = indeMercatorViewport([-180, -90, 180, 90]);
    expect(result.geographicBounds).toEqual([
      -180,
      -INDE_MERCATOR_MAX_LATITUDE,
      180,
      INDE_MERCATOR_MAX_LATITUDE,
    ]);
    result.bounds.forEach(value =>
      expect(Math.abs(value)).toBeLessThanOrEqual(20037508.34278925)
    );
  });
  it.each([
    [170, -10, -170, 10],
    [-190, -10, 10, 10],
    [-10, -10, 190, 10],
  ])("nega explicitamente antimeridiano/cópia do mundo: %j", (...bounds) => {
    expect(() =>
      indeMercatorViewport(bounds as [number, number, number, number])
    ).toThrow(/antimeridiano/);
  });
  it("nega coordenadas inválidas e recorte degenerado", () => {
    expect(() => indeMercatorViewport([NaN, -10, 10, 10])).toThrow(/inválidas/);
    expect(() => indeMercatorViewport([-10, 10, 10, -10])).toThrow(/sem área/);
    expect(() => indeMercatorViewport([-10, 86, 10, 90])).toThrow(
      /fora da faixa/
    );
  });
});

describe("INDE: dimensões do viewport com teto WMS", () => {
  it.each([
    [1920, 1080],
    [800, 1200],
    [390, 844],
    [900, 450],
    [16, 16],
    [2500, 400],
  ])("preserva proporção real para %i×%i", (width, height) => {
    const size = indeImageSize(width, height);
    expect(size.width).toBeGreaterThanOrEqual(32);
    expect(size.width).toBeLessThanOrEqual(1024);
    expect(size.height).toBeGreaterThanOrEqual(32);
    expect(size.height).toBeLessThanOrEqual(512);
    expect(Math.abs(size.width / size.height - width / height)).toBeLessThan(
      0.025
    );
  });
  it("recusa viewport oculto ou proporção extrema em vez de distorcer", () => {
    expect(() => indeImageSize(0, 400)).toThrow(/visível/);
    expect(() => indeImageSize(10000, 20)).toThrow(/Proporção/);
  });
});

describe("INDE: validação de imagem não equivale a prontidão visual", () => {
  it("escapa HTML de créditos para Leaflet e preserva o prefixo da impressão", () => {
    expect(indeLeafletAttribution('<script a="x">&\'')).toBe(
      "Fonte: &lt;script a=&quot;x&quot;&gt;&amp;&#39;"
    );
  });
  it("aceita apenas cabeçalho PNG com dimensões e recorte solicitados", () => {
    expect(() => assertIndeMapImage(globeImage(), globeInput)).not.toThrow();
  });
  it("rejeita imagem externa, SVG e MIME PNG falso", () => {
    for (const dataUrl of [
      "https://example.gov.br/a.png",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:image/png;base64," + Buffer.alloc(33).toString("base64"),
    ]) {
      expect(() =>
        assertIndeMapImage({ ...globeImage(), dataUrl }, globeInput)
      ).toThrow();
    }
  });
  it("rejeita CRS diferente, bounds diferentes e dimensão errada", () => {
    expect(() =>
      assertIndeMapImage({ ...globeImage(), crs: "EPSG:3857" }, globeInput)
    ).toThrow(/CRS/);
    expect(() =>
      assertIndeMapImage(
        { ...globeImage(), bounds: [-180, -85, 180, 85] },
        globeInput
      )
    ).toThrow(/recorte/);
    expect(() =>
      assertIndeMapImage(
        { ...globeImage(), dataUrl: pngHeader(256, 512) },
        globeInput
      )
    ).toThrow(/Dimensões/);
  });
  it("ignora token obsoleto e abort sem depender apenas de id", () => {
    const controller = new AbortController();
    const old = {},
      current = {};
    expect(isIndeRequestCurrent(controller.signal, old, current)).toBe(false);
    expect(isIndeRequestCurrent(controller.signal, current, current)).toBe(
      true
    );
    controller.abort();
    expect(isIndeRequestCurrent(controller.signal, current, current)).toBe(
      false
    );
  });
});
