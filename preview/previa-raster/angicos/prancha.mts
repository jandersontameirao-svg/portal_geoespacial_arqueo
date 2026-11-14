import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { defaultLayout, linearAtlasScale, paperFactor, paperSizes, type Paper, type Layout, type StudioView } from "../../previa-layout.mts";

import { mapBiomasRaster, type ThematicRaster } from "./mapbiomas.mts";

const require = createRequire(new URL("../../../package.json", import.meta.url));
const { jsPDF } = require("jspdf");
const proj4 = require("proj4");
const utm = proj4("EPSG:4326", "+proj=utm +zone=24 +south +ellps=GRS80 +units=m +no_defs");
const ink = "#202020";
const mm = 1000;
type Point = [number, number];
type Shape = { type: string; coordinates: any };
type Feature = { geometry: Shape; properties?: { SIGLA_UF?: string; nome?: string; rotulo_ibge?: Point } };
type Layer = { id?: number; name: string; layerData: { features: Feature[] }; defaultStyle?: { color?: string; weight?: number; fillOpacity?: number } };
const xml = (s: string) => s.replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

function paths(shape: Shape): { rings: Point[][]; closed: boolean }[] {
  switch (shape.type) {
    case "Point": return [{ rings: [[shape.coordinates]], closed: false }];
    case "MultiPoint": return shape.coordinates.map((point: Point) => ({ rings: [[point]], closed: false }));
    case "LineString": return [{ rings: [shape.coordinates], closed: false }];
    case "MultiLineString": return shape.coordinates.map((line: Point[]) => ({ rings: [line], closed: false }));
    case "Polygon": return [{ rings: shape.coordinates, closed: true }];
    case "MultiPolygon": return shape.coordinates.map((rings: Point[][]) => ({ rings, closed: true }));
    default: return [];
  }
}

const defaultFrame = defaultLayout.principal;
const newPdf = (paper: Paper = "A2") => new jsPDF({ orientation: "landscape", unit: "mm", format: [...paperSizes[paper]], compress: true, precision: 6 });
type Sheet = { center: Point; scale: number; number: number; total: number; grid: number; document?: any };

type Options = { paper?: Paper; view?: StudioView; available?: Layer[]; layout?: Layout; scale?: number; model?: string; grid?: number; raster?: ThematicRaster; index?: Sheet[] };
function extent(layers: Layer[]) {
  let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
  for (const layer of layers) for (const feature of layer.layerData.features) for (const part of paths(feature.geometry)) {
    for (const ring of part.rings) for (const point of ring) {
      const [x,y] = utm.forward(point);
      left = Math.min(left,x); right = Math.max(right,x);
      bottom = Math.min(bottom,y); top = Math.max(top,y);
    }
  }
  if (!Number.isFinite(left)) throw Error("Nenhuma coordenada para enquadrar a folha.");
  return { left, right, bottom, top };
}

function mapView(layers: Layer[], options: Options) {
  const frame = options.layout?.principal ?? defaultFrame;
  const focus = options.model === "detalhe" || options.model === "uso-solo"
    ? layers.filter(layer => layer.id === 15) : layers;
  const { left, right, bottom, top } = extent(focus.length ? focus : layers);
  const scale = options.scale ?? Math.max(50000, Math.ceil(Math.max((right-left)/frame.w, (top-bottom)/frame.h) * 1.1 / (50*paperFactor(options.paper ?? "A2"))) * 50000);
  const center: Point = [(left+right)/2+(options.view?.east ?? 0), (bottom+top)/2+(options.view?.north ?? 0)];
  if (options.model === "detalhe") {
    const axis = focus[0]?.layerData.features.find(feature => feature.geometry.type === "LineString");
    const points: Point[] = axis?.geometry.coordinates ?? [];
    if (points.length) return { center: utm.forward(points[Math.floor(points.length / 2)]) as Point, scale };
  }
  return { center, scale };
}

