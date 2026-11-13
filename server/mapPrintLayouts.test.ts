import { describe, expect, it } from "vitest";
import {
  PRINT_LAYOUT_SEEDS,
  PRINT_PAPER_SIZES,
  fitPrintImage,
  getPrintPageGeometry,
  isMapPrintLayoutConfig,
  parsePrintLayoutConfig,
  readMapPrintLayoutConfig,
  writeMapPrintLayoutConfig,
  type PrintLayoutConfig,
  type PrintPaper,
} from "../shared/mapPrintLayouts";
import {
  assertPrintableSnapshot,
  buildPrintScene,
  createMapPrintPdf,
  printSceneSvg,
  type PrintDocumentInput,
} from "../client/src/lib/mapPrintRender";
import type { MapPrintSnapshot } from "../shared/mapPrint";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNwa4oCAAI0ASOvvGOeAAAAAElFTkSuQmCC";
const snapshot: MapPrintSnapshot = {
  imageDataUrl: png,
  width: 1,
  height: 1,
  bounds: { north: -18, south: -20, east: -42, west: -44 },
  capturedAt: "2026-11-02T22:00:00.000Z",
  crs: "EPSG:3857",
  attributions: ["© OpenStreetMap contributors", "Fonte de teste"],
  warnings: [],
  legend: [{ label: "Área de estudo", color: "#123456" }],
};
const config = (index = 0): PrintLayoutConfig => ({
  ...PRINT_LAYOUT_SEEDS[index].config,
  elements: { ...PRINT_LAYOUT_SEEDS[index].config.elements },
});
const document = (
  layout = config(),
  overrides: Partial<MapPrintSnapshot> = {}
): PrintDocumentInput => ({
  snapshot: { ...snapshot, ...overrides },
  layout,
  title: "Mapa da área de estudo",
  subtitle: "Impressão local",
  author: "Responsável",
  projectName: "Projeto",
  clientName: "Cliente",
});

describe("map print layout versioned namespace", () => {
  it("keeps legacy/foreign/future templates untouched and rejects unsupported settings", () => {
    const legacy = {
      pageSize: "A3",
      orientation: "landscape",
      scale: "10000",
      templateType: "abnt_tecnico",
    };
    const original = JSON.stringify(legacy);
    expect(isMapPrintLayoutConfig(legacy)).toBe(false);
    expect(readMapPrintLayoutConfig(legacy)).toBeNull();
    expect(JSON.stringify(legacy)).toBe(original);
    expect(isMapPrintLayoutConfig({ printLayout: { version: 2 } })).toBe(true);
    expect(
      readMapPrintLayoutConfig({ printLayout: { ...config(), version: 2 } })
    ).toBeNull();
    for (const invalid of [
      null,
      [],
      {},
      { ...config(), paper: "A5" },
      { ...config(), orientation: "diagonal" },
      { ...config(), signature: "future" },
      { ...config(), elements: { legend: "yes" } },
    ])
      expect(parsePrintLayoutConfig(invalid)).toBeNull();
  });
  it("round trips custom paper/orientation/elements without snapshot bytes", () => {
    const custom = {
      ...config(1),
      paper: "A0" as const,
      orientation: "portrait" as const,
      elements: {
        legend: false,
        grid: true,
        north: false,
        frame: true,
        scale: false,
      },
    };
    const saved = writeMapPrintLayoutConfig(custom);
    expect(readMapPrintLayoutConfig(saved)).toEqual(custom);
    expect(Object.keys(saved)).toEqual(["printLayout"]);
    expect(JSON.stringify(saved)).not.toContain("imageDataUrl");
    expect(saved.printLayout.elements).not.toBe(custom.elements);
  });
});

