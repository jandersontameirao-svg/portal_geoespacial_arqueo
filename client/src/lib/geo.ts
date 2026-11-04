/**
 * Utilitário geoespacial client-side (puro). WGS84, coordenadas no padrão
 * GeoJSON [lng, lat]. Gera deterministicamente a "malha de campo" (pontos de
 * prospecção espaçados) a partir de linhas/polígonos/pontos importados de
 * KML/KMZ/GPX/GeoJSON/SHP(.zip), e serializa o resultado de volta em KML/GPX.
 *
 * shpjs e jszip são carregados sob demanda (import dinâmico) só quando o
 * arquivo exige — não pesam no bundle inicial.
 */

export type LngLat = [number, number]; // [lng, lat]

export interface GeoGeometry {
  type: "LineString" | "Polygon" | "Point" | "MultiLineString" | "MultiPolygon";
  coords: LngLat[][]; // Point: [[lng,lat]]; Line: [[...]]; Polygon: [anel, ...]
}

export interface ParsedGeo {
  geometries: GeoGeometry[];
  linhas: LngLat[][];
  poligonos: LngLat[][];
  pontos: LngLat[];
}

export type TipoMalha = "linear" | "poligonal" | "mista" | "pontual";

export interface MalhaResultado {
  tipoMalha: TipoMalha;
  pontos: LngLat[];
  extensaoKm: number;
  areaHa: number;
  quantidadePontos: number;
  centro: { lat: number; lng: number } | null;
  bbox: [number, number, number, number] | null; // [minLng,minLat,maxLng,maxLat]
}

const R = 6_371_000; // raio médio da Terra em metros
const DEG2RAD = Math.PI / 180;
const MAX_MALHA_POLIGONO = 5000; // trava de segurança por polígono

// --------------------------------------------------------------------------
// Matemática geo
// --------------------------------------------------------------------------

export function distMeters(a: LngLat, b: LngLat): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLng = (lng2 - lng1) * DEG2RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function isClosedRing(line: LngLat[]): boolean {
  if (line.length < 4) return false;
  const [x0, y0] = line[0];
  const [xn, yn] = line[line.length - 1];
  return Math.abs(x0 - xn) < 1e-9 && Math.abs(y0 - yn) < 1e-9;
}

/** Área de um anel (m²), fórmula esférica (shoelace projetada). */
function ringAreaM2(ring: LngLat[]): number {
  if (ring.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % ring.length];
    total += (lng2 - lng1) * DEG2RAD * (2 + Math.sin(lat1 * DEG2RAD) + Math.sin(lat2 * DEG2RAD));
  }
  return Math.abs((total * R * R) / 2);
}

/** Ray casting even-odd. */
function pointInRing(pt: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  const [x, y] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function bboxOf(all: LngLat[]): [number, number, number, number] | null {
  if (all.length === 0) return null;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of all) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLng, minLat, maxLng, maxLat];
}

// --------------------------------------------------------------------------
// Geração da malha (determinística)
// --------------------------------------------------------------------------

function meshLine(line: LngLat[], spacing: number): LngLat[] {
  if (line.length === 0) return [];
  const out: LngLat[] = [line[0]];
  let carry = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const segLen = distMeters(a, b);
    if (segLen === 0) continue;
    let d = spacing - carry;
    while (d <= segLen) {
      const t = d / segLen;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      d += spacing;
    }
    carry = (carry + segLen) % spacing;
  }
  return out;
}

function meshPolygon(ring: LngLat[], spacing: number): LngLat[] {
  const bb = bboxOf(ring);
  if (!bb) return [];
  const [minLng, minLat, maxLng, maxLat] = bb;
  const latMid = (minLat + maxLat) / 2;
  const dLat = (spacing / R) * (180 / Math.PI);
  const dLng = dLat / Math.max(0.01, Math.cos(latMid * DEG2RAD));
  const out: LngLat[] = [];
  for (let lat = minLat; lat <= maxLat; lat += dLat) {
    for (let lng = minLng; lng <= maxLng; lng += dLng) {
      const pt: LngLat = [lng, lat];
      if (pointInRing(pt, ring)) {
        out.push(pt);
        if (out.length >= MAX_MALHA_POLIGONO) return out;
      }
    }
  }
  return out;
}