export async function printMapBiomas(layers: Layer[], options: Options) {
  const frame = options.layout?.principal ?? defaultFrame;
  const { center: [x,y], scale } = mapView(layers, options);
  const step = scale * paperFactor(options.paper ?? "A2") / 1000;
  const width = frame.w * step, height = frame.h * step;
  return mapBiomasRaster(point => utm.inverse(point), x-width/2, y+height/2, width, height);
}
export function pranchaAngicos(layers: Layer[], asPdf: boolean, sheet?: Sheet, title?: string, options: Options = {}) {
  const layout = options.layout ?? defaultLayout;
  const frame = layout.principal;
  // Shared layout for SVG preview and PDF: project the GeoJSON to UTM 24S,
  // convert metres to printed millimetres, then clip to the main map frame.
  if (!layers.length) throw new Error("Ative ao menos uma camada do projeto.");
  const states = JSON.parse(readFileSync(new URL("./estados.geojson", import.meta.url), "utf8")).features as Feature[];
  const logo = readFileSync(new URL("./logo-arqueo.png", import.meta.url)).toString("base64");
  const paper = options.paper ?? "A2";
  const factor = paperFactor(paper);
  const [paperWidth,paperHeight] = paperSizes[paper];
  const pdf = asPdf ? sheet?.document ?? newPdf(paper) : null;
  const svg = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${paperWidth/factor} ${paperHeight/factor}" width="${paperWidth}mm" height="${paperHeight}mm" font-family="Arial, sans-serif">`];
  let clipId = 0;
  const rect = (x: number, y: number, w: number, h: number, fill = "none", stroke = ink) => {
    if (pdf) {
      pdf.setLineWidth(.24*factor).setDrawColor(stroke === "none" ? fill : stroke);
      if (fill !== "none") pdf.setFillColor(fill);
      pdf.rect(x*factor, y*factor, w*factor, h*factor, fill === "none" ? "S" : stroke === "none" ? "F" : "FD");
    } else svg.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width=".24"/>`);
  };
  const label = (x: number, y: number, value: string, size = 3.5, bold = false, center = false) => {
    if (pdf) pdf.setTextColor(ink).setFont("helvetica", bold ? "bold" : "normal").setFontSize(size * factor * 72 / 25.4).text(value, x*factor, y*factor, { align: center ? "center" : "left" });
    else svg.push(`<text x="${x}" y="${y}" fill="${ink}" font-size="${size}" font-weight="${bold ? 700 : 400}" text-anchor="${center ? "middle" : "start"}">${xml(value)}</text>`);
  };
  const path = (rings: Point[][], closed: boolean, stroke: string, fill = "none", width = .35) => {
    if (pdf) {
      pdf.setLineWidth(width*factor).setDrawColor(stroke);
      if (fill !== "none") pdf.setFillColor(fill);
      pdf.path(rings.flatMap(ring => [
        ...ring.map(([x,y], i) => ({ op: i ? "l" : "m", c: [x*factor,y*factor] })),
        ...(closed ? [{ op: "h", c: [] }] : []),
      ]));
      if (fill === "none") pdf.stroke(); else pdf.fillStrokeEvenOdd();
    } else {
      const d = rings.map(r => r.map(([x,y],i) => `${i ? "L" : "M"}${x.toFixed(3)},${y.toFixed(3)}`).join("") + (closed ? "Z" : "")).join("");
      svg.push(`<path d="${d}" fill="${fill}" fill-rule="evenodd" stroke="${stroke}" stroke-width="${width}"/>`);
    }
  };
  const line = (x: number,y: number,x2: number,y2: number,color = ink,width = .24) =>
    path([[[x,y],[x2,y2]]], false, color, "none", width);
  const clip = (x: number, y: number, w: number, h: number, draw: () => void) => {
    if (pdf) pdf.saveGraphicsState().rect(x*factor,y*factor,w*factor,h*factor,null).clip().discardPath();
    else {
      const id = "clip" + ++clipId;
      svg.push(`<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath><g clip-path="url(#${id})">`);
    }
    draw();
    if (pdf) pdf.restoreGraphicsState(); else svg.push("</g>");
  };
  const drawFeatures = (features: Feature[], project: (p: Point) => Point, stroke: string, fill = "none", width = .25) => {
    for (const feature of features) {
      for (const part of paths(feature.geometry)) {
        const projected = part.rings.map(ring => ring.map(project));
        if (!part.closed && projected[0].length === 1) {
          const [x, y] = projected[0][0];
          const radius = .55;
          if (pdf) pdf.setFillColor(stroke).circle(x*factor, y*factor, radius*factor, "F");
          else svg.push(`<circle cx="${x}" cy="${y}" r="${radius}" fill="${stroke}"/>`);
        } else path(projected, part.closed, stroke, part.closed ? fill : "none", width);
      }
    }
  };
  const features = layers.flatMap(layer => layer.layerData.features);
  const { center: [midX, midY], scale } = sheet ?? mapView(layers, options);
  const step = scale * factor / mm;
  const grid = ([e,n]: Point): Point => [frame.x + frame.w/2 + (e-midX)/step, frame.y + frame.h/2 - (n-midY)/step];
  const main = (p: Point): Point => grid(utm.forward(p));
  const colors: Record<string,string> = { AII: "#d8e8ce", AID: "#f6ce64", ADA: "#e98d8c" };
  const layerFill = (layer: Layer, name: string) => {
    const style = layer.defaultStyle;
    if (name === "Eixo" || style?.fillOpacity === 0) return "none";
    if (!style?.weight || !style.color) return colors[name] ?? "none";
    const opacity = style.fillOpacity ?? .18;
    return "#" + [1,3,5].map(i => Math.round(255 * (1-opacity) + parseInt(style.color!.slice(i,i+2),16)*opacity).toString(16).padStart(2,"0")).join("");
  };
  rect(0,0,594,420,"#ffffff","none");
  rect(20,10,564,400);
  line(20,26,584,26);
  line(474,10,474,410);
  label(247,20.5,title ?? "MAPA DE LOCALIZAÇÃO | LT ANGICOS–JAGUARUANA II",5.6,true,true);
  label(529,20,"MAPAS DE SITUAÇÃO",4.3,true,true);
  rect(frame.x,frame.y,frame.w,frame.h,"#eef3f4");
  clip(frame.x,frame.y,frame.w,frame.h,() => {
    drawFeatures(states.filter(f => ["CE","RN","PB"].includes(f.properties?.SIGLA_UF || "")), main, "#a5aaa0","#f3f0e7");
    if (options.raster) {
      if (pdf) pdf.addImage(options.raster.url, "PNG", frame.x*factor, frame.y*factor, frame.w*factor, frame.h*factor);
      else svg.push(`<image href="${options.raster.url}" x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}"/>`);
    }
    for (const layer of layers) {
      const name = layer.name.replace(/\.geojson$/i,"");
      drawFeatures(layer.layerData.features, main, layer.defaultStyle?.color || "#58278d", layerFill(layer,name), layer.defaultStyle?.weight ? layer.defaultStyle.weight * .16 : name === "Eixo" ? .58 : .32);
    }
  });
  const requestedGrid = sheet?.grid ?? options.grid ?? 25000;
  const gridStep = requestedGrid * Math.max(1, Math.ceil(step * 8 / requestedGrid));
  for (const footprint of options.index ?? []) {
    const [x,y] = grid(footprint.center), ratio = footprint.scale / scale;
    rect(x-frame.w*ratio/2, y-frame.h*ratio/2, frame.w*ratio, frame.h*ratio, "none", "#1d4ed8");
    if (options.index!.length <= 24 || footprint.number === 2 || footprint.number === footprint.total || footprint.number % 10 === 0)
      label(x, y-2, String(footprint.number), options.index!.length <= 24 ? 4 : 2.8, true, true);
  }
  for (let e = Math.ceil((midX-frame.w*step/2)/gridStep)*gridStep; e <= midX+frame.w*step/2; e += gridStep) {
    const [x] = grid([e,midY]);
    line(x,frame.y,x,frame.y+frame.h,"#90978f",.1);
    label(x,frame.y-1.2,String(e),2.6,false,true);
  }
  for (let n = Math.ceil((midY-frame.h*step/2)/gridStep)*gridStep; n <= midY+frame.h*step/2; n += gridStep) {
    const [,y] = grid([midX,n]);
    line(frame.x,y,frame.x+frame.w,y,"#90978f",.1);
    label(frame.x+1,y-1,String(n),2.6);
  }
  rect(frame.x,frame.y,frame.w,frame.h);
  const labelBoxes: { left:number; right:number; top:number; bottom:number }[] = [];
  const labelFeatures = options.view?.labels === false ? [] : features;
  for (const feature of labelFeatures) {
    const { nome, rotulo_ibge } = feature.properties ?? {};
    if (!nome || !rotulo_ibge) continue;
    const [x,y] = main(rotulo_ibge);
    const w = nome.length * 1.85 + 3;
    if (x-w/2 < frame.x || x+w/2 > frame.x+frame.w || y-3 < frame.y || y+2 > frame.y+frame.h) continue;
    const box = { left:x-w/2, right:x+w/2, top:y-2.8, bottom:y+1.7 };
    if (labelBoxes.some(other => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)) continue;
    labelBoxes.push(box);
    rect(x-w/2,y-2.8,w,4.5,"#ffffff","none");
    label(x,y+.5,nome,3.4,true,true);
  }
  const [lon,lat] = utm.inverse([midX,midY]);
  const north = grid(utm.forward([lon,lat+.1]));
  const direction = Math.atan2(north[0]-(frame.x+frame.w/2), -(north[1]-(frame.y+frame.h/2)));
  const {x: northX,y: northY,w: northW,h: northH} = layout.norte;
  const nx = northX+northW/2, ny = northY+northH*.8;
  const tip: Point = [nx+Math.sin(direction)*northH*.5, ny-Math.cos(direction)*northH*.5];
  path([[[nx-northW*.15,ny],tip,[nx+northW*.15,ny],[nx,ny-northH*.1]]],true,ink,ink,.2);
  label(tip[0],tip[1]-1,"N",Math.min(northH*.22,northW*.4),true,true);
  const overview = (title: string, box: Layout["brasil"], extent: [number,number,number,number], national: boolean) => {
    const [west,south,east,north] = extent;
    const { x, y, w: width } = box;
    const heading = Math.min(7,box.h*.2), height = box.h-heading, top = y+heading;
    const overviewFactor = Math.min(width/(east-west),height/(north-south));
    const inset = options.view?.insets[national ? "brasil" : "regional"];
    const insetCenter = utm.forward(national ? [-54,-14] : [lon,lat]);
    const project = ([lo,la]: Point): Point => {
      if (!inset?.scale || national) return [x+width/2+(lo-(east+west)/2)*overviewFactor,top+height/2-(la-(south+north)/2)*overviewFactor];
      const [e,n] = utm.forward([lo,la]);
      return [x+width/2+(e-insetCenter[0])*1000/(inset.scale*factor), top+height/2-(n-insetCenter[1])*1000/(inset.scale*factor)];
    };
    rect(x,y,width,box.h,"#ffffff");
    label(x+1,y+heading*.72,inset?.scale && !national ? title + ' · 1:' + inset.scale.toLocaleString('pt-BR') : title,Math.min(3.5,width/Math.max(8,title.length*.58),heading*.7),true);
    rect(x,top,width,height,"#e8f0f2");
    clip(x,top,width,height,() => {
      drawFeatures(states,project,"#909b91","#efeee6",.13);
      const focus = states.filter(f => ["CE","RN"].includes(f.properties?.SIGLA_UF || ""));
      drawFeatures(focus,project,"#647861","#d3e1c5",.2);
      if (inset?.layers) {
        for (const id of inset.layers) {
          const layer = (options.available ?? layers).find(item => item.id === id);
          if (layer) drawFeatures(layer.layerData.features,project,layer.defaultStyle?.color ?? '#a52932','none',.35);
        }
      } else if (national) {
        const [cx,cy] = project([lon,lat]);
        rect(cx-1,cy-1,2,2,"#a52932","none");
      } else drawFeatures(features,project,"#a52932","none",.4);
    });
    rect(x,top,width,height);
  };
  for (const y of [200,269,296,325,372]) line(474,y,584,y);
  overview("Brasil",layout.brasil,[-74,-34,-34,6],true);
  overview("Região do empreendimento",layout.regional,[-41.8,-8.5,-34.6,-2.2],false);
  const legend = layout.legenda, rowHeight = legend.h / (layers.length+1+(options.raster?.legend.length ?? 0));
  const lx = legend.x + legend.w*.025, symbol = legend.w*.07;
  rect(legend.x,legend.y,legend.w,legend.h,"#ffffff");
  label(lx,legend.y+rowHeight*.75,"Legenda cartográfica",Math.min(4,rowHeight*.65,legend.w/12),true);
  layers.slice().reverse().forEach((layer,i) => {
    const name = layer.name.replace(/\.geojson$/i,""), y = legend.y + (i+1.75)*rowHeight;
    const color = layer.defaultStyle?.color || ink;
    if (layer.layerData.features.every(feature => /Point$/.test(feature.geometry.type))) {
      if (pdf) pdf.setFillColor(color).circle((lx+symbol/2)*factor, (y-1)*factor, Math.min(.8,rowHeight*.15)*factor, "F");
      else svg.push(`<circle cx="${lx+symbol/2}" cy="${y-1}" r="${Math.min(.8,rowHeight*.15)}" fill="${color}"/>`);
    } else if (name === "Eixo") line(lx,y-1,lx+symbol,y-1,color,.6);
    else rect(lx,y-rowHeight*.35,symbol,rowHeight*.38,layerFill(layer,name),color);
    const caption = ({ Eixo:"Eixo da linha de transmissão", ADA:"ADA · faixa de 30 m por lado", AID:"AID · faixa de 250 m por lado", AII:"AII · municípios interceptados" } as Record<string,string>)[name] || name;
    label(lx+symbol+legend.w*.03,y,caption,Math.min(3.5,rowHeight*.65,legend.w*.84/(caption.length*.62)));
  });
  options.raster?.legend.forEach(({ color, name }, i) => {
    const y = legend.y + (layers.length+i+1.75)*rowHeight;
    rect(lx,y-rowHeight*.55,symbol,rowHeight*.42,color,color);
    label(lx+symbol+legend.w*.03,y,name,Math.min(3.5,rowHeight*.68));
  });
  label(479,277,"Referência geodésica",4,true);
  label(479,285,"SIRGAS2000 / UTM 24S");
  label(479,291,"EPSG:31984 · grade em metros",3);
  label(479,303,"Escala do mapa principal",4,true);
  const distance = Math.min(sheet ? 5000 : 20000, 10 ** Math.floor(Math.log10(step*75))), bar = distance / step;
  for (let i=0;i<4;i++) rect(479+i*bar/4,308,bar/4,2,i%2 ? "#ffffff" : ink);
  label(479,315,"0",2.8);
  label(479+bar,315,distance >= 1000 ? `${distance/1000} km` : `${distance} m`,2.8,false,true);
  label(479,321,"1:" + scale.toLocaleString("pt-BR"),3.5,true);
  label(479,333,"Identificação da folha",4,true);
  label(479,341,"Projeto  LT Angicos–Jaguaruana II");
  label(479,348,`Folha  ${paper} · ${String(sheet?.number ?? 1).padStart(2,"0")}/${String(sheet?.total ?? 1).padStart(2,"0")}`);
  label(479,355,"Fontes  Camadas do projeto · IBGE 2024",3.25);
  label(479,362,options.raster ? "MapBiomas 2024 · Imagem/ArcGIS · CC BY 4.0" : "Responsável  __________________",3.25);
  const logoUrl = "data:image/png;base64," + logo;
  if (pdf) pdf.addImage(logoUrl,"PNG",509*factor,381*factor,40*factor,20*factor);
  else svg.push(`<image href="${logoUrl}" x="509" y="381" width="40" height="20" preserveAspectRatio="none"/>`);
  return sheet?.document ? null : pdf ? Buffer.from(pdf.output("arraybuffer")) : svg.join("") + "</svg>";
}

