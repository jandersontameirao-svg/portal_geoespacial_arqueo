/**
 * Renderizador de prancha do Estúdio Cartográfico (SVG/PDF). Porte do núcleo de
 * preview/previa-raster/angicos/prancha.mts do Codex, GENERALIZADO: zona UTM
 * derivada das feições (não mais 24S fixa), título do produto e legenda pelas
 * próprias camadas. Compõe moldura, grade UTM, feições, legenda, norte, escala
 * e bloco de identificação. Insets de situação, bases Esri e rasters ficam para
 * um próximo incremento.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import nodePath from "node:path";
import proj4 from "proj4";
import { defaultLayout, portraitLayout, paperSize, paperFactor, type Layout, type Orientation, type Paper } from "../shared/studioLayout";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { jsPDF } = require("jspdf");

const ink = "#202020";
const mm = 1000;
type Point = [number, number];
type Shape = { type: string; coordinates: any };
type Feature = { geometry: Shape; properties?: Record<string, unknown> | null };
export type RenderLayer = { id?: number; name: string; layerData: { features: Feature[] }; defaultStyle?: { color?: string; weight?: number; fillOpacity?: number } | null };
export type Sheet = { center: Point; scale: number; number?: number; total?: number; grid?: number };
export type RenderOptions = { paper?: Paper; orientation?: Orientation; title?: string; grid?: number; layout?: Layout; scale?: number; labels?: boolean; sheet?: Sheet; document?: any; index?: Sheet[]; background?: string; baseImages?: { principal?: string }; marks?: { empresaImage?: string; empresaName?: string; clienteImage?: string; clienteName?: string } };

const xml = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]!));

function paths(shape: Shape): { rings: Point[][]; closed: boolean }[] {
  switch (shape.type) {
    case "Point": return [{ rings: [[shape.coordinates]], closed: false }];
    case "MultiPoint": return shape.coordinates.map((p: Point) => ({ rings: [[p]], closed: false }));
    case "LineString": return [{ rings: [shape.coordinates], closed: false }];
    case "MultiLineString": return shape.coordinates.map((l: Point[]) => ({ rings: [l], closed: false }));
    case "Polygon": return [{ rings: shape.coordinates, closed: true }];
    case "MultiPolygon": return shape.coordinates.map((r: Point[][]) => ({ rings: r, closed: true }));
    default: return [];
  }
}

/** Projeção UTM (SIRGAS2000/GRS80) da zona que contém o centro das feições. */
function utmFor(layers: RenderLayer[]) {
  let sumLon = 0, sumLat = 0, count = 0, south = false;
  for (const layer of layers) for (const feature of layer.layerData.features) for (const part of paths(feature.geometry)) {
    for (const ring of part.rings) for (const [lon, lat] of ring) {
      sumLon += lon; sumLat += lat; count++; if (lat < 0) south = true;
    }
  }
  if (!count) throw new Error("Nenhuma coordenada para enquadrar a folha.");
  const lon = sumLon / count;
  const zone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
  const epsg = (sumLat / count) < 0 ? 31978 + zone - 17 : 31960 + zone; // referência informativa
  const projection = proj4("EPSG:4326", `+proj=utm +zone=${zone}${south ? " +south" : ""} +ellps=GRS80 +units=m +no_defs`);
  return { projection, zone, south, epsg };
}

// Estados do IBGE (para os quadros de situação). Vazio se os dados não estiverem
// no servidor (ARQUEO_IBGE_DATA_DIR ou <app>/data/ibge) — os insets degradam.
let estadosCache: { geometry: Shape }[] | null = null;
function studioEstados(): { geometry: Shape }[] {
  if (estadosCache) return estadosCache;
  const dir = process.env.ARQUEO_IBGE_DATA_DIR?.trim() || nodePath.resolve(process.cwd(), "data/ibge");
  const file = nodePath.join(dir, "estados.geojson");
  if (!existsSync(file)) { estadosCache = []; return estadosCache; }
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    estadosCache = (data.features ?? []).map((f: any) => ({ geometry: f.geometry }));
  } catch { estadosCache = []; }
  return estadosCache!;
}
const brazilProjection = proj4("EPSG:4326", "+proj=lcc +lat_1=-5 +lat_2=-25 +lat_0=-14 +lon_0=-54 +ellps=GRS80 +units=m +no_defs");