describe("physical layout geometry", () => {
  it("places legend below, right and left for the three actual signatures", () => {
    const [free, technical, presentation] = PRINT_LAYOUT_SEEDS.map(seed =>
      getPrintPageGeometry(seed.config)
    );
    expect(free.legend!.y).toBeGreaterThan(
      free.mapSlot.y + free.mapSlot.height
    );
    expect(technical.legend!.x).toBeGreaterThan(
      technical.mapSlot.x + technical.mapSlot.width
    );
    expect(presentation.legend!.x + presentation.legend!.width).toBeLessThan(
      presentation.mapSlot.x
    );
  });
  for (const paper of Object.keys(PRINT_PAPER_SIZES) as PrintPaper[]) {
    for (const orientation of ["portrait", "landscape"] as const) {
      for (let seed = 0; seed < PRINT_LAYOUT_SEEDS.length; seed++) {
        it(`keeps ${PRINT_LAYOUT_SEEDS[seed].id}/${paper}/${orientation} inside the sheet`, () => {
          const layout = { ...config(seed), paper, orientation };
          const page = getPrintPageGeometry(layout);
          for (const rect of [
            page.header,
            page.footer,
            page.mapSlot,
            page.legend,
          ].filter(Boolean)) {
            expect(rect!.x).toBeGreaterThanOrEqual(0);
            expect(rect!.y).toBeGreaterThanOrEqual(0);
            expect(rect!.width).toBeGreaterThan(0);
            expect(rect!.height).toBeGreaterThan(0);
            expect(rect!.x + rect!.width).toBeLessThanOrEqual(page.width);
            expect(rect!.y + rect!.height).toBeLessThanOrEqual(page.height);
          }
          const image = fitPrintImage(page.mapSlot, 1600, 900);
          expect(image.width / image.height).toBeCloseTo(1600 / 900);
          expect(image.x).toBeGreaterThanOrEqual(page.mapSlot.x - 1e-8);
          expect(image.y).toBeGreaterThanOrEqual(page.mapSlot.y - 1e-8);
          expect(image.x + image.width).toBeLessThanOrEqual(
            page.mapSlot.x + page.mapSlot.width + 1e-8
          );
          expect(image.y + image.height).toBeLessThanOrEqual(
            page.mapSlot.y + page.mapSlot.height + 1e-8
          );
          const scene = buildPrintScene(document(layout));
          for (const primitive of scene.primitives) {
            expect(primitive.x).toBeGreaterThanOrEqual(0);
            expect(primitive.y).toBeGreaterThanOrEqual(0);
            expect(primitive.x).toBeLessThanOrEqual(scene.width);
            expect(primitive.y).toBeLessThanOrEqual(scene.height);
            if (primitive.kind === "image" || primitive.kind === "rect") {
              expect(primitive.x + primitive.width).toBeLessThanOrEqual(
                scene.width + 1e-8
              );
              expect(primitive.y + primitive.height).toBeLessThanOrEqual(
                scene.height + 1e-8
              );
            }
          }
        });
      }
    }
  }
  it("reclaims legend area and preserves portrait/landscape pixel ratio", () => {
    const layout = config(1),
      withLegend = getPrintPageGeometry(layout);
    layout.elements.legend = false;
    const withoutLegend = getPrintPageGeometry(layout);
    expect(withoutLegend.legend).toBeNull();
    expect(withoutLegend.mapSlot.width).toBeGreaterThan(
      withLegend.mapSlot.width
    );
    for (const [width, height] of [
      [900, 1600],
      [1600, 900],
      [1, 1],
    ]) {
      const fitted = fitPrintImage(withoutLegend.mapSlot, width, height);
      expect(fitted.width / fitted.height).toBeCloseTo(width / height);
    }
    expect(() => fitPrintImage(withoutLegend.mapSlot, 0, 600)).toThrow();
  });
});

describe("single scene preview and real PDF", () => {
  it("rejects missing PNG, unsupported CRS, world wrap and oversize pixels", () => {
    expect(() =>
      assertPrintableSnapshot({ ...snapshot, imageDataUrl: "" })
    ).toThrow(/PNG/);
    expect(() =>
      assertPrintableSnapshot({ ...snapshot, crs: "EPSG:4326" as any })
    ).toThrow(/CRS/);
    expect(() =>
      assertPrintableSnapshot({ ...snapshot, width: 10000, height: 10000 })
    ).toThrow(/12 MP/);
    expect(() =>
      assertPrintableSnapshot({
        ...snapshot,
        bounds: { ...snapshot.bounds, east: 181 },
      })
    ).toThrow(/antimeridiano/);
  });
  it("computes scale rather than using a fixed denominator, preserving extent", () => {
    const small = buildPrintScene(
      document(config(), { width: 1200, height: 800 })
    );
    const large = buildPrintScene(
      document({ ...config(), paper: "A0" }, { width: 1200, height: 800 })
    );
    expect(small.scaleDenominator).not.toBe(10000);
    expect(large.scaleDenominator).toBeLessThan(small.scaleDenominator);
    expect(large.effectiveDpi).toBeLessThan(small.effectiveDpi);
    expect(small.mapRect.width / small.mapRect.height).toBeCloseTo(1.5);
  });
  it("escapes SVG labels, embeds real pixels and renders extractable PDF text", () => {
    const input = {
      ...document(config(1)),
      title: '<script>alert("x")</script> & título',
    };
    const scene = buildPrintScene(input),
      svg = printSceneSvg(scene);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain(png);
    const pdf = createMapPrintPdf(input, scene);
    expect(pdf.getNumberOfPages()).toBe(1);
    expect(pdf.internal.pageSize.getWidth()).toBeCloseTo(scene.width);
    expect(pdf.internal.pageSize.getHeight()).toBeCloseTo(scene.height);
    const data = pdf.output();
    expect(data.startsWith("%PDF-")).toBe(true);
    expect(data).toContain("/Subtype /Image");
    expect(data).toContain("/Font");
    expect(data).toContain("EPSG:3857");
    expect(data).toContain("attributions");
  });
  it("reports legend overflow honestly, while preserving complete metadata", () => {
    const input = document(config(), {
      legend: Array.from({ length: 100 }, (_, i) => ({
        label: `Camada ${i} com descrição longa da feição`,
      })),
    });
    const scene = buildPrintScene(input);
    expect(scene.warnings.some(value => value.includes("Legenda excede"))).toBe(
      true
    );
    expect(printSceneSvg(scene)).toContain("metadados PDF");
    expect(input.snapshot.legend).toHaveLength(100);
  });
  it("never drops attribution text silently if it cannot fit", () => {
    expect(() =>
      buildPrintScene(
        document(config(), {
          attributions: ["Fonte e licença muito longa. ".repeat(200)],
        })
      )
    ).toThrow(/Créditos extensos/);
  });
});
