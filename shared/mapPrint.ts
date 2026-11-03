/** Metadata for pixels captured from the actual, unrotated Leaflet viewport. */
export interface MapPrintSnapshot {
  imageDataUrl: string;
  width: number;
  height: number;
  bounds: { north: number; south: number; east: number; west: number };
  capturedAt: string;
  crs: "EPSG:3857";
  attributions: string[];
  warnings: string[];
  legend: Array<{ label: string; color?: string }>;
}

export type MapPrintBounds = MapPrintSnapshot["bounds"];
export type MapPrintLegendItem = MapPrintSnapshot["legend"][number];
export const MAP_PRINT_MAX_PIXELS = 12_000_000;
export const MAP_PRINT_MAX_SIDE = 8192;
export const WEB_MERCATOR_MAX_LATITUDE = 85.0511287798066;
/** Deliberately exclude world/continental hemispheric views and wrapped worlds. */
export const MAP_PRINT_MAX_LONGITUDE_SPAN = 120;
export const MAP_PRINT_MAX_LATITUDE_SPAN = 120;
const EARTH_RADIUS_METERS = 6_378_137;
const radians = (degrees: number) => degrees * Math.PI / 180;
const degrees = (angle: number) => angle * 180 / Math.PI;

export function assertMapPrintBounds(bounds: MapPrintBounds): void {
  if (!bounds || ![bounds.north, bounds.south, bounds.east, bounds.west].every(Number.isFinite)) {
    throw new Error("Os limites do mapa precisam ser finitos.");
  }
  const { north, south, east, west } = bounds;
  if (north <= south || east <= west) {
    throw new Error("Extensão vazia, invertida ou cruzando o antimeridiano não suportada.");
  }
  if (west < -180 || east > 180) {
    throw new Error("Vista cruzando o antimeridiano ou mundo repetido não suportada. Reposicione o mapa.");
  }
  if (south < -WEB_MERCATOR_MAX_LATITUDE || north > WEB_MERCATOR_MAX_LATITUDE) {
    throw new Error("Latitude fora do domínio imprimível de EPSG:3857.");
  }
  if (east - west > MAP_PRINT_MAX_LONGITUDE_SPAN || north - south > MAP_PRINT_MAX_LATITUDE_SPAN) {
    throw new Error("Vista mundial/ampla demais para impressão: aproxime o mapa (extensão máxima de 120° por eixo).");
  }
}

export function assertMapPrintSize(width: number, height: number, maxPixels = MAP_PRINT_MAX_PIXELS): void {
  if (![width, height, maxPixels].every(Number.isFinite) || width <= 0 || height <= 0 ||
      !Number.isInteger(width) || !Number.isInteger(height) || maxPixels <= 0 || maxPixels > MAP_PRINT_MAX_PIXELS) {
    throw new Error("Dimensões de captura inválidas; informe pixels inteiros positivos e limite de até 12 MP.");
  }
  if (width > MAP_PRINT_MAX_SIDE || height > MAP_PRINT_MAX_SIDE || width * height > maxPixels) {
    throw new Error("Captura excede o limite físico de 12 MP ou 8192 pixels por lado. Reduza a janela do mapa.");
  }
}

/** Dimensionless Mercator northing; do not interpolate latitude linearly. */
export function mercatorNorthing(latitude: number): number {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > WEB_MERCATOR_MAX_LATITUDE) {
    throw new Error("Latitude inválida para Web Mercator.");
  }
  return Math.log(Math.tan(Math.PI / 4 + radians(latitude) / 2));
}

export function inverseMercatorNorthing(northing: number): number {
  if (!Number.isFinite(northing) || Math.abs(northing) > Math.PI + 1e-12) {
    throw new Error("Norte Mercator fora do domínio imprimível.");
  }
  return degrees(Math.atan(Math.sinh(northing)));
}

/** Geographic grid position relative to the image, not to the letterboxed frame. */
export function geographicToPrintPosition(
  bounds: MapPrintBounds, latitude: number, longitude: number,
): { x: number; y: number } {
  assertMapPrintBounds(bounds);
  if (!Number.isFinite(longitude)) throw new Error("Longitude inválida.");
  const top = mercatorNorthing(bounds.north);
  const bottom = mercatorNorthing(bounds.south);
  return {
    x: (longitude - bounds.west) / (bounds.east - bounds.west),
    y: (top - mercatorNorthing(latitude)) / (top - bottom),
  };
}

