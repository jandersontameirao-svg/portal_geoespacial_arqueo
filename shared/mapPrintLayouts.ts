/** Local print layouts. No DB schema changes: stored in atlas.templates.config. */
export const PRINT_PAPER_SIZES = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  A1: { width: 594, height: 841 },
  A0: { width: 841, height: 1189 },
} as const;
export type PrintPaper = keyof typeof PRINT_PAPER_SIZES;
export type PrintOrientation = "portrait" | "landscape";
export type PrintLayoutSignature = "vista-livre" | "tecnico" | "apresentacao";
export interface PrintLayoutConfig {
  version: 1;
  signature: PrintLayoutSignature;
  paper: PrintPaper;
  orientation: PrintOrientation;
  elements: {
    legend: boolean;
    grid: boolean;
    north: boolean;
    frame: boolean;
    scale: boolean;
  };
}
export const PRINT_LAYOUT_SEEDS: ReadonlyArray<{
  id: PrintLayoutSignature;
  name: string;
  description: string;
  config: PrintLayoutConfig;
}> = [
  {
    id: "vista-livre",
    name: "Vista livre",
    description: "Mapa amplo, legenda e créditos no rodapé.",
    config: {
      version: 1,
      signature: "vista-livre",
      paper: "A4",
      orientation: "landscape",
      elements: {
        legend: true,
        grid: false,
        north: true,
        frame: true,
        scale: true,
      },
    },
  },
  {
    id: "tecnico",
    name: "Técnico",
    description: "Legenda à direita, grade geográfica e informações técnicas.",
    config: {
      version: 1,
      signature: "tecnico",
      paper: "A3",
      orientation: "landscape",
      elements: {
        legend: true,
        grid: true,
        north: true,
        frame: true,
        scale: true,
      },
    },
  },
  {
    id: "apresentacao",
    name: "Apresentação",
    description: "Título destacado e legenda à esquerda do mapa.",
    config: {
      version: 1,
      signature: "apresentacao",
      paper: "A4",
      orientation: "portrait",
      elements: {
        legend: true,
        grid: false,
        north: true,
        frame: false,
        scale: true,
      },
    },
  },
];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
/** Fail closed for foreign/unsupported versions; never coerce Atlas configs. */
export function parsePrintLayoutConfig(
  value: unknown
): PrintLayoutConfig | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (!PRINT_LAYOUT_SEEDS.some(seed => seed.id === value.signature))
    return null;
  if (
    typeof value.paper !== "string" ||
    !Object.hasOwn(PRINT_PAPER_SIZES, value.paper)
  )
    return null;
  if (value.orientation !== "portrait" && value.orientation !== "landscape")
    return null;
  if (!isRecord(value.elements)) return null;
  for (const key of ["legend", "grid", "north", "frame", "scale"] as const)
    if (typeof value.elements[key] !== "boolean") return null;
  return {
    version: 1,
    signature: value.signature as PrintLayoutSignature,
    paper: value.paper as PrintPaper,
    orientation: value.orientation,
    elements: {
      legend: value.elements.legend as boolean,
      grid: value.elements.grid as boolean,
      north: value.elements.north as boolean,
      frame: value.elements.frame as boolean,
      scale: value.elements.scale as boolean,
    },
  };
}
/** Recognizes the namespace even for future versions, so Atlas can keep them separate. */
export function isMapPrintLayoutConfig(
  config: unknown
): config is { printLayout: unknown } {
  return isRecord(config) && Object.hasOwn(config, "printLayout");
}
export function readMapPrintLayoutConfig(
  config: unknown
): PrintLayoutConfig | null {
  return isMapPrintLayoutConfig(config)
    ? parsePrintLayoutConfig(config.printLayout)
    : null;
}
export function writeMapPrintLayoutConfig(layout: PrintLayoutConfig): {
  printLayout: PrintLayoutConfig;
} {
  const valid = parsePrintLayoutConfig(layout);
  if (!valid) throw new Error("Modelo de impressão inválido ou incompatível.");
  return { printLayout: valid };
}
export interface PrintRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface PrintPageGeometry {
  width: number;
  height: number;
  header: PrintRect;
  mapSlot: PrintRect;
  legend: PrintRect | null;
  footer: PrintRect;
}
export function printPageSize(
  config: Pick<PrintLayoutConfig, "paper" | "orientation">
) {
  const paper = PRINT_PAPER_SIZES[config.paper];
  return config.orientation === "landscape"
    ? { width: paper.height, height: paper.width }
    : { width: paper.width, height: paper.height };
}
/** All dimensions are millimetres, shared by SVG and PDF renderers. */
export function getPrintPageGeometry(
  config: PrintLayoutConfig
): PrintPageGeometry {
  const { width, height } = printPageSize(config);
  const m = 10,
    gap = 5,
    contentWidth = width - 2 * m;
  const headerHeight = config.signature === "apresentacao" ? 35 : 25;
  const header = { x: m, y: m, width: contentWidth, height: headerHeight };
  const footerHeight = 30;
  const footer = {
    x: m,
    y: height - m - footerHeight,
    width: contentWidth,
    height: footerHeight,
  };
  const y = m + headerHeight + gap;
  const availableHeight = footer.y - gap - y;
  if (!config.elements.legend)
    return {
      width,
      height,
      header,
      mapSlot: { x: m, y, width: contentWidth, height: availableHeight },
      legend: null,
      footer,
    };
  if (config.signature === "vista-livre") {
    const legendHeight = Math.min(30, availableHeight * 0.22);
    return {
      width,
      height,
      header,
      mapSlot: {
        x: m,
        y,
        width: contentWidth,
        height: availableHeight - legendHeight - gap,
      },
      legend: {
        x: m,
        y: footer.y - gap - legendHeight,
        width: contentWidth,
        height: legendHeight,
      },
      footer,
    };
  }
  const legendWidth = Math.min(62, contentWidth * 0.27);
  const left = config.signature === "apresentacao";
  return {
    width,
    height,
    header,
    mapSlot: {
      x: left ? m + legendWidth + gap : m,
      y,
      width: contentWidth - legendWidth - gap,
      height: availableHeight,
    },
    legend: {
      x: left ? m : width - m - legendWidth,
      y,
      width: legendWidth,
      height: availableHeight,
    },
    footer,
  };
}
export function fitPrintImage(
  slot: PrintRect,
  imageWidth: number,
  imageHeight: number
): PrintRect {
  if (![imageWidth, imageHeight].every(n => Number.isFinite(n) && n > 0))
    throw new Error("Dimensões inválidas da captura.");
  const factor = Math.min(slot.width / imageWidth, slot.height / imageHeight);
  const width = imageWidth * factor,
    height = imageHeight * factor;
  return {
    x: slot.x + (slot.width - width) / 2,
    y: slot.y + (slot.height - height) / 2,
    width,
    height,
  };
}
