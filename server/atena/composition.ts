/**
 * Composição cartográfica: gera PDF A3 ou A4 com geometrias reais, título,
 * legenda, escala gráfica, norte da projeção, sistema de referência, fontes,
 * data e tabela de áreas. A escala é arredondada e a barra de escala é
 * desenhada com essa mesma escala, então o desenho é fiel.
 *
 * Limite desta versão: sem mapa-base (tiles). O desenho é vetorial sobre fundo
 * branco; mapa-base fica para uma próxima habilidade.
 */
import { jsPDF } from "jspdf";
import { proj4 } from "./proj";
import type { AtenaRun } from "../../drizzle/schema";
import { validateClosedPolygonCoordinates } from "../../shared/geometry-coordinates";

export const PAGE = {
  A3: { w: 420, h: 297 },
  A4: { w: 297, h: 210 },
} as const;

export type PageSize = keyof typeof PAGE;

export type Ring = [number, number][];
export type PolygonRings = Ring[];
export type ItemKind = "ref" | "source" | "result" | "aid" | "aii" | "mun" | "point" | "line" | "sitio";
export type MapItem = {
  kind: ItemKind;
  name: string;
  polygons?: PolygonRings[];
  lines?: number[][][];
  points?: number[][];
  legendLabel?: string;
};

export class InvalidMapGeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMapGeometryError";
  }
}

/** Converte GeoJSON Polygon/MultiPolygon em componentes compostos, sem duplicar a topologia compartilhada. */
export function geometryToMapPolygons(geometry: unknown, label = "geometria"): PolygonRings[] {
  if (typeof geometry !== "object" || geometry === null || !("type" in geometry) || !("coordinates" in geometry)) {
    throw new InvalidMapGeometryError(`${label}: geometria GeoJSON inválida.`);
  }
  const candidate = geometry as { type?: unknown; coordinates?: unknown };
  if (candidate.type !== "Polygon" && candidate.type !== "MultiPolygon") {
    throw new InvalidMapGeometryError(`${label}: tipo ${String(candidate.type)} não é Polygon nem MultiPolygon.`);
  }
  try {
    const shape = validateClosedPolygonCoordinates(candidate.coordinates, "geojson-lng-lat");
    if (shape.type !== candidate.type) {
      throw new InvalidMapGeometryError(`${label}: estrutura ${candidate.type} incompatível.`);
    }
    return shape.type === "Polygon"
      ? [shape.coordinates as PolygonRings]
      : shape.coordinates as PolygonRings[];
  } catch (error) {
    if (error instanceof InvalidMapGeometryError) throw error;
    throw new InvalidMapGeometryError(`${label}: ${error instanceof Error ? error.message : "geometria poligonal inválida."}`);
  }
}

function validateMapItem(item: MapItem): MapItem {
  const polygons = (item.polygons ?? []).flatMap((polygon, index) =>
    geometryToMapPolygons({ type: "Polygon", coordinates: polygon }, `${item.name}, polígono ${index + 1}`));
  const lines = (item.lines ?? []).map((line, lineIndex) => {
    if (line.length < 2) throw new InvalidMapGeometryError(`${item.name}, linha ${lineIndex + 1}: são necessários ao menos dois vértices.`);
    return line;
  });
  const points = (item.points ?? []).map((point, index) => {
    if (point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[0] < -180 || point[0] > 180 || point[1] < -90 || point[1] > 90) {
      throw new InvalidMapGeometryError(`${item.name}, ponto ${index + 1}: coordenada [lng,lat] inválida ou fora dos limites WGS84.`);
    }
    return point;
  });
  if (polygons.length === 0 && lines.length === 0 && points.length === 0) {
    throw new InvalidMapGeometryError(`${item.name}: item sem geometria válida para desenhar.`);
  }
  return { ...item, polygons, lines, points };
}

const DEFAULT_LABEL: Record<ItemKind, string> = {
  ref: "Área de referência",
  aid: "Área de influência direta (AID)",
  aii: "Área de influência indireta (AII)",
  mun: "Limites municipais",
  source: "Camada de origem",
  result: "Resultado da análise",
  point: "Ocorrência",
  line: "Linha",
  sitio: "Perímetro de sítio",
};

/** Coordenadas [lng,lat] de um item, em qualquer tipo de geometria. */
export function coordsOf(it: MapItem): number[][] {
  const out: number[][] = [];
  for (const polygon of it.polygons ?? []) for (const ring of polygon) out.push(...ring);
  for (const l of it.lines ?? []) out.push(...l);
  for (const p of it.points ?? []) out.push(p);
  return out;
}