export function gerarMalha(geo: ParsedGeo, spacingMeters = 200): MalhaResultado {
  const spacing = Math.max(1, spacingMeters);
  const linhasAbertas: LngLat[][] = [];
  const poligonos: LngLat[][] = [...geo.poligonos];

  for (const line of geo.linhas) {
    if (isClosedRing(line)) poligonos.push(line);
    else linhasAbertas.push(line);
  }

  const pontos: LngLat[] = [];
  for (const line of linhasAbertas) pontos.push(...meshLine(line, spacing));
  for (const ring of poligonos) pontos.push(...meshPolygon(ring, spacing));
  for (const p of geo.pontos) pontos.push(p);

  const temLinha = linhasAbertas.length > 0;
  const temPoligono = poligonos.length > 0;
  let tipoMalha: TipoMalha;
  if (temLinha && temPoligono) tipoMalha = "mista";
  else if (temLinha) tipoMalha = "linear";
  else if (temPoligono) tipoMalha = "poligonal";
  else tipoMalha = "pontual";

  let extensaoM = 0;
  for (const line of linhasAbertas) {
    for (let i = 0; i < line.length - 1; i++) extensaoM += distMeters(line[i], line[i + 1]);
  }
  let areaM2 = 0;
  for (const ring of poligonos) areaM2 += ringAreaM2(ring);

  const todos: LngLat[] = [
    ...linhasAbertas.flat(),
    ...poligonos.flat(),
    ...geo.pontos,
  ];
  const bbox = bboxOf(todos);
  const centro = bbox
    ? { lng: (bbox[0] + bbox[2]) / 2, lat: (bbox[1] + bbox[3]) / 2 }
    : null;

  return {
    tipoMalha,
    pontos,
    extensaoKm: extensaoM / 1000,
    areaHa: areaM2 / 10_000,
    quantidadePontos: pontos.length,
    centro,
    bbox,
  };
}

// --------------------------------------------------------------------------
// Parsing de arquivos
// --------------------------------------------------------------------------

function parseCoordString(text: string): LngLat[] {
  // KML: "lng,lat,alt lng,lat,alt ..."
  return text
    .trim()
    .split(/\s+/)
    .map((tuple) => tuple.split(",").map(Number))
    .filter((c) => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map((c) => [c[0], c[1]] as LngLat);
}

function parseKmlDoc(xml: Document): GeoGeometry[] {
  const out: GeoGeometry[] = [];
  const getCoords = (el: Element | null): LngLat[] =>
    el && el.textContent ? parseCoordString(el.textContent) : [];

  xml.querySelectorAll("Point coordinates").forEach((el) => {
    const c = parseCoordString(el.textContent || "");
    if (c.length) out.push({ type: "Point", coords: [[c[0]]] });
  });
  xml.querySelectorAll("LineString coordinates").forEach((el) => {
    const c = getCoords(el);
    if (c.length >= 2) out.push({ type: "LineString", coords: [c] });
  });
  xml.querySelectorAll("Polygon").forEach((poly) => {
    const outer = getCoords(poly.querySelector("outerBoundaryIs LinearRing coordinates"));
    if (outer.length >= 3) out.push({ type: "Polygon", coords: [outer] });
  });
  return out;
}

function parseGpxDoc(xml: Document): GeoGeometry[] {
  const out: GeoGeometry[] = [];
  const readPts = (sel: string): LngLat[] =>
    Array.from(xml.querySelectorAll(sel))
      .map((p) => [Number(p.getAttribute("lon")), Number(p.getAttribute("lat"))] as LngLat)
      .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));

  xml.querySelectorAll("trk").forEach((trk) => {
    trk.querySelectorAll("trkseg").forEach((seg) => {
      const pts = Array.from(seg.querySelectorAll("trkpt"))
        .map((p) => [Number(p.getAttribute("lon")), Number(p.getAttribute("lat"))] as LngLat)
        .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
      if (pts.length >= 2) out.push({ type: "LineString", coords: [pts] });
    });
  });
  const rtepts = readPts("rte rtept");
  if (rtepts.length >= 2) out.push({ type: "LineString", coords: [rtepts] });
  readPts("wpt").forEach((wpt) => out.push({ type: "Point", coords: [[wpt]] }));
  return out;
}

function geojsonToGeometries(gj: any): GeoGeometry[] {
  const out: GeoGeometry[] = [];
  const features: any[] = gj?.type === "FeatureCollection" ? gj.features || [] : gj?.type === "Feature" ? [gj] : gj?.type ? [{ geometry: gj }] : [];
  for (const f of features) {
    const g = f?.geometry || f;
    if (!g?.type) continue;
    if (g.type === "Point") out.push({ type: "Point", coords: [[g.coordinates]] });
    else if (g.type === "LineString") out.push({ type: "LineString", coords: [g.coordinates] });
    else if (g.type === "MultiLineString") for (const l of g.coordinates) out.push({ type: "LineString", coords: [l] });
    else if (g.type === "Polygon") out.push({ type: "Polygon", coords: g.coordinates });
    else if (g.type === "MultiPolygon") for (const poly of g.coordinates) out.push({ type: "Polygon", coords: poly });
    else if (g.type === "MultiPoint") for (const p of g.coordinates) out.push({ type: "Point", coords: [[p]] });
  }
  return out;
}