function lonLatBounds(layers: RenderLayer[]) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const layer of layers) for (const feature of layer.layerData.features) for (const part of paths(feature.geometry)) {
    for (const ring of part.rings) for (const [lon, lat] of ring) {
      west = Math.min(west, lon); east = Math.max(east, lon); south = Math.min(south, lat); north = Math.max(north, lat);
    }
  }
  return { west, south, east, north, lon: (west + east) / 2, lat: (south + north) / 2 };
}

function extent(projection: any, layers: RenderLayer[]) {
  let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
  for (const layer of layers) for (const feature of layer.layerData.features) for (const part of paths(feature.geometry)) {
    for (const ring of part.rings) for (const point of ring) {
      const [x, y] = projection.forward(point);
      left = Math.min(left, x); right = Math.max(right, x);
      bottom = Math.min(bottom, y); top = Math.max(top, y);
    }
  }
  if (!Number.isFinite(left)) throw new Error("Nenhuma coordenada para enquadrar a folha.");
  return { left, right, bottom, top };
}

function mapView(projection: any, layers: RenderLayer[], frame: Layout["principal"], options: RenderOptions) {
  const { left, right, bottom, top } = extent(projection, layers);
  const factor = paperFactor(options.paper ?? "A2");
  const scale = options.scale ?? Math.max(1000, Math.ceil(Math.max((right - left) / frame.w, (top - bottom) / frame.h) * 1.1 / (50 * factor)) * 50000);
  const center: Point = [(left + right) / 2, (bottom + top) / 2];
  return { center, scale };
}