/** Recorte de segmento ao retângulo (Liang-Barsky). Retorna null se fora. */
export function clipSegment(a: number[], b: number[], r: { x0: number; y0: number; x1: number; y1: number }) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const tests: Array<[number, number]> = [[-dx, a[0] - r.x0], [dx, r.x1 - a[0]], [-dy, a[1] - r.y0], [dy, r.y1 - a[1]]];
  for (const [p, q] of tests) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
    else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
}

export type ComposeInput = {
  run: Pick<AtenaRun, "id" | "projectId" | "finishedAt" | "codeVersion"> & { skillVersions: unknown; plan: unknown; outputs: unknown; inputs: unknown };
  title: string;
  pageSize: PageSize;
  orientation: "landscape" | "portrait";
  items: MapItem[];
  proj: { code: string; def: string; epsgUtm: string; utmZone: number; lat0: number; lng0: number };
  table: Array<{ sourceName: string; sourceAreaM2: number | null; intersectionAreaM2: number | null; percentInside: number | null }>;
  sources: string[];
  referenceName: string | null;
  generatedAt: Date;
  /** Observações exibidas no rodapé (pendências, avisos, revisões). */
  notes?: string[];
  /** Linha de cabeçalho opcional (ex.: modelo e versão). */
  headerLine?: string;
};

/** Escala denominador arredondada que cabe o extent na moldura. */
export function chooseScale(extentW: number, extentH: number, frameWmm: number, frameHmm: number) {
  const metersPerMm = Math.max(extentW / frameWmm, extentH / frameHmm) * 1.08;
  const raw = metersPerMm * 1000;
  const nice = [500, 1000, 2000, 2500, 5000, 10000, 15000, 20000, 25000, 50000, 100000, 250000, 500000];
  return nice.find(n => n >= raw) ?? Math.ceil(raw / 50000) * 50000;
}