function organize(geometries: GeoGeometry[]): ParsedGeo {
  const linhas: LngLat[][] = [];
  const poligonos: LngLat[][] = [];
  const pontos: LngLat[] = [];
  for (const g of geometries) {
    if (g.type === "Point") pontos.push(g.coords[0][0]);
    else if (g.type === "LineString") linhas.push(g.coords[0]);
    else if (g.type === "Polygon") poligonos.push(g.coords[0]); // anel externo
  }
  return { geometries, linhas, poligonos, pontos };
}

export async function parseGeoFile(file: File): Promise<ParsedGeo> {
  const name = file.name.toLowerCase();
  let geometries: GeoGeometry[] = [];

  if (name.endsWith(".geojson") || name.endsWith(".json")) {
    geometries = geojsonToGeometries(JSON.parse(await file.text()));
  } else if (name.endsWith(".kml")) {
    const xml = new DOMParser().parseFromString(await file.text(), "application/xml");
    geometries = parseKmlDoc(xml);
  } else if (name.endsWith(".gpx")) {
    const xml = new DOMParser().parseFromString(await file.text(), "application/xml");
    geometries = parseGpxDoc(xml);
  } else if (name.endsWith(".kmz")) {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const kmlEntry = Object.keys(zip.files).find((n) => n.toLowerCase().endsWith(".kml"));
    if (!kmlEntry) throw new Error("KMZ sem arquivo .kml interno.");
    const xml = new DOMParser().parseFromString(await zip.files[kmlEntry].async("text"), "application/xml");
    geometries = parseKmlDoc(xml);
  } else if (name.endsWith(".zip")) {
    const shp = (await import("shpjs")).default;
    const gj = await shp(await file.arrayBuffer());
    geometries = geojsonToGeometries(gj);
  } else {
    throw new Error("Formato não suportado. Use KML, KMZ, GPX, GeoJSON ou SHP (.zip).");
  }

  if (geometries.length === 0) throw new Error("Nenhuma geometria válida encontrada no arquivo.");
  return organize(geometries);
}

// --------------------------------------------------------------------------
// Exportação
// --------------------------------------------------------------------------

function coordsToKml(coords: LngLat[]): string {
  return coords.map(([lng, lat]) => `${lng},${lat},0`).join(" ");
}

export function buildKml(
  nome: string,
  data: { meshPoints: LngLat[]; linhas: LngLat[][]; poligonos: LngLat[][] },
): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const placemarks: string[] = [];
  data.linhas.forEach((line, i) =>
    placemarks.push(`<Placemark><name>Linha ${i + 1}</name><LineString><coordinates>${coordsToKml(line)}</coordinates></LineString></Placemark>`),
  );
  data.poligonos.forEach((ring, i) =>
    placemarks.push(`<Placemark><name>Polígono ${i + 1}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${coordsToKml(isClosedRing(ring) ? ring : [...ring, ring[0]])}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`),
  );
  data.meshPoints.forEach(([lng, lat], i) =>
    placemarks.push(`<Placemark><name>P${i + 1}</name><Point><coordinates>${lng},${lat},0</coordinates></Point></Placemark>`),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(nome)}</name>${placemarks.join("")}</Document></kml>`;
}

export function buildGpx(nome: string, data: { meshPoints: LngLat[]; linhas: LngLat[][] }): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const wpts = data.meshPoints.map(([lng, lat], i) => `<wpt lat="${lat}" lon="${lng}"><name>P${i + 1}</name></wpt>`).join("");
  const trks = data.linhas
    .map((line, i) => `<trk><name>Linha ${i + 1}</name><trkseg>${line.map(([lng, lat]) => `<trkpt lat="${lat}" lon="${lng}"></trkpt>`).join("")}</trkseg></trk>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Geoportal Arqueo" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${esc(nome)}</name></metadata>${wpts}${trks}</gpx>`;
}

export function nomeArquivoMalha(base: string, espacamentoM: number, ext: string): string {
  const slug = (base || "malha")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "malha";
  return `${slug}-${espacamentoM}m.${ext}`;
}

export function baixarArquivo(nome: string, conteudo: string, mime: string): void {
  const blob = new Blob([conteudo], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
