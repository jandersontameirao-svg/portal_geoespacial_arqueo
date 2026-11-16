/**
 * Renderizador de prancha do Estúdio Cartográfico (SVG/PDF). Porte do núcleo de
 * preview/previa-raster/angicos/prancha.mts do Codex, GENERALIZADO: zona UTM
 * derivada das feições (não mais 24S fixa), título do produto e legenda pelas
 * próprias camadas. Compõe moldura, grade UTM, feições, legenda, norte, escala
 * e bloco de identificação. Insets de situação, bases Esri e rasters ficam para
 * um próximo incremento.
 */
import { createRequire } from "node:module";
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
export type RenderOptions = { paper?: Paper; orientation?: Orientation; title?: string; grid?: number; layout?: Layout; scale?: number; labels?: boolean };

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
  const pdf = asPdf ? new jsPDF({ orientation: options.orientation ?? "landscape", unit: "mm", format: paperSize(paper, options.orientation), compress: true, precision: 6 }) : null;
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

  const { center: [midX, midY], scale } = mapView(projection, layers, frame, options);
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

  // Mapa principal
  rect(frame.x, frame.y, frame.w, frame.h, "#ffffff");
  clip(frame.x, frame.y, frame.w, frame.h, () => {
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
  detail(345, "Fontes", 4, true);
  detail(353, "Camadas do projeto", 3.25);

  return pdf ? Buffer.from(pdf.output("arraybuffer")) : svg.join("") + "</svg>";
}