export function renderPrancha(layers: RenderLayer[], asPdf: boolean, options: RenderOptions = {}): string | Buffer {
  if (!layers.length) throw new Error("Ative ao menos uma camada do projeto.");
  const portrait = options.orientation === "portrait";
  const layout = options.layout ?? (portrait ? portraitLayout : defaultLayout);
  const frame = layout.principal;
  const paper = options.paper ?? "A2";
  const factor = paperFactor(paper);
  const [paperWidth, paperHeight] = paperSize(paper, options.orientation);
  const pageWidth = portrait ? 420 : 594, pageHeight = portrait ? 594 : 420;

  const { projection, zone, south } = utmFor(layers);
  const pdf = asPdf ? (options.document ?? new jsPDF({ orientation: options.orientation ?? "landscape", unit: "mm", format: paperSize(paper, options.orientation), compress: true, precision: 6 })) : null;
  const svg = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${paperWidth / factor} ${paperHeight / factor}" width="${paperWidth}mm" height="${paperHeight}mm" font-family="Arial, sans-serif">`];
  let clipId = 0;

  const rect = (x: number, y: number, w: number, h: number, fill = "none", stroke = ink) => {
    if (pdf) {
      pdf.setLineWidth(.24 * factor).setDrawColor(stroke === "none" ? fill : stroke);
      if (fill !== "none") pdf.setFillColor(fill);
      pdf.rect(x * factor, y * factor, w * factor, h * factor, fill === "none" ? "S" : stroke === "none" ? "F" : "FD");
    } else svg.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width=".24"/>`);
  };
  const label = (x: number, y: number, value: string, size = 3.5, bold = false, center = false) => {
    if (pdf) pdf.setTextColor(ink).setFont("helvetica", bold ? "bold" : "normal").setFontSize(size * factor * 72 / 25.4).text(value, x * factor, y * factor, { align: center ? "center" : "left" });
    else svg.push(`<text x="${x}" y="${y}" fill="${ink}" font-size="${size}" font-weight="${bold ? 700 : 400}" text-anchor="${center ? "middle" : "start"}">${xml(value)}</text>`);
  };
  const path = (rings: Point[][], closed: boolean, stroke: string, fill = "none", width = .35, opacity = 1) => {
    if (pdf) {
      if (opacity < 1) pdf.saveGraphicsState().setGState(new pdf.GState({ opacity }));
      pdf.setLineWidth(width * factor).setDrawColor(stroke);
      if (fill !== "none") pdf.setFillColor(fill);
      pdf.path(rings.flatMap((ring) => [
        ...ring.map(([x, y], i) => ({ op: i ? "l" : "m", c: [x * factor, y * factor] })),
        ...(closed ? [{ op: "h", c: [] }] : []),
      ]));
      if (fill === "none") pdf.stroke(); else pdf.fillStrokeEvenOdd();
      if (opacity < 1) pdf.restoreGraphicsState();
    } else {
      const d = rings.map((r) => r.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(3)},${y.toFixed(3)}`).join("") + (closed ? "Z" : "")).join("");
      svg.push(`<path d="${d}" fill="${fill}" fill-opacity="${opacity}" fill-rule="evenodd" stroke="${stroke}" stroke-width="${width}"/>`);
    }
  };
  const line = (x: number, y: number, x2: number, y2: number, color = ink, width = .24) => path([[[x, y], [x2, y2]]], false, color, "none", width);
  const clip = (x: number, y: number, w: number, h: number, draw: () => void) => {
    if (pdf) pdf.saveGraphicsState().rect(x * factor, y * factor, w * factor, h * factor, null).clip().discardPath();
    else { const id = "clip" + ++clipId; svg.push(`<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath><g clip-path="url(#${id})">`); }
    draw();
    if (pdf) pdf.restoreGraphicsState(); else svg.push("</g>");
  };
  const drawFeatures = (features: Feature[], project: (p: Point) => Point, stroke: string, fill = "none", width = .25, opacity = 1) => {
    for (const feature of features) for (const part of paths(feature.geometry)) {
      const projected = part.rings.map((ring) => ring.map(project));
      if (!part.closed && projected[0].length === 1) {
        const [x, y] = projected[0][0];
        if (pdf) pdf.setFillColor(stroke).circle(x * factor, y * factor, .55 * factor, "F");
        else svg.push(`<circle cx="${x}" cy="${y}" r="0.55" fill="${stroke}"/>`);
      } else if (projected[0].length > 1) {
        path(projected, part.closed, stroke, part.closed ? fill : "none", width, part.closed ? opacity : 1);
      }
    }
  };

  const { center: [midX, midY], scale } = options.sheet ?? mapView(projection, layers, frame, options);
  const step = scale * factor / mm;
  const grid = ([e, n]: Point): Point => [frame.x + frame.w / 2 + (e - midX) / step, frame.y + frame.h / 2 - (n - midY) / step];
  const main = (p: Point): Point => grid(projection.forward(p));

  const layerFill = (layer: RenderLayer) => {
    const style = layer.defaultStyle;
    if (!style?.color || style.fillOpacity === 0) return "none";
    const opacity = style.fillOpacity ?? .18;
    return "#" + [1, 3, 5].map((i) => Math.round(255 * (1 - opacity) + parseInt(style.color!.slice(i, i + 2), 16) * opacity).toString(16).padStart(2, "0")).join("");
  };

  // Moldura e cabeçalho
  rect(0, 0, pageWidth, pageHeight, "#ffffff", "none");
  rect(20, 10, pageWidth - 30, pageHeight - 20);
  line(20, 26, pageWidth - 10, 26);
  if (portrait) { line(20, 428, 410, 428); line(202, 428, 202, 584); } else { line(474, 10, 474, 410); label(529, 20, "IDENTIFICAÇÃO", 4.3, true, true); }
  const heading = options.title || "Mapa de localização";
  label(portrait ? 215 : 247, 20.5, heading, Math.min(5.6, (portrait ? 370 : 440) / (heading.length * .62)), true, true);

  const baseImage = (url: string, x: number, y: number, w: number, h: number) => {
    if (pdf) pdf.addImage(url, "PNG", x * factor, y * factor, w * factor, h * factor);
    else svg.push(`<image href="${url}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none"/>`);
  };

  // Mapa principal
  rect(frame.x, frame.y, frame.w, frame.h, "#ffffff");
  clip(frame.x, frame.y, frame.w, frame.h, () => {
    if (options.baseImages?.principal) baseImage(options.baseImages.principal, frame.x, frame.y, frame.w, frame.h);
    for (const layer of layers) {
      drawFeatures(layer.layerData.features, main, layer.defaultStyle?.color ?? "#1d4ed8", layerFill(layer),
        layer.defaultStyle?.weight ? layer.defaultStyle.weight * .16 : .32, layer.defaultStyle?.fillOpacity ?? 1);
    }
  });

  // Grade UTM
  const requestedGrid = options.grid ?? 25000;
  const gridStep = requestedGrid * Math.max(1, Math.ceil(step * 8 / requestedGrid));
  for (let e = Math.ceil((midX - frame.w * step / 2) / gridStep) * gridStep; e <= midX + frame.w * step / 2; e += gridStep) {
    const [x] = grid([e, midY]); line(x, frame.y, x, frame.y + frame.h, "#90978f", .1); label(x, frame.y - 1.2, String(e), 2.6, false, true);
  }
  for (let n = Math.ceil((midY - frame.h * step / 2) / gridStep) * gridStep; n <= midY + frame.h * step / 2; n += gridStep) {
    const [, y] = grid([midX, n]); line(frame.x, y, frame.x + frame.w, y, "#90978f", .1); label(frame.x + 1, y - 1, String(n), 2.6);
  }
  // Quadrinhos das folhas (mapa índice do atlas)
  for (const fp of options.index ?? []) {
    const [fx, fy] = grid(fp.center), ratio = fp.scale / scale;
    rect(fx - frame.w * ratio / 2, fy - frame.h * ratio / 2, frame.w * ratio, frame.h * ratio, "none", "#1d4ed8");
    if ((options.index!.length <= 24) || (fp.number ?? 0) % 5 === 0) label(fx, fy - 2, String(fp.number ?? ""), options.index!.length <= 24 ? 4 : 2.8, true, true);
  }
  rect(frame.x, frame.y, frame.w, frame.h);

  // Norte (aponta para o norte geográfico projetado)
  const [lon, lat] = projection.inverse([midX, midY]);
  const north = grid(projection.forward([lon, lat + .1]));
  const direction = Math.atan2(north[0] - (frame.x + frame.w / 2), -(north[1] - (frame.y + frame.h / 2)));
  const { x: northX, y: northY, w: northW, h: northH } = layout.norte;
  const nx = northX + northW / 2, ny = northY + northH * .8;
  const tip: Point = [nx + Math.sin(direction) * northH * .5, ny - Math.cos(direction) * northH * .5];
  path([[[nx - northW * .15, ny], tip, [nx + northW * .15, ny], [nx, ny - northH * .1]]], true, ink, ink, .2);
  label(tip[0], tip[1] - 1, "N", Math.min(northH * .22, northW * .4), true, true);

  // Quadros de situação (nacional e regional)
  const features = layers.flatMap((l) => l.layerData.features);
  const lonLat = lonLatBounds(layers);
  const states = studioEstados();
  const padLon = Math.max(0.6, (lonLat.east - lonLat.west) * 0.6);
  const padLat = Math.max(0.6, (lonLat.north - lonLat.south) * 0.6);
  const drawOverview = (heading2: string, box: Layout["brasil"], national: boolean) => {
    if (!box) return;
    const proj = national ? brazilProjection : projection;
    const [w, s, e, nth] = national ? [-74, -34, -34, 6] : [lonLat.west - padLon, lonLat.south - padLat, lonLat.east + padLon, lonLat.north + padLat];
    const corners = ([[w, s], [w, nth], [e, s], [e, nth]] as Point[]).map((p) => proj.forward(p) as Point);
    const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
    const left = Math.min(...xs), right = Math.max(...xs), bottom = Math.min(...ys), top = Math.max(...ys);
    const headingH = Math.min(7, box.h * 0.2), height = box.h - headingH;
    const scaleOv = Math.max(1, Math.ceil(Math.max((right - left) / box.w, (top - bottom) / height) * 1080 / factor));
    const cx = (left + right) / 2, cy = (bottom + top) / 2, headTop = box.y + headingH;
    const project = ([lo, la]: Point): Point => {
      const [px, py] = proj.forward([lo, la]);
      return [box.x + box.w / 2 + (px - cx) * 1000 / (scaleOv * factor), headTop + height / 2 - (py - cy) * 1000 / (scaleOv * factor)];
    };
    rect(box.x, box.y, box.w, box.h, "#ffffff");
    label(box.x + 1, box.y + headingH * 0.72, `${heading2} · 1:${scaleOv.toLocaleString("pt-BR")}`, Math.min(3.2, box.w / Math.max(8, heading2.length * 0.58), headingH * 0.7), true);
    rect(box.x, headTop, box.w, height, "#eef3f4");
    clip(box.x, headTop, box.w, height, () => {
      if (states.length) drawFeatures(states as unknown as Feature[], project, "#a5aaa0", "#f3f0e7", 0.13);
      if (national) { const [mx, my] = project([lonLat.lon, lonLat.lat]); rect(mx - 1, my - 1, 2, 2, "#a52932", "none"); }
      else drawFeatures(features, project, "#a52932", "none", 0.4);
    });
    rect(box.x, headTop, box.w, height);
  };
  drawOverview("Brasil", layout.brasil, true);
  drawOverview("Região do empreendimento", layout.regional, false);

  // Legenda
  const legend = layout.legenda, rowHeight = legend.h / (layers.length + 1);
  const lx = legend.x + legend.w * .025, symbol = legend.w * .07;
  rect(legend.x, legend.y, legend.w, legend.h, "#ffffff");
  label(lx, legend.y + rowHeight * .75, "Legenda", Math.min(4, rowHeight * .65, legend.w / 12), true);
  layers.slice().reverse().forEach((layer, i) => {
    const name = layer.name.replace(/\.geojson$/i, ""), y = legend.y + (i + 1.75) * rowHeight;
    const color = layer.defaultStyle?.color ?? ink;
    if (layer.layerData.features.every((f) => /Point$/.test(f.geometry.type))) {
      if (pdf) pdf.setFillColor(color).circle((lx + symbol / 2) * factor, (y - rowHeight * .22) * factor, Math.min(.8, rowHeight * .15) * factor, "F");
      else svg.push(`<circle cx="${lx + symbol / 2}" cy="${y - rowHeight * .22}" r="${Math.min(.8, rowHeight * .15)}" fill="${color}"/>`);
    } else if (layer.layerData.features.every((f) => /LineString$/.test(f.geometry.type))) {
      line(lx, y - 1, lx + symbol, y - 1, color, .6);
    } else {
      const top = y - rowHeight * .35, bottom = top + rowHeight * .38;
      path([[[lx, top], [lx + symbol, top], [lx + symbol, bottom], [lx, bottom]]], true, color, layerFill(layer), .24);
    }
    label(lx + symbol + legend.w * .03, y, name, Math.min(3.5, rowHeight * .65, legend.w * .84 / (name.length * .62)));
  });

  // Bloco de identificação (referência, escala, folha, fontes)
  const detailX = portrait ? 211 : 479;
  const detailY = portrait ? 436 : 277;
  const detail = (y: number, value: string, size?: number, bold?: boolean) => label(detailX, detailY + y - 277, value, size, bold);
  detail(277, "Referência geodésica", 4, true);
  detail(285, `SIRGAS2000 / UTM ${zone}${south ? "S" : "N"}`);
  detail(291, "Grade em metros", 3);
  detail(303, "Escala do mapa principal", 4, true);
  const distance = Math.min(20000, 10 ** Math.floor(Math.log10(step * 75))), bar = distance / step;
  for (let i = 0; i < 4; i++) rect(detailX + i * bar / 4, detailY + 31, bar / 4, 2, i % 2 ? "#ffffff" : ink);
  detail(315, "0", 2.8);
  label(detailX + bar, detailY + 38, distance >= 1000 ? `${distance / 1000} km` : `${distance} m`, 2.8, false, true);
  detail(321, "1:" + scale.toLocaleString("pt-BR"), 3.5, true);
  if (options.sheet?.number !== undefined) {
    detail(333, "Identificação da folha", 4, true);
    detail(341, options.sheet.number === 0 ? `Mapa índice · ${paper}` : `Folha ${paper} · ${String(options.sheet.number).padStart(2, "0")}/${String(options.sheet.total ?? 1).padStart(2, "0")}`);
  }
  detail(345, "Fontes", 4, true);
  detail(353, "Camadas do projeto", 3.25);

  // Marcas da folha (identidade visual) — logo da empresa e do cliente.
  let markY = 362;
  const drawMark = (image: string | undefined, name: string | undefined, caption: string) => {
    if (!image) return;
    detail(markY, caption + (name ? " · " + name : ""), 3.25, true);
    baseImage(image, detailX, detailY + (markY + 3) - 277, 34, 11);
    markY += 22;
  };
  drawMark(options.marks?.empresaImage, options.marks?.empresaName, "Empresa");
  drawMark(options.marks?.clienteImage, options.marks?.clienteName, "Cliente");

  if (options.document) return "";
  return pdf ? Buffer.from(pdf.output("arraybuffer")) : svg.join("") + "</svg>";
}

