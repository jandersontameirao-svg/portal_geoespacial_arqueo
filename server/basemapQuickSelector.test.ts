import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BASEMAPS,
  SELECTABLE_BASEMAPS,
  type BasemapDefinition,
} from "../client/src/lib/basemaps";
import {
  getBasemapFocusIndex,
  getBasemapPreviewUrl,
  getBasemapShortName,
} from "../client/src/components/BasemapQuickSelector";

// Somente funções e fontes locais: nenhum navegador, fetch, banco ou variáveis de ambiente.
const selectorSource = readFileSync(
  new URL("../client/src/components/BasemapQuickSelector.tsx", import.meta.url),
  "utf8"
);
const panelsSource = readFileSync(
  new URL("../client/src/components/GlobalMapPanels.tsx", import.meta.url),
  "utf8"
);

function fixture(overrides: Partial<BasemapDefinition>): BasemapDefinition {
  return { ...BASEMAPS[0], ...overrides };
}

describe("seletor compacto de fundos — funções puras", () => {
  it("oferece os cinco fundos do catálogo, sem outro endpoint ou arquivo de mídia", () => {
    expect(SELECTABLE_BASEMAPS).toHaveLength(5);
    expect(SELECTABLE_BASEMAPS.map(getBasemapPreviewUrl)).toEqual([
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/4/2",
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/3/4/2",
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/3/4/2",
      "https://tile.openstreetmap.org/3/2/4.png",
      "https://tile.opentopomap.org/3/2/4.png",
    ]);
    for (const basemap of SELECTABLE_BASEMAPS) {
      expect(new URL(getBasemapPreviewUrl(basemap)!).origin).toBe(
        new URL(basemap.url!).origin
      );
    }
  });

  it("não gera amostra para fonte ausente, indisponível, WMTS ou zoom incompatível", () => {
    for (const overrides of [
      { url: undefined },
      { availability: "requires-approved-provider" as const },
      { availability: "planned-review" as const },
      { kind: "wmts" as const },
      { minZoom: 4 },
      { maxZoom: 2 },
    ])
      expect(getBasemapPreviewUrl(fixture(overrides))).toBeUndefined();
  });

  it("usa nomes curtos distintos e preserva o nome de fundos desconhecidos", () => {
    expect(SELECTABLE_BASEMAPS.map(getBasemapShortName)).toEqual([
      "Satélite Esri",
      "Cinza claro",
      "Cinza escuro",
      "OpenStreetMap",
      "OpenTopoMap",
    ]);
    expect(
      getBasemapShortName(fixture({ id: "future", name: "Fundo futuro" }))
    ).toBe("Fundo futuro");
  });

  it("percorre a lista com setas e retorna ao início/fim sem mudar a escolha", () => {
    expect(getBasemapFocusIndex("ArrowDown", 0, 5)).toBe(1);
    expect(getBasemapFocusIndex("ArrowDown", 4, 5)).toBe(0);
    expect(getBasemapFocusIndex("ArrowUp", 0, 5)).toBe(4);
    expect(getBasemapFocusIndex("ArrowRight", 4, 5)).toBe(0);
    expect(getBasemapFocusIndex("ArrowLeft", 2, 5)).toBe(1);
    expect(getBasemapFocusIndex("Home", 3, 5)).toBe(0);
    expect(getBasemapFocusIndex("End", 1, 5)).toBe(4);
    for (const key of ["Enter", " ", "Escape", "Tab", "a"]) {
      expect(getBasemapFocusIndex(key, 2, 5)).toBeUndefined();
    }
    expect(getBasemapFocusIndex("ArrowDown", 0, 0)).toBeUndefined();
  });
});

describe("seletor compacto de fundos — limites estruturais (não substitui teste de DOM)", () => {
  it("substitui apenas o select antigo e conserva os painéis institucionais e de projetos", () => {
    expect(panelsSource).toContain("<BasemapQuickSelector");
    expect(panelsSource).not.toContain("<select");
    expect(panelsSource).not.toContain('visitedPanels.has("basemap")');
    for (const component of [
      "MyProjectsPanel",
      "InstitutionalLayersPanel",
      "BaseLayersPanel",
    ]) {
      expect(panelsSource).toContain(`<${component}`);
    }
    expect(panelsSource).toContain(
      "current.has(panel) ? current : new Set(current).add(panel)"
    );
    expect(panelsSource).toContain(
      'activePanel !== null && activePanel !== "basemap"'
    );
  });

  it("monta amostras somente com a lista aberta e não troca de provedor em erro", () => {
    expect(selectorSource).toMatch(
      /\{open && \([\s\S]*<BasemapPreview basemap=\{basemap\}/
    );
    expect(selectorSource).toContain('onError={() => setStatus("error")}');
    expect(selectorSource).toContain('status !== "error"');
    expect(selectorSource).toContain("Sem prévia");
    expect(selectorSource).not.toMatch(
      /fetch\(|new Image|fallbackUrl|localStorage|setViewMode/
    );
  });

  it("troca o fundo e fecha sem invocar o callback de modo 2D", () => {
    expect(selectorSource).toMatch(
      /onClick=\{\(\) => \{\s*onBasemapChange\(basemap.id\);\s*onOpenChange\(false\);\s*\}\}/
    );
    expect(selectorSource).toContain(
      "Escolhas para o mapa 2D. O globo 3D não muda"
    );
    expect(selectorSource).toContain('viewMode === "3d" && onRequest2D');
    expect(selectorSource.match(/onRequest2D\(\)/g)).toHaveLength(1);
  });

  it("mantém créditos completos, detalhes acessíveis ao toque, foco e exclusão de impressão", () => {
    expect(selectorSource).toContain("<PopoverContent");
    expect(selectorSource).toContain("onOpenAutoFocus");
    expect(selectorSource).toContain("aria-pressed={active}");
    expect(selectorSource).toContain("<details");
    expect(selectorSource).toContain("<summary");
    expect(selectorSource).toContain("<TooltipContent");
    expect(selectorSource).toContain("{basemap.attribution}");
    expect(selectorSource).toContain("{basemap.description}");
    expect(selectorSource).toContain("href={basemap.licenseUrl}");
    expect(selectorSource).toContain('data-html2canvas-ignore="true"');
    expect(selectorSource).toContain("print:hidden");
    expect(selectorSource).not.toContain("truncate");
  });
});
