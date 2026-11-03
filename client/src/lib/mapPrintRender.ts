import { jsPDF } from "jspdf";
import {
  assertMapPrintBounds,
  assertMapPrintSize,
  getGeographicGrid,
  getPrintGeometry,
  type MapPrintSnapshot,
} from "@shared/mapPrint";
import {
  getPrintPageGeometry,
  type PrintLayoutConfig,
  type PrintRect,
} from "@shared/mapPrintLayouts";

export interface PrintDocumentInput {
  snapshot: MapPrintSnapshot;
  layout: PrintLayoutConfig;
  title: string;
  subtitle: string;
  author: string;
  projectName: string;
  clientName?: string;
}
type Primitive =
  | {
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      fill: string;
      stroke?: string;
    }
  | {
      kind: "line";
      x: number;
      y: number;
      x2: number;
      y2: number;
      color: string;
      width?: number;
    }
  | {
      kind: "text";
      x: number;
      y: number;
      text: string;
      size: number;
      color: string;
      bold?: boolean;
    }
  | {
      kind: "image";
      x: number;
      y: number;
      width: number;
      height: number;
      src: string;
    };
export interface PrintScene {
  width: number;
  height: number;
  primitives: Primitive[];
  warnings: string[];
  effectiveDpi: number;
  scaleDenominator: number;
  mapRect: PrintRect;
}
const INK = "#142e35",
  MUTED = "#53626a",
  GREEN = "#087b70";
const cleanText = (value: string) =>
  value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