// Each sheet covers frame size × scale in UTM metres. Rows run north to south.
// The configured overlap repeats part of the previous sheet without changing scale.
function planSheets(layers: Layer[], columns: number, rows: number, overlap: number, grid: number, options: Options): Sheet[] {
  const frame = options.layout?.principal ?? defaultFrame;
  if (![columns, rows].every(n => Number.isInteger(n) && n >= 1 && n <= 8) ||
      columns * rows > 24 || !Number.isFinite(overlap) || overlap < 0 || overlap > 30 ||
      !Number.isInteger(grid) || grid < 1000 || grid > 50000) throw Error("Grade de atlas inválida.");
  const points = layers.flatMap(layer => layer.layerData.features.flatMap(feature =>
    paths(feature.geometry).flatMap(part => part.rings.flat().map(p => utm.forward(p) as Point))));
  if (!points.length) throw Error("Ative pelo menos uma camada com coordenadas.");
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const factor = paperFactor(options.paper ?? 'A2');
  const fraction = 1 - overlap / 100;
  const width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys);
  const scale = options.scale ?? Math.max(100000, Math.ceil(Math.max(width / (frame.w * (1+(columns-1)*fraction)),
    height / (frame.h * (1+(rows-1)*fraction))) * 1.05 / (25*factor)) * 25000);
  const center = [(Math.max(...xs)+Math.min(...xs))/2, (Math.max(...ys)+Math.min(...ys))/2];
  const sheets: Sheet[] = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const number = row * columns + col + 1;
    sheets.push({ center: [
      center[0] + (col-(columns-1)/2) * frame.w * scale * factor / 1000 * fraction,
      center[1] - (row-(rows-1)/2) * frame.h * scale * factor / 1000 * fraction,
    ], scale, number, total: rows*columns, grid });
  }
  return sheets;
}

