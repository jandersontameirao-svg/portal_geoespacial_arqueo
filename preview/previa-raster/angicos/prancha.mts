import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { studioSymbolPoints, type StudioVectorStyle, defaultLayout, linearAtlasScale, paperFactor, paperSize, portraitLayout, type Orientation, type Paper, type Layout, type StudioBackground, type StudioView } from "../../previa-layout.mts";

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

const backgroundStyles: Partial<Record<StudioBackground, {water:string; land:string; border:string; focus:string}>> = {
  cartografico:{water:"#eef3f4",land:"#f3f0e7",border:"#a5aaa0",focus:"#d3e1c5"},
  claro:{water:"#fafafa",land:"#e6e8eb",border:"#a0a6ad",focus:"#ccd1d7"},
  branco:{water:"#ffffff",land:"#ffffff",border:"#a5aaa0",focus:"#ffffff"},
  nenhum:{water:"#ffffff",land:"none",border:"none",focus:"none"},
};
const defaultFrame = defaultLayout.principal;
const newPdf = (paper: Paper = "A2", orientation: Orientation = "landscape") => new jsPDF({ orientation, unit: "mm", format: paperSize(paper, orientation), compress: true, precision: 6 });
type Sheet = { center: Point; scale: number; number: number; total: number; grid: number; document?: any };

type Options = { baseImages?: Partial<Record<"principal"|"brasil"|"regional",string>>; brands?: ({image:string; width:number; height:number} | undefined)[]; paper?: Paper; orientation?: Orientation; view?: StudioView; available?: Layer[]; layout?: Layout; scale?: number; model?: string; grid?: number; raster?: ThematicRaster; index?: Sheet[] };
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

const brazilProjection = proj4("EPSG:4326", "+proj=lcc +lat_1=-5 +lat_2=-25 +lat_0=-14 +lon_0=-54 +ellps=GRS80 +units=m +no_defs");
const overviewExtents = { brasil: [-74,-34,-34,6], regional: [-41.8,-8.5,-34.6,-2.2] } as const;