// ── Atlas multipágina ───────────────────────────────────────────────────────

/** Calcula as folhas (centros em UTM) para cobrir a extensão por colunas×linhas. */
export function planSheets(layers: RenderLayer[], columns: number, rows: number, overlap: number, grid: number, options: RenderOptions = {}): Sheet[] {
  const portrait = options.orientation === "portrait";
  const frame = (options.layout ?? (portrait ? portraitLayout : defaultLayout)).principal;
  if (![columns, rows].every((n) => Number.isInteger(n) && n >= 1 && n <= 8) || columns * rows > 24 ||
    !Number.isFinite(overlap) || overlap < 0 || overlap > 30 || !Number.isInteger(grid) || grid < 1000 || grid > 50000) {
    throw new Error("Grade de atlas inválida (até 24 folhas, sobreposição 0–30%, grade 1–50 km).");
  }
  const { projection } = utmFor(layers);
  const { left, right, bottom, top } = extent(projection, layers);
  const factor = paperFactor(options.paper ?? "A2");
  const fraction = 1 - overlap / 100;
  const width = right - left, height = top - bottom;
  const scale = options.scale ?? Math.max(1000, Math.ceil(Math.max(
    width / (frame.w * (1 + (columns - 1) * fraction)), height / (frame.h * (1 + (rows - 1) * fraction))) * 1.05 / (25 * factor)) * 25000);
  const cx = (left + right) / 2, cy = (bottom + top) / 2;
  const sheets: Sheet[] = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    sheets.push({
      center: [cx + (col - (columns - 1) / 2) * frame.w * scale * factor / 1000 * fraction,
        cy - (row - (rows - 1) / 2) * frame.h * scale * factor / 1000 * fraction],
      scale, number: row * columns + col + 1, total: rows * columns, grid,
    });
  }
  return sheets;
}