/** Conservative glyph budget shared across both renderers; all positions are physical mm. */
function wrap(value: string, width: number, size: number): string[] {
  const budget = Math.max(1, Math.floor(width / (size * 0.59)));
  const words = cleanText(value).split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const chunks = Array.from(
      word.matchAll(new RegExp(`.{1,${budget}}`, "gu")),
      match => match[0]
    );
    for (const chunk of chunks) {
      if (line && line.length + chunk.length + 1 > budget) {
        lines.push(line);
        line = "";
      }
      line += (line ? " " : "") + chunk;
    }
  }
  if (line) lines.push(line);
  return lines;
}
export function assertPrintableSnapshot(snapshot: MapPrintSnapshot) {
  if (!snapshot || snapshot.crs !== "EPSG:3857")
    throw new Error(
      "Captura ausente ou CRS não suportado. Capture a vista 2D em EPSG:3857."
    );
  assertMapPrintBounds(snapshot.bounds);
  assertMapPrintSize(snapshot.width, snapshot.height);
  if (
    typeof snapshot.imageDataUrl !== "string" ||
    !/^data:image\/png;base64,[A-Za-z0-9+/=\s]+$/.test(snapshot.imageDataUrl)
  )
    throw new Error(
      "A captura precisa conter um PNG real. Nenhum mapa de exemplo será exportado."
    );
  if (
    !Number.isFinite(Date.parse(snapshot.capturedAt)) ||
    !Array.isArray(snapshot.attributions) ||
    !Array.isArray(snapshot.legend) ||
    !Array.isArray(snapshot.warnings)
  )
    throw new Error("Metadados da captura inválidos.");
  if (
    snapshot.attributions.some(value => typeof value !== "string") ||
    snapshot.warnings.some(value => typeof value !== "string") ||
    snapshot.legend.some(item => !item || typeof item.label !== "string")
  )
    throw new Error("Legenda ou créditos da captura inválidos.");
}
export async function decodePrintSnapshot(
  snapshot: MapPrintSnapshot,
  signal: AbortSignal
): Promise<void> {
  assertPrintableSnapshot(snapshot);
  if (signal.aborted) throw new DOMException("Captura cancelada", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      image.src = "";
      reject(new DOMException("Captura cancelada", "AbortError"));
    };
    image.onload = () => {
      cleanup();
      if (
        image.naturalWidth !== snapshot.width ||
        image.naturalHeight !== snapshot.height
      )
        reject(
          new Error(
            "Os pixels do PNG não correspondem às dimensões da captura."
          )
        );
      else resolve();
    };
    image.onerror = () => {
      cleanup();
      reject(
        new Error(
          "Não foi possível ler o PNG capturado. Tente pré-visualizar novamente."
        )
      );
    };
    signal.addEventListener("abort", abort, { once: true });
    image.src = snapshot.imageDataUrl;
  });
}
export function buildPrintScene(input: PrintDocumentInput): PrintScene {
  const { snapshot, layout } = input;
  assertPrintableSnapshot(snapshot);
  const page = getPrintPageGeometry(layout);
  const geo = getPrintGeometry(
    snapshot,
    page.mapSlot.width,
    page.mapSlot.height
  );
  const mapRect = {
    x: page.mapSlot.x + geo.image.xMm,
    y: page.mapSlot.y + geo.image.yMm,
    width: geo.image.widthMm,
    height: geo.image.heightMm,
  };
  const p: Primitive[] = [],
    warnings = [...snapshot.warnings];
  const text = (
    x: number,
    y: number,
    value: string,
    size = 3,
    color = INK,
    bold = false
  ) =>
    p.push({ kind: "text", x, y, text: cleanText(value), size, color, bold });
  const line = (
    x: number,
    y: number,
    x2: number,
    y2: number,
    color = MUTED,
    width = 0.2
  ) => p.push({ kind: "line", x, y, x2, y2, color, width });
  const rect = (area: PrintRect, fill: string, stroke?: string) =>
    p.push({ kind: "rect", ...area, fill, stroke });
  rect({ x: 0, y: 0, width: page.width, height: page.height }, "#ffffff");
  const headingSize = layout.signature === "apresentacao" ? 6 : 5;
  const titleLines = wrap(
    input.title || "Mapa",
    page.header.width,
    headingSize
  );
  titleLines
    .slice(0, 2)
    .forEach((value, i) =>
      text(
        page.header.x,
        page.header.y + headingSize + i * headingSize * 1.2,
        value,
        headingSize,
        INK,
        true
      )
    );
  if (titleLines.length > 2)
    warnings.push(
      "Título abreviado na folha; o título completo está nos metadados do PDF."
    );
  const subtitleY = page.header.y + headingSize * 2.5 + 3;
  if (input.subtitle)
    wrap(input.subtitle, page.header.width, 3)
      .slice(0, 2)
      .forEach((value, i) =>
        text(page.header.x, subtitleY + i * 3.8, value, 3, MUTED)
      );
  line(
    page.header.x,
    page.header.y + page.header.height,
    page.width - 10,
    page.header.y + page.header.height,
    GREEN,
    0.6
  );
  p.push({ kind: "image", ...mapRect, src: snapshot.imageDataUrl });
  if (layout.elements.grid) {
    for (const grid of getGeographicGrid(snapshot.bounds)) {
      const label = `${Math.abs(grid.value).toFixed(4)}°${grid.axis === "longitude" ? (grid.value < 0 ? "W" : "E") : grid.value < 0 ? "S" : "N"}`;
      if (grid.axis === "longitude") {
        const x = mapRect.x + grid.position * mapRect.width;
        line(x, mapRect.y, x, mapRect.y + mapRect.height, "#ffffff", 0.4);
        line(x, mapRect.y, x, mapRect.y + mapRect.height, "#52616b", 0.12);
        const labelWidth = label.length * 1.45 + 2;
        rect(
          {
            x: x - labelWidth / 2,
            y: mapRect.y + 1,
            width: labelWidth,
            height: 4,
          },
          "#ffffff"
        );
        text(x - labelWidth / 2 + 1, mapRect.y + 4, label, 2.4);
      } else {
        const y = mapRect.y + grid.position * mapRect.height;
        line(mapRect.x, y, mapRect.x + mapRect.width, y, "#ffffff", 0.4);
        line(mapRect.x, y, mapRect.x + mapRect.width, y, "#52616b", 0.12);
        rect(
          {
            x: mapRect.x + 1,
            y: y - 3,
            width: label.length * 1.45 + 2,
            height: 4,
          },
          "#ffffff"
        );
        text(mapRect.x + 2, y, label, 2.4);
      }
    }
  }
  if (layout.elements.frame) rect(mapRect, "none", INK);
  if (layout.elements.north) {
    const x = mapRect.x + mapRect.width - 8,
      y = mapRect.y + 11;
    rect({ x: x - 5, y: y - 9, width: 10, height: 18 }, "#ffffff");
    text(x - 1.2, y - 4, "N", 3, INK, true);
    line(x, y + 6, x, y - 1, INK, 0.6);
    line(x, y - 1, x - 2, y + 2, INK, 0.5);
    line(x, y - 1, x + 2, y + 2, INK, 0.5);
  }
  if (page.legend) {
    const area = page.legend,
      padding = 2;
    text(area.x + padding, area.y + 4, "LEGENDA", 3, GREEN, true);
    const columns =
      layout.signature === "vista-livre"
        ? Math.max(1, Math.floor(area.width / 62))
        : 1;
    const columnWidth = area.width / columns;
    let column = 0,
      y = area.y + 9,
      rendered = 0;
    const items = snapshot.legend.length
      ? snapshot.legend
      : [{ label: "Sem camadas temáticas visíveis" }];
    for (const item of items) {
      const lines = wrap(item.label, columnWidth - 12, 2.7);
      const height = Math.min(2, lines.length) * 3.6 + 2;
      if (y + height > area.y + area.height - 5) {
        column++;
        y = area.y + 9;
      }
      if (column >= columns) break;
      const x = area.x + column * columnWidth + padding;
      const color =
        item.color && /^#[\da-f]{3}([\da-f]{3})?$/i.test(item.color)
          ? item.color
          : "#6d8790";
      rect({ x, y: y - 2.2, width: 3, height: 3 }, color);
      lines
        .slice(0, 2)
        .forEach((value, i) =>
          text(
            x + 5,
            y + i * 3.6,
            value + (i === 1 && lines.length > 2 ? "..." : ""),
            2.7
          )
        );
      if (lines.length > 2)
        warnings.push(`Rótulo abreviado na legenda: ${item.label}`);
      y += height;
      rendered++;
    }
    if (rendered < items.length) {
      const note = `${items.length - rendered} item(ns) adicional(is): metadados PDF`;
      text(area.x + 2, area.y + area.height - 1, note, 2.4, MUTED);
      warnings.push(
        `Legenda excede o espaço: ${items.length - rendered} item(ns) não exibido(s) na folha. Consulte os metadados do PDF.`
      );
    }
  }
  const footer = page.footer;
  line(footer.x, footer.y, page.width - 10, footer.y, GREEN, 0.4);
  const authorLine = [input.author, input.projectName, input.clientName]
    .filter(Boolean)
    .join(" · ");
  wrap(authorLine, footer.width, 2.7)
    .slice(0, 1)
    .forEach(value => text(footer.x, footer.y + 4, value, 2.7, INK));
  const scaleText = `Escala aprox. no centro 1:${Math.round(geo.scaleDenominatorApprox).toLocaleString("pt-BR")}`;
  text(
    footer.x,
    footer.y + 8,
    layout.elements.scale ? scaleText : "Vista geográfica capturada",
    2.7
  );
  const maxBarMetres = geo.groundWidthMetersApprox * 0.18;
  const magnitude = 10 ** Math.floor(Math.log10(maxBarMetres));
  const barMetres =
    [5, 2, 1].map(n => n * magnitude).find(n => n <= maxBarMetres) ??
    magnitude / 2;
  const barWidth = (barMetres / geo.groundWidthMetersApprox) * mapRect.width;
  if (layout.elements.scale) {
    const x = footer.x + footer.width - barWidth;
    line(x, footer.y + 5, x + barWidth, footer.y + 5, INK, 0.5);
    line(x, footer.y + 3.5, x, footer.y + 6, INK, 0.4);
    line(x + barWidth, footer.y + 3.5, x + barWidth, footer.y + 6, INK, 0.4);
    text(
      x,
      footer.y + 10,
      `${barMetres >= 1000 ? `${barMetres / 1000} km` : `${barMetres} m`} (aprox.)`,
      2.5
    );
  }
  const b = snapshot.bounds;
  text(
    footer.x,
    footer.y + 12,
    `EPSG:3857 · Grade em graus · N ${b.north.toFixed(5)} / S ${b.south.toFixed(5)} / E ${b.east.toFixed(5)} / W ${b.west.toFixed(5)}`,
    2.5,
    MUTED
  );
  text(
    footer.x,
    footer.y + 16,
    `Captura ${new Date(snapshot.capturedAt).toLocaleString("pt-BR")} · ${snapshot.width} × ${snapshot.height} px · ${Math.round(geo.effectiveDpi)} DPI efetivos; sem ganho artificial de detalhe`,
    2.5,
    MUTED
  );
  const credits = wrap(
    `Fontes/créditos: ${snapshot.attributions.length ? snapshot.attributions.join(" · ") : "não informados pela camada"}`,
    footer.width,
    2.4
  );
  if (credits.length > 3)
    throw new Error(
      "Créditos extensos demais para esta folha. Use um papel maior ou outra orientação para preservá-los integralmente."
    );
  credits.forEach((value, i) =>
    text(footer.x, footer.y + 20 + i * 3.1, value, 2.4, MUTED)
  );
  text(
    footer.x,
    page.height - 8,
    "Escala variável com a latitude. Uso informativo; não substitui levantamento geodésico.",
    2.4,
    MUTED
  );
  if (geo.effectiveDpi < 100)
    warnings.push(
      `Resolução efetiva baixa: ${Math.round(geo.effectiveDpi)} DPI. Papel maior não acrescenta detalhe ao mapa capturado.`
    );
  return {
    width: page.width,
    height: page.height,
    primitives: p,
    warnings: Array.from(new Set(warnings)),
    effectiveDpi: geo.effectiveDpi,
    scaleDenominator: geo.scaleDenominatorApprox,
    mapRect,
  };
}
const xml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    char =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char]!
  );