function overviewView(key: "brasil" | "regional", options: Options) {
  const layout = options.layout ?? defaultLayout;
  const box = layout[key];
  const [west,south,east,north] = overviewExtents[key];
  const projection = key === "brasil" ? brazilProjection : utm;
  const corners: Point[] = [[west,south],[west,north],[east,south],[east,north]];
  const points = corners.map(point => projection.forward(point) as Point);
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const left = Math.min(...xs), right = Math.max(...xs), bottom = Math.min(...ys), top = Math.max(...ys);
  const inset = options.view?.insets[key];
  const heading = Math.min(7,box.h*.2), height = box.h-heading;
  const scale = inset?.scale ?? Math.ceil(Math.max((right-left)/box.w,(top-bottom)/height)*1080/paperFactor(options.paper ?? "A2"));
  return { projection, scale, heading, height, center: [(left+right)/2+(inset?.east ?? 0),(top+bottom)/2+(inset?.north ?? 0)] };
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
    if (points.length) {
      const [x,y] = utm.forward(points[Math.floor(points.length / 2)]);
      return { center: [x+(options.view?.east ?? 0),y+(options.view?.north ?? 0)] as Point, scale };
    }
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
  const layout = options.layout ?? (options.orientation === 'portrait' ? portraitLayout : defaultLayout);
  const frame = layout.principal;
  // Shared layout for SVG preview and PDF: project the GeoJSON to UTM 24S,
  // convert metres to printed millimetres, then clip to the main map frame.
  if (!layers.length) throw new Error("Ative ao menos uma camada do projeto.");
  const states = JSON.parse(readFileSync(new URL("./estados.geojson", import.meta.url), "utf8")).features as Feature[];

  const paper = options.paper ?? "A2";
  const factor = paperFactor(paper);
  const portrait = options.orientation === 'portrait';
  const [paperWidth,paperHeight] = paperSize(paper, options.orientation);
  const pageWidth = portrait ? 420 : 594, pageHeight = portrait ? 594 : 420;
  const pdf = asPdf ? sheet?.document ?? newPdf(paper, options.orientation) : null;
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
  const path = (rings: Point[][], closed: boolean, stroke: string, fill = "none", width = .35, opacity = 1) => {
    if (pdf) {
      if (opacity < 1) pdf.saveGraphicsState().setGState(new pdf.GState({opacity}));
      pdf.setLineWidth(width*factor).setDrawColor(stroke);
      if (fill !== "none") pdf.setFillColor(fill);
      pdf.path(rings.flatMap(ring => [
        ...ring.map(([x,y], i) => ({ op: i ? "l" : "m", c: [x*factor,y*factor] })),
        ...(closed ? [{ op: "h", c: [] }] : []),
      ]));
      if (fill === "none") pdf.stroke(); else pdf.fillStrokeEvenOdd();
      if (opacity < 1) pdf.restoreGraphicsState();
    } else {
      const d = rings.map(r => r.map(([x,y],i) => `${i ? "L" : "M"}${x.toFixed(3)},${y.toFixed(3)}`).join("") + (closed ? "Z" : "")).join("");
      svg.push(`<path d="${d}" fill="${fill}" fill-opacity="${opacity}" fill-rule="evenodd" stroke="${stroke}" stroke-width="${width}"/>`);
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
  const marker = (x:number,y:number,color:string,radius:number,style?:StudioVectorStyle) => {
    if (!style?.symbol || style.symbol === "circulo") {
      if (pdf) pdf.setFillColor(color).circle(x*factor,y*factor,radius*factor,"F");
      else svg.push(`<circle cx="${x}" cy="${y}" r="${radius}" fill="${color}"/>`);
    } else {
      const points=studioSymbolPoints(style.symbol).map(([dx,dy]) => [x+dx*radius,y+dy*radius]);
      if (pdf) {
        pdf.setFillColor(color).path([
          ...points.map(([px,py],i) => ({op:i?"l":"m",c:[px*factor,py*factor]})),{op:"h",c:[]},
        ]).fill();
      } else svg.push(`<polygon fill="${color}" points="${points.map(p => p.join(",")).join(" ")}"/>`);
    }
  };
  const drawFeatures = (features: Feature[], project: (p: Point) => Point, stroke: string, fill = "none", width = .25, opacity = 1, style?:StudioVectorStyle) => {
    for (const feature of features) {
      for (const part of paths(feature.geometry)) {
        const projected = part.rings.map(ring => ring.map(project));
        if (!part.closed && projected[0].length === 1) {
          const [x, y] = projected[0][0];
          marker(x,y,style?.color ?? stroke,style?.sizeMm === undefined ? .55 : style.sizeMm/(2*factor),style);
        } else if (projected[0].length > 1) {
          path(projected,part.closed,part.closed ? stroke : style?.color ?? stroke,part.closed ? fill : "none",
            !part.closed && style?.widthMm !== undefined ? style.widthMm/factor : width,part.closed ? opacity : 1);
        }
      }
    }
  };
  const features = layers.flatMap(layer => layer.layerData.features);
  const { center: [midX, midY], scale } = sheet ?? mapView(layers, options);
  const step = scale * factor / mm;
  const grid = ([e,n]: Point): Point => [frame.x + frame.w/2 + (e-midX)/step, frame.y + frame.h/2 - (n-midY)/step];
  const main = (p: Point): Point => grid(utm.forward(p));
  const colors: Record<string,string> = { AII: "#d8e8ce", AID: "#f6ce64", ADA: "#e98d8c" };
  const vectorStyle = (layer:Layer) => options.view?.vectorStyles?.[String(layer.id)];
  const areaStyle = (layer:Layer) => options.view?.areaStyles?.[String(layer.id)];
  const layerFill = (layer: Layer, name: string) => {
    const custom = areaStyle(layer);
    if (custom) return custom.opacity === 0 ? "none" : custom.color;
    const style = layer.defaultStyle;
    if (name === "Eixo" || style?.fillOpacity === 0) return "none";
    if (!style?.weight || !style.color) return colors[name] ?? "none";
    const opacity = style.fillOpacity ?? .18;
    return "#" + [1,3,5].map(i => Math.round(255 * (1-opacity) + parseInt(style.color!.slice(i,i+2),16)*opacity).toString(16).padStart(2,"0")).join("");
  };
  rect(0,0,pageWidth,pageHeight,"#ffffff","none");
  rect(20,10,pageWidth-30,pageHeight-20);
  line(20,26,pageWidth-10,26);
  if (portrait) {
    line(20,428,410,428);
    line(202,428,202,584);
  } else {
    line(474,10,474,410);
    label(529,20,"MAPAS DE SITUAÇÃO",4.3,true,true);
  }
  const heading = title ?? "MAPA DE LOCALIZAÇÃO | LT ANGICOS–JAGUARUANA II";
  label(portrait ? 215 : 247,20.5,heading,Math.min(5.6,(portrait ? 370 : 440)/(heading.length*.62)),true,true);
  const baseImage = (url:string,x:number,y:number,w:number,h:number) => {
    if (pdf) pdf.addImage(url,"PNG",x*factor,y*factor,w*factor,h*factor);
    else svg.push(`<image href="${url}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none"/>`);
  };
  const background = options.view?.background ?? "cartografico";
  const base = backgroundStyles[background] ?? backgroundStyles.cartografico!;
  rect(frame.x,frame.y,frame.w,frame.h,base.water);
  clip(frame.x,frame.y,frame.w,frame.h,() => {
    if (options.baseImages?.principal) baseImage(options.baseImages.principal,frame.x,frame.y,frame.w,frame.h);
    else if (background !== "nenhum") drawFeatures(states.filter(f => ["CE","RN","PB"].includes(f.properties?.SIGLA_UF || "")),main,base.border,base.land);
    if (options.raster) {
      if (pdf) pdf.addImage(options.raster.url, "PNG", frame.x*factor, frame.y*factor, frame.w*factor, frame.h*factor);
      else svg.push(`<image href="${options.raster.url}" x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}"/>`);
    }
    for (const layer of layers) {
      const name = layer.name.replace(/\.geojson$/i,"");
      drawFeatures(layer.layerData.features, main, (areaStyle(layer)?.strokeColor ?? areaStyle(layer)?.color) ?? layer.defaultStyle?.color ?? "#58278d", layerFill(layer,name), (areaStyle(layer)?.strokeMm !== undefined ? areaStyle(layer)!.strokeMm!/factor : layer.defaultStyle?.weight ? layer.defaultStyle.weight * .16 : name === "Eixo" ? .58 : .32),areaStyle(layer)?.opacity || 1,vectorStyle(layer));
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
  const overview = (title: string, box: Layout["brasil"], national: boolean) => {
    const { x, y, w: width } = box;
    const key = national ? "brasil" : "regional";
    const { heading,height,scale,center:insetCenter,projection } = overviewView(key,options);
    const top = y+heading;
    const inset = options.view?.insets[key];
    const project = ([lo,la]: Point): Point => {
      const [e,n] = projection.forward([lo,la]);
      return [x+width/2+(e-insetCenter[0])*1000/(scale*factor), top+height/2-(n-insetCenter[1])*1000/(scale*factor)];
    };
    rect(x,y,width,box.h,"#ffffff");
    label(x+1,y+heading*.72,title + ' · 1:' + scale.toLocaleString('pt-BR'),Math.min(3.5,width/Math.max(8,title.length*.58),heading*.7),true);
    const background = inset?.background ?? "cartografico";
    const base = backgroundStyles[background] ?? backgroundStyles.cartografico!;
    rect(x,top,width,height,base.water);
    clip(x,top,width,height,() => {
      if (options.baseImages?.[key]) baseImage(options.baseImages[key],x,top,width,height);
      else if (background !== "nenhum") drawFeatures(states,project,base.border,base.land,.13);
      const focus = states.filter(f => ["CE","RN"].includes(f.properties?.SIGLA_UF || ""));
      if (!options.baseImages?.[key] && background !== "nenhum") drawFeatures(focus,project,base.border,base.focus,.2);
      if (inset?.layers) {
        for (const id of inset.layers) {
          const layer = (options.available ?? layers).find(item => item.id === id);
          if (layer) drawFeatures(layer.layerData.features,project,areaStyle(layer)?.strokeColor ?? areaStyle(layer)?.color ?? layer.defaultStyle?.color ?? '#a52932',areaStyle(layer) ? layerFill(layer,layer.name) : 'none',areaStyle(layer)?.strokeMm !== undefined ? areaStyle(layer)!.strokeMm!/factor : .35,areaStyle(layer)?.opacity || 1,vectorStyle(layer));
        }
      } else if (national) {
        const [cx,cy] = project([lon,lat]);
        rect(cx-1,cy-1,2,2,"#a52932","none");
      } else drawFeatures(features,project,"#a52932","none",.4);
    });
    rect(x,top,width,height);
  };
  if (!portrait) for (const y of [200,269,296,325,372]) line(474,y,584,y);
  overview("Brasil",layout.brasil,true);
  overview("Região do empreendimento",layout.regional,false);
  const legend = layout.legenda, rowHeight = legend.h / (layers.length+1+(options.raster?.legend.length ?? 0));
  const lx = legend.x + legend.w*.025, symbol = legend.w*.07;
  rect(legend.x,legend.y,legend.w,legend.h,"#ffffff");
  label(lx,legend.y+rowHeight*.75,"Legenda cartográfica",Math.min(4,rowHeight*.65,legend.w/12),true);
  layers.slice().reverse().forEach((layer,i) => {
    const name = layer.name.replace(/\.geojson$/i,""), y = legend.y + (i+1.75)*rowHeight;
    const color = areaStyle(layer)?.strokeColor ?? areaStyle(layer)?.color ?? layer.defaultStyle?.color ?? ink;
    const vector=vectorStyle(layer);
    if (layer.layerData.features.every(feature => /Point$/.test(feature.geometry.type))) {
      const radius=vector?.sizeMm === undefined ? Math.min(.8,rowHeight*.15) : Math.min(vector.sizeMm/(2*factor),rowHeight*.35,symbol*.45);
      const markerColor=vector?.color ?? color;
      // Símbolos claros precisam de contraste também na legenda sobre papel branco.
      if (/^#[0-9a-f]{6}$/i.test(markerColor) && [1,3,5].every(i => parseInt(markerColor.slice(i,i+2),16)>200))
        rect(lx+symbol/2-radius*1.3,y-rowHeight*.22-radius*1.3,radius*2.6,radius*2.6,"#475569","#475569");
      marker(lx+symbol/2,y-rowHeight*.22,markerColor,radius,vector);
    } else if (layer.layerData.features.every(feature => /LineString$/.test(feature.geometry.type))) {
      line(lx,y-1,lx+symbol,y-1,vector?.color ?? color,vector?.widthMm === undefined ? .6 : vector.widthMm/factor);
    }
    else {
      const top=y-rowHeight*.35, bottom=top+rowHeight*.38;
      path([[[lx,top],[lx+symbol,top],[lx+symbol,bottom],[lx,bottom]]],true,color,layerFill(layer,name),areaStyle(layer)?.strokeMm !== undefined ? areaStyle(layer)!.strokeMm!/factor : .24,areaStyle(layer)?.opacity || 1);
    }
    const caption = ({ Eixo:"Eixo da linha de transmissão", ADA:"ADA · faixa de 30 m por lado", AID:"AID · faixa de 250 m por lado", AII:"AII · municípios interceptados" } as Record<string,string>)[name] || name;
    label(lx+symbol+legend.w*.03,y,caption,Math.min(3.5,rowHeight*.65,legend.w*.84/(caption.length*.62)));
  });
  options.raster?.legend.forEach(({ color, name }, i) => {
    const y = legend.y + (layers.length+i+1.75)*rowHeight;
    rect(lx,y-rowHeight*.55,symbol,rowHeight*.42,color,color);
    label(lx+symbol+legend.w*.03,y,name,Math.min(3.5,rowHeight*.68));
  });
  const detailX = portrait ? 211 : 479;
  const detailY = portrait ? 436 : 277;
  const detailLabel = (y:number, value:string, size?:number, bold?:boolean) => label(detailX, detailY+y-277, value, size, bold);
  detailLabel(277,"Referência geodésica",4,true);
  detailLabel(285,"SIRGAS2000 / UTM 24S");
  detailLabel(291,"EPSG:31984 · grade em metros",3);
  detailLabel(303,"Escala do mapa principal",4,true);
  const distance = Math.min(sheet ? 5000 : 20000, 10 ** Math.floor(Math.log10(step*75))), bar = distance / step;
  for (let i=0;i<4;i++) rect(detailX+i*bar/4,detailY+31,bar/4,2,i%2 ? "#ffffff" : ink);
  detailLabel(315,"0",2.8);
  label(detailX+bar,detailY+38,distance >= 1000 ? `${distance/1000} km` : `${distance} m`,2.8,false,true);
  detailLabel(321,"1:" + scale.toLocaleString("pt-BR"),3.5,true);
  detailLabel(333,"Identificação da folha",4,true);
  detailLabel(341,"Projeto  LT Angicos–Jaguaruana II");
  detailLabel(348,`Folha  ${paper} · ${String(sheet?.number ?? 1).padStart(2,"0")}/${String(sheet?.total ?? 1).padStart(2,"0")}`);
  detailLabel(355,"Fontes  Camadas do projeto · IBGE 2024",3.25);
  detailLabel(362,options.raster ? (options.model === "uso-solo" ? "MapBiomas 2024 · Imagem/ArcGIS · CC BY 4.0" : "Copernicus DEM GLO-30 · recorte da LT") : "Responsável  __________________",3.25);
  const sources = [options.view?.background,options.view?.insets.brasil.background,options.view?.insets.regional.background];
  if (sources.includes("esri-imagery")) detailLabel(366,"Satélite: Esri, Vantor, Earthstar Geographics e comunidade GIS",2.1);
  if (sources.includes("esri-light-gray") || sources.includes("esri-dark-gray"))
    detailLabel(370,"Base cinza: Esri, HERE, Garmin, OpenStreetMap e comunidade GIS",2.1);
  const logo = readFileSync(new URL("./logo-arqueo.png", import.meta.url));
  const defaultBrand = {image:"data:image/png;base64,"+logo.toString("base64"),width:logo.readUInt32BE(16),height:logo.readUInt32BE(20)};
  const brands = [options.brands?.[0] ?? defaultBrand,options.brands?.[1]].filter(brand => brand !== undefined);
  brands.forEach((brand,i) => {
    const ratio = Math.min(40/brand.width,20/brand.height);
    const w = brand.width*ratio, h = brand.height*ratio;
    const x = (portrait ? 350 : 509) + (i-(brands.length-1)/2)*48 +(40-w)/2;
    const y = (portrait ? 551 : 381)+(20-h)/2;
    if (pdf) pdf.addImage(brand.image,"PNG",x*factor,y*factor,w*factor,h*factor);
    else svg.push(`<image href="${brand.image}" x="${x}" y="${y}" width="${w}" height="${h}"/>`);
  });
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

export async function corridorAtlas(layers: Layer[], sheets: Sheet[], pdf: boolean, page: number, title: string | undefined, options: Options, single = false) {
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
  if (!pdf || single) return page === 0 ? pranchaAngicos(layers, pdf, index, indexTitle, { ...await prepareStudioBases(layers,options,index), index: sheets })
    : pranchaAngicos(layers, pdf, sheets[page-1], detailTitle, await prepareStudioBases(layers,options,sheets[page-1]));
  const document = newPdf(options.paper, options.orientation);
  pranchaAngicos(layers, true, { ...index, document }, indexTitle, { ...await prepareStudioBases(layers,options,index), index: sheets });
  for (const sheet of sheets) {
    document.addPage(paperSize(options.paper ?? 'A2', options.orientation), options.orientation ?? 'landscape');
    pranchaAngicos(layers, true, { ...sheet, document }, detailTitle, await prepareStudioBases(layers,options,sheet));
  }
  return Buffer.from(document.output("arraybuffer"));
}

export async function atlasAngicos(layers: Layer[], columns: number, rows: number, overlap: number, grid: number, title?: string, options: Options = {}) {
  const document = newPdf(options.paper, options.orientation);
  for (const sheet of planSheets(layers, columns, rows, overlap, grid, options)) {
    if (sheet.number > 1) document.addPage(paperSize(options.paper ?? 'A2', options.orientation), options.orientation ?? 'landscape');
    pranchaAngicos(layers, true, { ...sheet, document }, title, await prepareStudioBases(layers,options,sheet));
  }
  return Buffer.from(document.output("arraybuffer"));
}

export async function atlasView(layers: Layer[], columns: number, rows: number, overlap: number, grid: number, page: number, title?: string, options: Options = {}) {
  const sheets = planSheets(layers, columns, rows, overlap, grid, options);
  if (page > 0 && sheets[page-1]) return pranchaAngicos(layers, false, sheets[page-1], title, await prepareStudioBases(layers,options,sheets[page-1]));
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
  const portrait = options.orientation === 'portrait';
  if (frame.x < 20 || frame.y < 28 || frame.x+frame.w > (portrait ? 410 : 474) || frame.y+frame.h > (portrait ? 428 : 410))
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
  return { scale, insetScales: { brasil:overviewView("brasil",options).scale, regional:overviewView("regional",options).scale }, sheets: sheets?.length ?? 0, warnings, widthKm: frame.w*scale*factor/1e6, heightKm: frame.h*scale*factor/1e6 };
}

export function printTerrain(layers: Layer[], options: Options, contours: boolean): ThematicRaster {
  const { PNG } = createRequire(require.resolve("qrcode"))("pngjs");
  const read = (name:string) => PNG.sync.read(readFileSync(new URL("../relevo/"+name+".png",import.meta.url)));
  const source = read(contours ? "curvas" : "elevacao");
  const shade = contours ? undefined : read("sombreado");
  const mercator = proj4("EPSG:4326","EPSG:3857");
  const [west,south] = mercator.forward([-37.85,-5.75]);
  const [east,north] = mercator.forward([-36.38,-4.75]);
  const image = new PNG({width:1000,height:840});
  const {center,scale} = mapView(layers,options);
  const frame = options.layout?.principal ?? defaultFrame;
  const metres = scale*paperFactor(options.paper ?? "A2")/1000;
  for (let row=0;row<image.height;row++) for (let col=0;col<image.width;col++) {
    const [x,y] = mercator.forward(utm.inverse([center[0]+((col+.5)/image.width-.5)*frame.w*metres,
      center[1]-((row+.5)/image.height-.5)*frame.h*metres]));
    const sx = Math.floor((x-west)/(east-west)*source.width), sy = Math.floor((north-y)/(north-south)*source.height);
    if (sx<0 || sy<0 || sx>=source.width || sy>=source.height) continue;
    const from = 4*(sy*source.width+sx), to = 4*(row*image.width+col);
    const light = shade ? .72+.28*shade.data[from]/255 : 1;
    for (let channel=0;channel<3;channel++) image.data[to+channel]=Math.round(source.data[from+channel]*light);
    image.data[to+3]=source.data[from+3];
  }
  const legend = contours ? [{color:"#854d0e",name:"Curvas de nível · 20 m"}] :
    [[0,"#256943"],[100,"#7bb153"],[250,"#f0d782"],[500,"#ac6937"],[800,"#6e4234"],[1200,"#f4f4f4"]]
      .map(([value,color]) => ({color:String(color),name:String(value)+" m"}));
  return {url:"data:image/png;base64,"+PNG.sync.write(image).toString("base64"),legend};
}

const esriServices = {
  "esri-imagery":"World_Imagery",
  "esri-light-gray":"Canvas/World_Light_Gray_Base",
  "esri-dark-gray":"Canvas/World_Dark_Gray_Base",
} as const;
type EsriBase = keyof typeof esriServices;
const isEsriBase = (id: string | undefined): id is EsriBase => !!id && Object.hasOwn(esriServices,id);
const baseImages = new Map<string,Promise<string>>();
async function exportBase(id: EsriBase, projection: typeof utm, center: number[], width: number, height: number, pixels: number) {
  const key = JSON.stringify([id,center,width,height,pixels,projection === utm]);
  const cached = baseImages.get(key);
  if (cached) return cached;
  const pending = (async () => {
    const { PNG } = createRequire(require.resolve("qrcode"))("pngjs");
    const mercator = proj4("EPSG:4326","EPSG:3857");
    const sample = (x:number,y:number) => mercator.forward(projection.inverse([center[0]+(x-.5)*width,center[1]+(.5-y)*height]));
    const edge = Array.from({length:17},(_,i) => i/16).flatMap(t => [sample(0,t),sample(1,t),sample(t,0),sample(t,1)]);
    const xs = edge.map(p=>p[0]), ys = edge.map(p=>p[1]);
    const west=Math.min(...xs), east=Math.max(...xs), south=Math.min(...ys), north=Math.max(...ys);
    const rows=Math.max(64,Math.round(pixels*height/width));
    const query = new URLSearchParams({bbox:[west,south,east,north].join(","),bboxSR:"3857",imageSR:"3857",
      size:pixels+","+rows,format:"png32",transparent:"true",f:"image"});
    // Match the export image aspect to its bounding box so Esri does not expand the extent.
    const sourceHeight = Math.max(1,Math.round(pixels*(north-south)/(east-west)));
    const adjustedNorth = (north+south+(east-west)*sourceHeight/pixels)/2;
    const adjustedSouth = adjustedNorth-(east-west)*sourceHeight/pixels;
    query.set("bbox",[west,adjustedSouth,east,adjustedNorth].join(","));
    query.set("size",pixels+","+sourceHeight);
    const response=await fetch("https://server.arcgisonline.com/ArcGIS/rest/services/"+esriServices[id]+"/MapServer/export?"+query,{signal:AbortSignal.timeout(15000)});
    if (!response.ok || !response.headers.get("content-type")?.includes("image/png")) throw Error("O mapa-base Esri está indisponível para esta folha.");
    const source=PNG.sync.read(Buffer.from(await response.arrayBuffer()));
    const image=new PNG({width:pixels,height:rows});
    for(let y=0;y<rows;y++) for(let x=0;x<pixels;x++){
      const [e,n]=sample((x+.5)/pixels,(y+.5)/rows);
      const sx=Math.max(0,Math.min(source.width-1,Math.floor((e-west)/(east-west)*source.width)));
      const sy=Math.max(0,Math.min(source.height-1,Math.floor((adjustedNorth-n)/(adjustedNorth-adjustedSouth)*source.height)));
      const offset=(sy*source.width+sx)*4;
      source.data.copy(image.data,(y*pixels+x)*4,offset,offset+4);
    }
    return "data:image/png;base64,"+PNG.sync.write(image).toString("base64");
  })();
  if(baseImages.size>=40) baseImages.delete(baseImages.keys().next().value!);
  baseImages.set(key,pending);
  pending.catch(()=>baseImages.delete(key));
  return pending;
}

export async function prepareStudioBases(layers: Layer[], options: Options, sheet?: Sheet): Promise<Options> {
  const view=options.view;
  if(!view) return options;
  const factor=paperFactor(options.paper ?? "A2");
  const images: Options["baseImages"]={};
  const tasks: Promise<unknown>[]=[];
  if(isEsriBase(view.background)){
    const frame=options.layout?.principal ?? defaultFrame;
    const {center,scale}=sheet ?? mapView(layers,options);
    tasks.push(exportBase(view.background,utm,center,frame.w*scale*factor/1000,frame.h*scale*factor/1000,750).then(image=>{images.principal=image}));
  }
  for(const key of ["brasil","regional"] as const){
    const id=view.insets[key].background;
    if(!isEsriBase(id)) continue;
    const box=(options.layout ?? defaultLayout)[key];
    const {projection,center,scale,height}=overviewView(key,options);
    tasks.push(exportBase(id,projection,center,box.w*scale*factor/1000,height*scale*factor/1000,320).then(image=>{images[key]=image}));
  }
  await Promise.all(tasks);
  return {...options,baseImages:images};
}