/** PDF do atlas: mapa índice + uma folha de detalhe por quadro. */
export function renderAtlas(layers: RenderLayer[], columns: number, rows: number, overlap: number, grid: number, options: RenderOptions = {}): Buffer {
  if (!layers.length) throw new Error("Ative ao menos uma camada do projeto.");
  const sheets = planSheets(layers, columns, rows, overlap, grid, options);
  const factor = paperFactor(options.paper ?? "A2");
  const portrait = options.orientation === "portrait";
  const frame = (options.layout ?? (portrait ? portraitLayout : defaultLayout)).principal;
  const [west, north] = sheets[0].center;
  const [east, south] = sheets.at(-1)!.center;
  const required = sheets[0].scale + 1000 * Math.max((east - west) / (frame.w * factor), (north - south) / (frame.h * factor));
  const doc = new jsPDF({ orientation: options.orientation ?? "landscape", unit: "mm", format: paperSize(options.paper ?? "A2", options.orientation), compress: true, precision: 6 });
  const index: Sheet = { center: [(west + east) / 2, (north + south) / 2], scale: Math.max(1000, Math.ceil(required * 1.08 / 25000) * 25000), number: 0, total: sheets.length, grid };
  renderPrancha(layers, true, { ...options, document: doc, sheet: index, index: sheets, title: (options.title || "Atlas") + " · mapa índice" });
  for (const sheet of sheets) {
    doc.addPage(paperSize(options.paper ?? "A2", options.orientation), options.orientation ?? "landscape");
    renderPrancha(layers, true, { ...options, document: doc, sheet });
  }
  return Buffer.from(doc.output("arraybuffer"));
}