export function renderMapPdf(input: ComposeInput): Buffer {
  const items = input.items.map(validateMapItem);
  const { w: pw, h: ph } = PAGE[input.pageSize];
  const W = input.orientation === "landscape" ? pw : ph;
  const H = input.orientation === "landscape" ? ph : pw;
  const doc = new jsPDF({ unit: "mm", format: [W, H], orientation: input.orientation });
  doc.setFont("helvetica", "normal");

  // Moldura e cabeçalho
  const margin = 10;
  doc.setLineWidth(0.4); doc.rect(margin, margin, W - 2 * margin, H - 2 * margin);
  doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text(input.title, margin + 4, margin + 9);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(input.headerLine ?? `Projeto ${input.run.projectId} · Execução Atena ${input.run.id}`, margin + 4, margin + 14);

  // Painel lateral (legenda + tabela) e área do mapa
  const sideW = 105;
  const mapX = margin + 4, mapY = margin + 20;
  const mapW = W - 2 * margin - sideW - 12, mapH = H - mapY - margin - 24;
  const sideX = W - margin - sideW - 4, sideY = mapY;

  // Coordenadas em metros na projeção local
  // Enquadramento: área de referência e resultados. Origens fora do quadro são recortadas.
  const frameKinds: ItemKind[] = ["ref", "aid", "aii", "result", "point", "line", "sitio"];
  const frameItems = items.filter(i => frameKinds.includes(i.kind));
  const pts: number[][] = [];
  for (const it of (frameItems.length ? frameItems : items)) pts.push(...coordsOf(it));
  const toM = (lng: number, lat: number) => proj4("EPSG:4674", input.proj.code, [lng, lat]);
  const m = pts.map(([lng, lat]) => toM(lng, lat));
  if (m.length === 0) throw new Error("Sem geometrias para desenhar");
  const minX = Math.min(...m.map(p => p[0])), maxX = Math.max(...m.map(p => p[0]));
  const minY = Math.min(...m.map(p => p[1])), maxY = Math.max(...m.map(p => p[1]));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const scale = chooseScale(maxX - minX || 1, maxY - minY || 1, mapW, mapH);
  const metersPerMm = scale / 1000;
  const toPage = (lng: number, lat: number) => {
    const [x, y] = toM(lng, lat);
    return [mapX + mapW / 2 + (x - cx) / metersPerMm, mapY + mapH / 2 - (y - cy) / metersPerMm];
  };

  // Moldura do mapa e grade
  doc.setDrawColor(120); doc.setLineWidth(0.3); doc.rect(mapX, mapY, mapW, mapH);
  doc.setDrawColor(200); doc.setLineWidth(0.1);
  const step = niceStep(metersPerMm * mapW);
  const x0 = Math.ceil((cx - (mapW / 2) * metersPerMm) / step) * step;
  for (let gx = x0; gx < cx + (mapW / 2) * metersPerMm; gx += step) {
    const px = mapX + mapW / 2 + (gx - cx) / metersPerMm;
    doc.line(px, mapY, px, mapY + mapH);
  }
  const y0 = Math.ceil((cy - (mapH / 2) * metersPerMm) / step) * step;
  for (let gy = y0; gy < cy + (mapH / 2) * metersPerMm; gy += step) {
    const py = mapY + mapH / 2 - (gy - cy) / metersPerMm;
    doc.line(mapX, py, mapX + mapW, py);
  }

  // Desenho das camadas: referência, origens e resultados
  const style: Record<ItemKind, { fill: number[] | null; stroke: number[]; dash: boolean }> = {
    ref: { fill: null, stroke: [30, 30, 30], dash: true },
    aid: { fill: null, stroke: [37, 99, 235], dash: true },
    aii: { fill: null, stroke: [126, 34, 206], dash: false },
    mun: { fill: [246, 246, 240], stroke: [120, 120, 110], dash: false },
    source: { fill: [220, 225, 235], stroke: [90, 100, 120], dash: false },
    result: { fill: [249, 115, 22], stroke: [150, 60, 10], dash: false },
    point: { fill: [220, 38, 38], stroke: [255, 255, 255], dash: false },
    line: { fill: null, stroke: [21, 128, 61], dash: false },
    sitio: { fill: [191, 219, 254], stroke: [30, 64, 175], dash: false },
  };
  let outside = 0;
  const clipBox = { x0: mapX, y0: mapY, x1: mapX + mapW, y1: mapY + mapH };
  const inBox = (p: number[]) => p[0] >= clipBox.x0 && p[0] <= clipBox.x1 && p[1] >= clipBox.y0 && p[1] <= clipBox.y1;
  // Ordem z: mun, fundo, origem, referência/AID/AII, resultados, linhas, pontos
  const zOrder: ItemKind[] = ["mun", "source", "sitio", "aii", "aid", "ref", "result", "line", "point"];
  const ordered = [...items].sort((a, b) => zOrder.indexOf(a.kind) - zOrder.indexOf(b.kind));
  doc.saveGraphicsState();
  doc.rect(mapX, mapY, mapW, mapH, null);
  doc.clip();
  doc.discardPath();
  for (const it of ordered) {
    const st = style[it.kind];
    doc.setLineWidth(it.kind === "aii" ? 0.7 : it.kind === "ref" || it.kind === "aid" ? 0.6 : 0.3);
    doc.setDrawColor(...(st.stroke as [number, number, number]));
    if (st.fill) doc.setFillColor(...(st.fill as [number, number, number]));
    if (st.dash) doc.setLineDashPattern(it.kind === "ref" ? [2, 1.5] : [3, 1.2, 0.5, 1.2], 0); else doc.setLineDashPattern([], 0);
    for (const polygon of it.polygons ?? []) {
      const pageRings = polygon.map(ring => ring.map(([lng, lat]) => toPage(lng, lat)));
      const clippedExterior = clipPolygon(pageRings[0], clipBox);
      if (clippedExterior.length < 3) { if (it.kind === "source") outside++; continue; }
      if (st.fill) {
        const path: Array<{ op: "m" | "l" | "h"; c: number[] }> = [];
        for (const ring of pageRings) {
          path.push({ op: "m", c: ring[0] });
          for (const point of ring.slice(1, -1)) path.push({ op: "l", c: point });
          path.push({ op: "h", c: [] });
        }
        doc.path(path);
        doc.fillStrokeEvenOdd();
      } else {
        for (const ring of pageRings) {
          const segs = ring.slice(1, -1).map((point, index) => [point[0] - ring[index][0], point[1] - ring[index][1]] as [number, number]);
          doc.lines(segs, ring[0][0], ring[0][1], [1, 1], "S", true);
        }
      }
    }
    for (const line of it.lines ?? []) {
      const pl = line.map(([lng, lat]) => toPage(lng, lat));
      for (let i = 0; i < pl.length - 1; i++) {
        const seg = clipSegment(pl[i], pl[i + 1], clipBox);
        if (seg) { doc.setLineWidth(0.5); doc.line(seg[0][0], seg[0][1], seg[1][0], seg[1][1]); }
      }
    }
    for (const pt of it.points ?? []) {
      const [x, y] = toPage(pt[0], pt[1]);
      if (!inBox([x, y])) { outside++; continue; }
      doc.setFillColor(...(st.fill as [number, number, number]));
      doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.2);
      doc.circle(x, y, 1.3, "FD");
    }
  }
  doc.restoreGraphicsState();
  doc.setDrawColor(120); doc.setLineWidth(0.3); doc.rect(mapX, mapY, mapW, mapH);
  if (input.notes && input.notes.length) {
    doc.setFontSize(7); doc.setTextColor(40);
    const shown = input.notes.slice(0, 4);
    const baseY = H - margin - 14 - 4 - (shown.length - 1) * 3.2;
    shown.forEach((n, i) => doc.text(n.slice(0, 110), sideX, baseY + i * 3.2));
    doc.setTextColor(0);
  }
  if (outside > 0) {
    doc.setFontSize(7); doc.setTextColor(60);
    doc.text(outside + " origem(ns) fora do quadro não desenhada(s); a tabela de áreas é completa.", mapX + 2, mapY + mapH - 2);
    doc.setTextColor(0);
  }
  doc.setLineDashPattern([], 0);

  // Legenda
  let ly = sideY;
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text("Legenda", sideX, ly); ly += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  const legend: Array<{ label: string; kind: ItemKind }> = [];
  const seen = new Set<string>();
  for (const it of items) {
    const label = it.legendLabel ?? DEFAULT_LABEL[it.kind];
    if (seen.has(label)) continue;
    seen.add(label);
    legend.push({ label, kind: it.kind });
  }
  for (const L of legend) {
    const st = style[L.kind];
    if (st.fill) doc.setFillColor(...(st.fill as [number, number, number]));
    doc.setDrawColor(...(st.stroke as [number, number, number]));
    doc.setLineWidth(0.4);
    if (st.dash) doc.setLineDashPattern([1.5, 1], 0); else doc.setLineDashPattern([], 0);
    if (L.kind === "point") { doc.setFillColor(...(st.fill as [number, number, number])); doc.circle(sideX + 3, ly - 1, 1.3, "F"); }
    else if (L.kind === "line") { doc.line(sideX, ly - 1, sideX + 6, ly - 1); }
    else doc.rect(sideX, ly - 3, 6, 4, st.fill ? "FD" : "S");
    doc.setLineDashPattern([], 0);
    doc.setTextColor(0);
    doc.text(L.label.slice(0, 70), sideX + 9, ly); ly += 6;
  }

  // Escala gráfica e norte
  ly += 4;
  const barM = niceBelow(metersPerMm * 40);
  const barMm = barM / metersPerMm;
  doc.setLineWidth(0.5); doc.line(sideX, ly + 4, sideX + barMm, ly + 4);
  doc.line(sideX, ly + 2.5, sideX, ly + 5.5); doc.line(sideX + barMm, ly + 2.5, sideX + barMm, ly + 5.5);
  doc.setFontSize(8); doc.text(`${barM >= 1000 ? barM / 1000 + " km" : barM + " m"}`, sideX, ly + 9);
  doc.text(`Escala aproximada 1:${scale.toLocaleString("pt-BR")}`, sideX + barMm + 3, ly + 4);
  // Seta do norte da grade
  const nx = mapX + mapW - 8, ny = mapY + 16;
  doc.setLineWidth(0.5); doc.line(nx, ny + 8, nx, ny - 4); doc.line(nx, ny - 4, nx - 2, ny); doc.line(nx, ny - 4, nx + 2, ny);
  doc.setFont("helvetica", "bold"); doc.text("N", nx - 1.2, ny - 6);
  doc.setFont("helvetica", "normal");
  ly += 16;

  // Tabela de áreas (só quando há áreas calculadas)
  if (input.table.length > 0) {
    // Tabela de áreas
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text("Áreas (ha)", sideX, ly); ly += 5;
    doc.setFontSize(8);
    const cols = [sideX, sideX + 52, sideX + 78, sideX + 96];
    doc.text("Sítio / origem", cols[0], ly); doc.text("Total", cols[1], ly); doc.text("Na área", cols[2], ly); doc.text("%", cols[3], ly);
    ly += 1; doc.line(sideX, ly, sideX + sideW, ly); ly += 4;
    doc.setFont("helvetica", "normal");
    const ha = (m2: number | null) => m2 == null ? "–" : (m2 / 10000).toFixed(2).replace(".", ",");
    const rows = input.table.filter(r => r.sourceName !== "Área de referência");
    for (const r of rows.slice(0, 22)) {
      doc.text(r.sourceName.slice(0, 30), cols[0], ly);
      doc.text(ha(r.sourceAreaM2), cols[1], ly, { align: "left" });
      doc.text(ha(r.intersectionAreaM2), cols[2], ly, { align: "left" });
      doc.text(r.percentInside == null ? "–" : r.percentInside.toFixed(1).replace(".", ","), cols[3], ly);
      ly += 4.2;
    }
    if (rows.length > 22) { doc.text(`... e mais ${rows.length - 22} linha(s) no relatório da execução`, sideX, ly); ly += 4; }
    const ref = input.table.find(r => r.sourceName === "Área de referência");
    if (ref) { doc.setFont("helvetica", "bold"); doc.text(`Área de referência: ${ha(ref.sourceAreaM2)} ha`, sideX, ly); doc.setFont("helvetica", "normal"); }
  }

  // Rodapé: SRC, fontes, data
  const fy = H - margin - 14;
  doc.setFontSize(7);
  doc.text(`Sistema de referência: SIRGAS 2000 (EPSG:4674). Áreas e distâncias: UTM SIRGAS 2000, zona ${input.proj.utmZone} (${input.proj.epsgUtm}), centro ${input.proj.lat0.toFixed(4)}, ${input.proj.lng0.toFixed(4)}.`, margin + 4, fy, { maxWidth: W - 2 * margin - 8 });
  doc.text(`Fontes: ${input.sources.join("; ")}`, margin + 4, fy + 4, { maxWidth: W - 2 * margin - 8 });
  doc.text(`Motor: ${input.run.codeVersion} · habilidades: ${Object.entries(input.run.skillVersions as Record<string, string>).map(([k, v]) => `${k} v${v}`).join(", ")} · data: ${input.generatedAt.toLocaleDateString("pt-BR")} · sem mapa-base`, margin + 4, fy + 8, { maxWidth: W - 2 * margin - 8 });

  return Buffer.from(doc.output("arraybuffer"));
}