// Walk the projected axis by cumulative length. Each sheet covers a length
// equal to its shorter side, so bends remain inside the north-up map frame.
export function corridorSheets(layers: Layer[], overlap: number, grid: number, options: Options): Sheet[] {
  if (!Number.isFinite(overlap) || overlap < 0 || overlap > 30 || !Number.isInteger(grid) || grid < 100 || grid > 50000)
    throw Error("Confira a sobreposição e a grade UTM.");
  const axis = layers.find(layer => layer.id === 15)?.layerData.features;
  if (axis?.length !== 1 || axis[0].geometry.type !== "LineString") throw Error("Selecione um eixo contínuo.");
  const points: Point[] = axis[0].geometry.coordinates.map((point: Point) => utm.forward(point));
  const distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i-1] + Math.hypot(points[i][0]-points[i-1][0], points[i][1]-points[i-1][1]));
  const length = distances.at(-1) ?? 0;
  if (!length) throw Error("O eixo precisa ter extensão maior que zero.");
  const scale = options.scale ?? linearAtlasScale;
  const frame = options.layout?.principal ?? defaultFrame;
  const coverage = Math.min(frame.w, frame.h) * scale * paperFactor(options.paper ?? 'A2') / 1000;
  const total = 1 + Math.ceil(Math.max(0,length-coverage) / (coverage*(1-overlap/100)));
  if (total > 480) throw Error("Aumente o denominador da escala para gerar até 480 folhas.");
  return Array.from({ length: total }, (_, i) => {
    const target = total === 1 ? length/2 : coverage/2 + i*(length-coverage)/(total-1);
    const end = distances.findIndex(distance => distance >= target);
    const ratio = (target-distances[end-1]) / (distances[end]-distances[end-1]);
    const center = points[end-1].map((value,k) => value + ratio*(points[end][k]-value)) as Point;
    return { center, scale, number: i+2, total: total+1, grid };
  });
}