export interface MapPrintGeometry {
  /** All coordinates are millimetres relative to the available map frame. */
  image: { xMm: number; yMm: number; widthMm: number; heightMm: number };
  center: { latitude: number; longitude: number };
  groundWidthMetersApprox: number;
  groundHeightMetersApprox: number;
  scaleDenominatorApprox: number;
  /** Effective source resolution only; never a certification or promised print quality. */
  effectiveDpi: number;
  approximate: true;
  scaleMethod: "Web Mercator × cos(latitude central), esfera R=6378137 m";
  warnings: string[];
}

/** Fit actual pixels with letterboxing; never stretch an image to the sheet aspect. */
export function getPrintGeometry(
  snapshot: Pick<MapPrintSnapshot, "width" | "height" | "bounds" | "crs">,
  widthMm: number,
  heightMm: number,
): MapPrintGeometry {
  assertMapPrintBounds(snapshot.bounds);
  assertMapPrintSize(snapshot.width, snapshot.height);
  if (snapshot.crs !== "EPSG:3857") throw new Error("Somente EPSG:3857 é suportado para esta captura.");
  if (![widthMm, heightMm].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error("O quadro de impressão precisa ter largura e altura positivas em milímetros.");
  }
  const fit = Math.min(widthMm / snapshot.width, heightMm / snapshot.height);
  const imageWidthMm = snapshot.width * fit;
  const imageHeightMm = snapshot.height * fit;
  const { north, south, east, west } = snapshot.bounds;
  const top = mercatorNorthing(north), bottom = mercatorNorthing(south);
  const latitude = inverseMercatorNorthing((top + bottom) / 2);
  const groundFactor = EARTH_RADIUS_METERS * Math.cos(radians(latitude));
  const groundWidthMetersApprox = radians(east - west) * groundFactor;
  const groundHeightMetersApprox = (top - bottom) * groundFactor;
  return {
    image: { xMm: (widthMm - imageWidthMm) / 2, yMm: (heightMm - imageHeightMm) / 2,
      widthMm: imageWidthMm, heightMm: imageHeightMm },
    center: { latitude, longitude: (west + east) / 2 },
    groundWidthMetersApprox,
    groundHeightMetersApprox,
    scaleDenominatorApprox: groundWidthMetersApprox / (imageWidthMm / 1000),
    effectiveDpi: snapshot.width / (imageWidthMm / 25.4),
    approximate: true,
    scaleMethod: "Web Mercator × cos(latitude central), esfera R=6378137 m",
    warnings: [
      "Escala aproximada no centro da imagem, variável com latitude; não substitui levantamento ou cálculo geodésico.",
      "A resolução efetiva deriva dos pixels da vista capturada; não comprova DPI técnico nem conformidade NBR.",
    ],
  };
}

export interface MapPrintGridLine { axis: "latitude" | "longitude"; value: number; position: number }

/** Internal grid lines in geographic degrees, positioned in Web Mercator (not UTM). */
export function getGeographicGrid(bounds: MapPrintBounds, divisions = 4): MapPrintGridLine[] {
  assertMapPrintBounds(bounds);
  if (!Number.isInteger(divisions) || divisions < 2 || divisions > 20) {
    throw new Error("A grade deve ter entre 2 e 20 divisões.");
  }
  const lines: MapPrintGridLine[] = [];
  for (let i = 1; i < divisions; i++) {
    const longitude = bounds.west + (bounds.east - bounds.west) * i / divisions;
    const latitude = bounds.south + (bounds.north - bounds.south) * i / divisions;
    lines.push({ axis: "longitude", value: longitude,
      position: geographicToPrintPosition(bounds, bounds.south, longitude).x });
    lines.push({ axis: "latitude", value: latitude,
      position: geographicToPrintPosition(bounds, latitude, bounds.west).y });
  }
  return lines;
}