export function printSceneSvg(scene: PrintScene): string {
  const elements = scene.primitives
    .map(p => {
      if (p.kind === "image")
        return `<image x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" href="${xml(p.src)}"/>`;
      if (p.kind === "rect")
        return `<rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" fill="${p.fill}" stroke="${p.stroke || "none"}" stroke-width="0.25"/>`;
      if (p.kind === "line")
        return `<line x1="${p.x}" y1="${p.y}" x2="${p.x2}" y2="${p.y2}" stroke="${p.color}" stroke-width="${p.width || 0.2}"/>`;
      return `<text x="${p.x}" y="${p.y}" fill="${p.color}" font-family="Arial,Helvetica,sans-serif" font-size="${p.size}" font-weight="${p.bold ? "bold" : "normal"}">${xml(p.text)}</text>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}mm" height="${scene.height}mm" viewBox="0 0 ${scene.width} ${scene.height}" role="img" aria-label="Prévia do mapa capturado na folha">${elements}</svg>`;
}
export function createMapPrintPdf(
  input: PrintDocumentInput,
  scene = buildPrintScene(input)
): jsPDF {
  const pdf = new jsPDF({
    orientation: input.layout.orientation,
    unit: "mm",
    format: [scene.width, scene.height],
    compress: true,
  });
  const rgb = (hex: string) => {
    const raw = hex.slice(1);
    const value =
      raw.length === 3
        ? raw
            .split("")
            .map(char => char + char)
            .join("")
        : raw;
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
    ] as const;
  };
  for (const p of scene.primitives) {
    if (p.kind === "image") {
      pdf.addImage(
        p.src,
        "PNG",
        p.x,
        p.y,
        p.width,
        p.height,
        undefined,
        "FAST"
      );
      continue;
    }
    if (p.kind === "rect") {
      if (p.fill !== "none") pdf.setFillColor(...rgb(p.fill));
      if (p.stroke) pdf.setDrawColor(...rgb(p.stroke));
      pdf.setLineWidth(0.25);
      pdf.rect(
        p.x,
        p.y,
        p.width,
        p.height,
        p.fill === "none" ? "S" : p.stroke ? "FD" : "F"
      );
      continue;
    }
    if (p.kind === "line") {
      pdf.setDrawColor(...rgb(p.color));
      pdf.setLineWidth(p.width || 0.2);
      pdf.line(p.x, p.y, p.x2, p.y2);
      continue;
    }
    pdf.setFont("helvetica", p.bold ? "bold" : "normal");
    pdf.setFontSize((p.size * 72) / 25.4);
    pdf.setTextColor(...rgb(p.color));
    pdf.text(p.text, p.x, p.y);
  }
  pdf.setProperties({
    title: input.title,
    author: input.author,
    creator: "Atena Geoportal — impressão local",
    subject: JSON.stringify({
      project: input.projectName,
      capturedAt: input.snapshot.capturedAt,
      bounds: input.snapshot.bounds,
      crs: input.snapshot.crs,
      attributions: input.snapshot.attributions,
      legend: input.snapshot.legend,
      warnings: scene.warnings,
      scale: {
        denominatorApprox: scene.scaleDenominator,
        method: "Web Mercator × cos(latitude central)",
        effectiveDpi: scene.effectiveDpi,
      },
      layout: input.layout,
    }),
    keywords: "mapa, EPSG:3857, captura real, escala aproximada",
  });
  return pdf;
}