export function corridorAtlas(layers: Layer[], sheets: Sheet[], pdf: boolean, page: number, title: string | undefined, options: Options, single = false) {
  const frame = options.layout?.principal ?? defaultFrame;
  if (!Number.isInteger(page) || page < 0 || page > sheets.length) throw Error('Folha fora do atlas.');
  const west = Math.min(...sheets.map(sheet => sheet.center[0])), east = Math.max(...sheets.map(sheet => sheet.center[0]));
  const south = Math.min(...sheets.map(sheet => sheet.center[1])), north = Math.max(...sheets.map(sheet => sheet.center[1]));
  const detail = sheets[0].scale;
  const factor = paperFactor(options.paper ?? 'A2');
  const scale = Math.ceil(Math.max((east-west)/(frame.w*factor) + detail/1000, (north-south)/(frame.h*factor) + detail/1000)*1.12/25)*25000;
  const index: Sheet = { center: [(east+west)/2,(north+south)/2], scale, number: 1, total: sheets.length+1, grid: 25000 };
  const indexTitle = "Mapa índice | LT Angicos–Jaguaruana II";
  const detailTitle = title ?? "Atlas por corredor | LT Angicos–Jaguaruana II";
  if (!pdf || single) return page === 0 ? pranchaAngicos(layers, pdf, index, indexTitle, { ...options, index: sheets })
    : pranchaAngicos(layers, pdf, sheets[page-1], detailTitle, options);
  const document = newPdf(options.paper);
  pranchaAngicos(layers, true, { ...index, document }, indexTitle, { ...options, index: sheets });
  for (const sheet of sheets) {
    document.addPage();
    pranchaAngicos(layers, true, { ...sheet, document }, detailTitle, options);
  }
  return Buffer.from(document.output("arraybuffer"));
}