// ── Bases Esri (fundo de satélite/cinza do mapa principal) ──────────────────

const esriServices = {
  "esri-imagery": "World_Imagery",
  "esri-light-gray": "Canvas/World_Light_Gray_Base",
  "esri-dark-gray": "Canvas/World_Dark_Gray_Base",
} as const;
type EsriBase = keyof typeof esriServices;
function isEsriBase(id: string | undefined): id is EsriBase {
  return !!id && Object.hasOwn(esriServices, id);
}
const esriCache = new Map<string, Promise<string>>();

/**
 * Imagem Esri (ArcGIS Online) que cobre o quadro principal, em WebMercator,
 * para preencher a moldura como fundo. Com cache e timeout; sem reprojeção
 * pixel-a-pixel (aproximação aceitável no tamanho de um quadro).
 */
async function esriImage(id: EsriBase, projection: any, center: Point, widthM: number, heightM: number, pixels: number): Promise<string> {
  const key = JSON.stringify([id, center.map((v) => Math.round(v)), Math.round(widthM), Math.round(heightM), pixels]);
  const cached = esriCache.get(key);
  if (cached) return cached;
  const pending = (async () => {
    const mercator = proj4("EPSG:4326", "EPSG:3857");
    const samples: Point[] = [];
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
      const lonlat = projection.inverse([center[0] + (i / 8 - .5) * widthM, center[1] + (j / 8 - .5) * heightM]);
      samples.push(mercator.forward(lonlat) as Point);
    }
    const xs = samples.map((p) => p[0]), ys = samples.map((p) => p[1]);
    const west = Math.min(...xs), east = Math.max(...xs), south = Math.min(...ys), north = Math.max(...ys);
    const rows = Math.max(64, Math.round(pixels * (north - south) / (east - west)));
    const query = new URLSearchParams({ bbox: [west, south, east, north].join(","), bboxSR: "3857", imageSR: "3857", size: pixels + "," + rows, format: "png32", transparent: "true", f: "image" });
    const response = await fetch("https://server.arcgisonline.com/ArcGIS/rest/services/" + esriServices[id] + "/MapServer/export?" + query, { signal: AbortSignal.timeout(15000) });
    if (!response.ok || !response.headers.get("content-type")?.includes("image/png")) throw new Error("O mapa-base Esri está indisponível para esta folha.");
    return "data:image/png;base64," + Buffer.from(await response.arrayBuffer()).toString("base64");
  })();
  if (esriCache.size >= 40) esriCache.delete(esriCache.keys().next().value!);
  esriCache.set(key, pending);
  pending.catch(() => esriCache.delete(key));
  return pending;
}

/** Busca a imagem de fundo do quadro principal quando o fundo é uma base Esri. */
export async function prepareBaseImages(layers: RenderLayer[], options: RenderOptions = {}): Promise<{ principal?: string }> {
  if (!isEsriBase(options.background)) return {};
  const portrait = options.orientation === "portrait";
  const frame = (options.layout ?? (portrait ? portraitLayout : defaultLayout)).principal;
  const { projection } = utmFor(layers);
  const { center, scale } = options.sheet ?? mapView(projection, layers, frame, options);
  const factor = paperFactor(options.paper ?? "A2");
  try {
    const principal = await esriImage(options.background, projection, center, frame.w * scale * factor / 1000, frame.h * scale * factor / 1000, 750);
    return { principal };
  } catch {
    return {};
  }
}
