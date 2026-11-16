/**
 * Layout e estilos do Estúdio Cartográfico (papéis, elementos da prancha,
 * símbolos, fundos e validações). Porte de preview/previa-layout.mts do Codex
 * (código genérico) para uso compartilhado client/servidor.
 */
export const linearAtlasScale = 4500;

export const defaultLayout = {
  principal: { x: 27, y: 32, w: 440, h: 370 },
  legenda: { x: 478, y: 202, w: 104, h: 65 },
  norte: { x: 33, y: 36, w: 14, h: 20 },
  brasil: { x: 479, y: 30, w: 100, h: 79 },
  regional: { x: 479, y: 112, w: 100, h: 79 },
};
export type Layout = typeof defaultLayout;
export type Orientation = "landscape" | "portrait";
export function readOrientation(value: unknown): Orientation {
  if (value == null || value === "landscape") return "landscape";
  if (value === "portrait") return "portrait";
  throw Error("Orientação inválida.");
}
export const portraitLayout: Layout = {
  principal: { x: 27, y: 32, w: 366, h: 390 },
  norte: { x: 33, y: 36, w: 14, h: 20 },
  brasil: { x: 27, y: 435, w: 82, h: 67 },
  regional: { x: 114, y: 435, w: 82, h: 67 },
  legenda: { x: 27, y: 509, w: 169, h: 64 },
};
export function readLayout(value: unknown, orientation: Orientation = "landscape"): Layout {
  const defaults = orientation === "portrait" ? portraitLayout : defaultLayout;
  const [width, height] = paperSize("A2", orientation);
  if (value === undefined) return defaults;
  if (!value || typeof value !== "object") throw Error("Layout inválido.");
  const result = {} as Layout;
  for (const key of Object.keys(defaultLayout) as (keyof Layout)[]) {
    const box = (value as Layout)[key] ?? (key === "principal" ? defaults.principal : undefined);
    if (!box || ![box.x, box.y, box.w, box.h].every(Number.isFinite) ||
      box.x < 0 || box.y < 0 || box.w < 10 || box.h < 10 || box.x + box.w > width + .001 || box.y + box.h > height + .001) throw Error("Elemento fora da folha.");
    result[key] = { x: box.x, y: box.y, w: box.w, h: box.h };
  }
  return result;
}
export function readScale(value: unknown, maximum = 10000000): number | undefined {
  if (value == null || value === "") return;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1000 || value > maximum) throw Error("Use uma escala entre 1:1.000 e 1:" + maximum.toLocaleString("pt-BR") + ".");
  return value;
}

export const studioBackgrounds = { cartografico: "Cartográfico", claro: "Cinza claro", branco: "Branco com limites", nenhum: "Sem base", "esri-imagery": "ESRI Satélite", "esri-light-gray": "ESRI Light Gray", "esri-dark-gray": "ESRI Dark Gray" } as const;
export type StudioBackground = keyof typeof studioBackgrounds;
export function readStudioBackground(value: unknown): StudioBackground {
  if (value === undefined) return "cartografico";
  if (typeof value === "string" && Object.hasOwn(studioBackgrounds, value)) return value as StudioBackground;
  throw Error("Fundo de mapa inválido.");
}
export type StudioAreaStyle = { color: string; opacity: number; strokeColor?: string; strokeMm?: number };
export const studioSymbols = {
  circulo: "Círculo", quadrado: "Quadrado", triangulo: "Triângulo", losango: "Losango",
  pentagono: "Pentágono", hexagono: "Hexágono", estrela: "Estrela", cruz: "Cruz", xis: "X",
} as const;
export type StudioSymbol = keyof typeof studioSymbols;
export type StudioVectorStyle = { color: string; widthMm?: number; sizeMm?: number; symbol?: StudioSymbol };
export function studioSymbolPoints(symbol: StudioSymbol): [number, number][] {
  if (symbol === "cruz" || symbol === "xis") {
    const cross: [number, number][] = [[-.28, -1], [.28, -1], [.28, -.28], [1, -.28], [1, .28], [.28, .28],
      [.28, 1], [-.28, 1], [-.28, .28], [-1, .28], [-1, -.28], [-.28, -.28]];
    return symbol === "cruz" ? cross : cross.map(([x, y]) => [(x - y) / 1.28, (x + y) / 1.28]);
  }
  const count = { circulo: 32, quadrado: 4, triangulo: 3, losango: 4, pentagono: 5, hexagono: 6, estrela: 10 }[symbol];
  return Array.from({ length: count }, (_, i) => {
    const a = i * 2 * Math.PI / count - Math.PI / 2 + (symbol === "quadrado" ? Math.PI / 4 : 0);
    const r = symbol === "estrela" && i % 2 ? .42 : symbol === "quadrado" ? Math.SQRT2 : 1;
    return [Math.cos(a) * r, Math.sin(a) * r] as [number, number];
  });
}

export const paperSizes = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] } as const;
export type Paper = keyof typeof paperSizes;
export const defaultStudioPaper: Paper = "A3";
export function readPaper(value: unknown): Paper {
  if (value == null) return "A2";
  if (typeof value !== "string" || !Object.hasOwn(paperSizes, value)) throw Error("Formato de papel inválido.");
  return value as Paper;
}
export function paperSize(paper: Paper, orientation: Orientation = "landscape"): [number, number] {
  const [w, h] = paperSizes[paper];
  return orientation === "portrait" ? [h, w] : [w, h];
}
export function paperFactor(paper: Paper) {
  const [w, h] = paperSizes[paper];
  return Math.min(w / 594, h / 420);
}