export function atlasAngicos(layers: Layer[], columns: number, rows: number, overlap: number, grid: number, title?: string, options: Options = {}) {
  const document = newPdf(options.paper);
  for (const sheet of planSheets(layers, columns, rows, overlap, grid, options)) {
    if (sheet.number > 1) document.addPage();
    pranchaAngicos(layers, true, { ...sheet, document }, title, options);
  }
  return Buffer.from(document.output("arraybuffer"));
}

export function atlasView(layers: Layer[], columns: number, rows: number, overlap: number, grid: number, page: number, title?: string, options: Options = {}) {
  const sheets = planSheets(layers, columns, rows, overlap, grid, options);
  if (page > 0 && sheets[page-1]) return pranchaAngicos(layers, false, sheets[page-1], title, options);
  const frame = options.layout?.principal ?? defaultFrame;
  const metres = sheets[0].scale * paperFactor(options.paper ?? 'A2') / 1000;
  const west = sheets[0].center[0] - frame.w * metres / 2;
  const north = sheets[0].center[1] + frame.h * metres / 2;
  const [lastX,lastY] = sheets.at(-1)!.center;
  const width = (lastX-west)/metres + frame.w/2, height = (north-lastY)/metres + frame.h/2;
  const position = ([x,y]: Point) => [(x-west)/metres,(north-y)/metres];
  const outlines = layers.flatMap(layer => layer.layerData.features.flatMap(feature => paths(feature.geometry)
    .filter(part => part.rings[0].length > 1).map(part => {
      const d = part.rings.map(ring => ring.map((p,i) => (i ? "L" : "M") + position(utm.forward(p)).map(v => v.toFixed(2)).join(",")).join("") + (part.closed ? "Z" : "")).join("");
      return `<path d="${d}" fill="none" stroke="${layer.defaultStyle?.color ?? "#334155"}" stroke-width="2"/>`;
    })));
  const boxes = sheets.map(sheet => {
    const [x,y] = position(sheet.center);
    return `<rect x="${x-frame.w/2}" y="${y-frame.h/2}" width="${frame.w}" height="${frame.h}" fill="#60a5fa" fill-opacity=".07" stroke="#1d4ed8" stroke-width="2"/><text x="${x}" y="${y}" font-size="32" text-anchor="middle" fill="#172554">${sheet.number}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 ${width+20} ${height+20}" font-family="sans-serif"><rect width="${width}" height="${height}" fill="#f8fafc"/>${outlines.join("")}${boxes.join("")}</svg>`;
}

export function studioReview(layers: Layer[], sheets: Sheet[] | undefined, options: Options) {
  const frame = options.layout?.principal ?? defaultLayout.principal;
  const { center, scale } = sheets?.[0] ?? mapView(layers, options);
  const factor = paperFactor(options.paper ?? 'A2');
  const warnings: string[] = [];
  const layout = options.layout ?? defaultLayout;
  if (frame.x < 20 || frame.y < 28 || frame.x+frame.w > 474 || frame.y+frame.h > 410)
    warnings.push("O quadro principal ultrapassa a área útil do modelo.");
  const insets = [layout.legenda, layout.brasil, layout.regional];
  if (insets.some((a,i) => insets.slice(i+1).some(b => a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y)))
    warnings.push("A legenda e os mapas de situação têm elementos sobrepostos.");
  if (!sheets && options.model !== "detalhe") {
    const axis = layers.filter(layer => layer.id === 15);
    const bounds = extent(axis.length ? axis : layers);
    const [x,y] = center;
    if (bounds.left < x-frame.w*scale*factor/2000 || bounds.right > x+frame.w*scale*factor/2000 ||
        bounds.bottom < y-frame.h*scale*factor/2000 || bounds.top > y+frame.h*scale*factor/2000)
      warnings.push("O quadro principal corta parte da área de referência.");
  }
  if (options.model === "uso-solo") warnings.push("O detalhe do MapBiomas depende da resolução dos blocos publicados.");
  return { scale, sheets: sheets?.length ?? 0, warnings, widthKm: frame.w*scale*factor/1e6, heightKm: frame.h*scale*factor/1e6 };
}