/** Recorte de polígono a um retângulo (Sutherland-Hodgman), em coordenadas de página. */
export function clipPolygon(poly: number[][], b: { x0: number; y0: number; x1: number; y1: number }): number[][] {
  // k: 0 esquerda, 1 direita, 2 base, 3 topo
  const inside = (p: number[], k: number) =>
    k === 0 ? p[0] >= b.x0 : k === 1 ? p[0] <= b.x1 : k === 2 ? p[1] >= b.y0 : p[1] <= b.y1;
  const cut = (a: number[], c: number[], k: number): number[] => {
    const vertical = k < 2;
    const bound = k === 0 ? b.x0 : k === 1 ? b.x1 : k === 2 ? b.y0 : b.y1;
    const idx = vertical ? 0 : 1;
    const t = (bound - a[idx]) / (c[idx] - a[idx]);
    return [a[0] + t * (c[0] - a[0]), a[1] + t * (c[1] - a[1])];
  };
  let out = poly.slice();
  for (let k = 0; k < 4; k++) {
    const input = out; out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length];
      const curIn = inside(cur, k), prevIn = inside(prev, k);
      if (curIn) {
        if (!prevIn) out.push(cut(prev, cur, k));
        out.push(cur);
      } else if (prevIn) out.push(cut(prev, cur, k));
    }
    if (out.length === 0) break;
  }
  return out;
}

/** Maior valor "redondo" (1, 2, 5 x 10^n) não superior a t metros. */
function niceBelow(t: number) {
  const pow = Math.pow(10, Math.floor(Math.log10(t)));
  for (const f of [5, 2, 1]) if (f * pow <= t) return f * pow;
  return pow / 2;
}

function niceStep(spanM: number) {
  const raw = spanM / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const f of [1, 2, 5, 10]) if (f * pow >= raw) return f * pow;
  return 10 * pow;
}
