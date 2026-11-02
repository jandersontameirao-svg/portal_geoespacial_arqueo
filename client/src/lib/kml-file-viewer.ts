import JSZip from "jszip";
import { validateClosedPolygonCoordinates } from "../../../shared/geometry-coordinates";

export const KML_VIEW_LIMITS = Object.freeze({
  maxArchiveBytes: 20 * 1024 * 1024,
  maxTotalUncompressedBytes: 40 * 1024 * 1024,
  maxKmlBytes: 30 * 1024 * 1024,
  maxZipEntries: 512,
  maxFeatures: 5_000,
  maxCoordinates: 250_000,
});

export type KmlLatLng = [latitude: number, longitude: number] | [latitude: number, longitude: number, altitude: number];

export type KmlMapFeature =
  | { kind: "marker"; coordinates: KmlLatLng; name: string; description: string }
  | { kind: "line"; coordinates: KmlLatLng[]; name: string; description: string }
  | { kind: "polygon"; coordinates: KmlLatLng[][]; name: string; description: string };

export interface KmlReadLimits {
  maxArchiveBytes: number;
  maxTotalUncompressedBytes: number;
  maxKmlBytes: number;
  maxZipEntries: number;
}

interface ZipStreamHelper {
  on(event: "data", listener: (chunk: Uint8Array) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "end", listener: () => void): this;
  resume(): this;
  pause(): this;
}

interface ZipEntryInternals extends JSZip.JSZipObject {
  _data?: { uncompressedSize?: number };
  internalStream(type: "uint8array"): ZipStreamHelper;
}

function asError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback);
}

function validateLimit(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} inválido.`);
  }
}

/** Reads an HTTP response incrementally and cancels as soon as its byte cap is exceeded. */
export async function readResponseBytesLimited(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  validateLimit(maxBytes, "Limite de leitura");
  if (!response.ok) throw new Error(`Falha ao obter arquivo (${response.status}).`);

  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength.trim())) throw new Error("Cabeçalho de tamanho do arquivo inválido.");
    if (Number(contentLength) > maxBytes) {
      throw new Error(`Arquivo excede o limite de visualização de ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
    }
  }

  if (!response.body) throw new Error("O navegador não permite leitura limitada deste arquivo.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const cancelForAbort = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
  signal?.addEventListener("abort", cancelForAbort, { once: true });

  try {
    while (true) {
      if (signal?.aborted) throw asError(signal.reason, "Leitura do arquivo cancelada.");
      const result = await reader.read();
      if (signal?.aborted) throw asError(signal.reason, "Leitura do arquivo cancelada.");
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error(`Arquivo excede o limite de visualização de ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
      }
      chunks.push(result.value.slice());
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancelForAbort);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function readZipEntryBytesLimited(
  entry: ZipEntryInternals,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const stream = entry.internalStream("uint8array");
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let settled = false;

    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      signal?.removeEventListener("abort", onAbort);
      stream.pause();
      reject(error);
    };
    const onAbort = () => finishError(asError(signal?.reason, "Leitura do KMZ cancelada."));

    stream
      .on("data", (chunk) => {
        if (settled) return;
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes) {
          finishError(new Error(`O conteúdo KML excede o limite descompactado de ${Math.floor(maxBytes / 1024 / 1024)} MB.`));
          return;
        }
        chunks.push(chunk.slice());
      })
      .on("error", (error) => finishError(asError(error, "Falha ao descompactar entrada do KMZ.")))
      .on("end", () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        const bytes = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        resolve(bytes);
      });

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    stream.resume();
  });
}

/** Extracts one unambiguous KML entry from the original compressed KMZ bytes. */
export async function extractKmlFromKmz(
  archiveBytes: ArrayBuffer | Uint8Array,
  options: { limits?: Partial<KmlReadLimits>; signal?: AbortSignal } = {},
): Promise<string> {
  const limits = { ...KML_VIEW_LIMITS, ...options.limits };
  for (const [name, value] of Object.entries(limits)) validateLimit(value, name);
  const bytes = archiveBytes instanceof Uint8Array ? archiveBytes : new Uint8Array(archiveBytes);
  if (bytes.byteLength > limits.maxArchiveBytes) {
    throw new Error(`Arquivo KMZ excede o limite comprimido de ${Math.floor(limits.maxArchiveBytes / 1024 / 1024)} MB.`);
  }
  if (options.signal?.aborted) throw asError(options.signal.reason, "Leitura do KMZ cancelada.");

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { createFolders: false });
  } catch {
    throw new Error("O arquivo KMZ não é um ZIP válido.");
  }
  if (options.signal?.aborted) throw asError(options.signal.reason, "Leitura do KMZ cancelada.");

  const entries = Object.values(zip.files);
  if (entries.length > limits.maxZipEntries) {
    throw new Error(`O KMZ excede o limite de ${limits.maxZipEntries} entradas.`);
  }

  let totalUncompressedBytes = 0;
  const kmlEntries: Array<{ name: string; entry: ZipEntryInternals; declaredSize: number }> = [];
  for (const rawEntry of entries) {
    if (rawEntry.dir) continue;
    const entry = rawEntry as ZipEntryInternals;
    const originalName = entry.unsafeOriginalName ?? entry.name;
    const normalizedName = originalName.replace(/\\/g, "/");
    if (normalizedName.startsWith("/") || /^[A-Za-z]:/.test(normalizedName) || normalizedName.split("/").includes("..")) {
      throw new Error("O KMZ contém um caminho interno inválido.");
    }
    const declaredSize = entry._data?.uncompressedSize;
    if (!Number.isSafeInteger(declaredSize) || declaredSize! < 0) {
      throw new Error("Não foi possível validar o tamanho descompactado de uma entrada KMZ.");
    }
    totalUncompressedBytes += declaredSize!;
    if (!Number.isSafeInteger(totalUncompressedBytes) || totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
      throw new Error(`O KMZ excede o limite total descompactado de ${Math.floor(limits.maxTotalUncompressedBytes / 1024 / 1024)} MB.`);
    }
    if (entry.name.toLowerCase().endsWith(".kml")) {
      kmlEntries.push({ name: entry.name, entry, declaredSize: declaredSize! });
    }
  }

  if (kmlEntries.length === 0) throw new Error("Nenhum arquivo KML foi encontrado dentro do KMZ.");
  const docEntries = kmlEntries.filter(({ name }) => name.split("/").at(-1)?.toLowerCase() === "doc.kml");
  const selected = docEntries.length === 1
    ? docEntries[0]
    : docEntries.length > 1
      ? null
      : kmlEntries.length === 1 ? kmlEntries[0] : null;
  if (!selected) throw new Error("O KMZ contém vários KML sem um doc.kml único para visualização.");
  if (selected.declaredSize > limits.maxKmlBytes) {
    throw new Error(`O KML interno excede o limite de ${Math.floor(limits.maxKmlBytes / 1024 / 1024)} MB.`);
  }

  const kmlBytes = await readZipEntryBytesLimited(selected.entry, limits.maxKmlBytes, options.signal);
  if (options.signal?.aborted) throw asError(options.signal.reason, "Leitura do KMZ cancelada.");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(kmlBytes);
  } catch {
    throw new Error("O KML interno não está codificado em UTF-8 válido.");
  }
}

function descendantsByLocalName(element: Element | Document, name: string): Element[] {
  return Array.from(element.getElementsByTagName("*")).filter((child) => child.localName === name);
}

function directChildrenByLocalName(element: Element, name: string): Element[] {
  return Array.from(element.children).filter((child) => child.localName === name);
}

function directChildByLocalName(element: Element, name: string): Element | undefined {
  return directChildrenByLocalName(element, name)[0];
}

function readCoordinateTuples(text: string, label: string): Array<{ geoJson: number[]; latLng: KmlLatLng }> {
  const rawTuples = text.trim().split(/\s+/).filter(Boolean);
  if (rawTuples.length === 0) throw new Error(`${label}: lista de coordenadas vazia.`);
  return rawTuples.map((rawTuple, index) => {
    const parts = rawTuple.split(",");
    if (parts.length < 2 || parts.length > 3 || parts.some((part) => part.trim() === "")) {
      throw new Error(`${label}: coordenada ${index + 1} deve conter longitude, latitude e altitude opcional.`);
    }
    const values = parts.map(Number);
    if (values.some((value) => !Number.isFinite(value))) {
      throw new Error(`${label}: coordenada ${index + 1} contém valor não numérico.`);
    }
    const [longitude, latitude, altitude] = values;
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
      throw new Error(`${label}: coordenada ${index + 1} está fora dos limites WGS84.`);
    }
    return {
      geoJson: values,
      latLng: values.length === 3 ? [latitude, longitude, altitude!] : [latitude, longitude],
    };
  });
}

const supportedGeometryNames = new Set(["Point", "LineString", "LinearRing", "Polygon", "MultiGeometry"]);
const knownGeometryNames = new Set([
  ...Array.from(supportedGeometryNames),
  "Model",
  "Track",
  "MultiTrack",
]);

/** Parses all supported KML geometry in a DOM, retaining rings/components and failing on invalid coordinates. */
export function parseKmlDocument(xmlText: string, limits: { maxBytes?: number; maxFeatures?: number; maxCoordinates?: number } = {}): KmlMapFeature[] {
  const maxBytes = limits.maxBytes ?? KML_VIEW_LIMITS.maxKmlBytes;
  const maxFeatures = limits.maxFeatures ?? KML_VIEW_LIMITS.maxFeatures;
  const maxCoordinates = limits.maxCoordinates ?? KML_VIEW_LIMITS.maxCoordinates;
  validateLimit(maxBytes, "Limite de KML");
  validateLimit(maxFeatures, "Limite de geometrias");
  validateLimit(maxCoordinates, "Limite de coordenadas");
  if (new TextEncoder().encode(xmlText).byteLength > maxBytes) {
    throw new Error(`O KML excede o limite de ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
  }
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(xmlText)) {
    throw new Error("KML com DTD ou entidades XML não é aceito.");
  }

  const document = new DOMParser().parseFromString(xmlText, "application/xml");
  if (descendantsByLocalName(document, "parsererror").length > 0) throw new Error("O XML KML está malformado.");
  const placemarks = descendantsByLocalName(document, "Placemark");
  if (placemarks.length === 0) throw new Error("Nenhum Placemark KML foi encontrado.");

  const features: KmlMapFeature[] = [];
  let coordinateCount = 0;

  const addFeature = (feature: KmlMapFeature, label: string) => {
    const count = feature.kind === "marker" ? 1 : feature.kind === "line"
      ? feature.coordinates.length
      : feature.coordinates.reduce((sum, ring) => sum + ring.length, 0);
    coordinateCount += count;
    if (coordinateCount > maxCoordinates) throw new Error(`O KML excede o limite de ${maxCoordinates} coordenadas (${label}).`);
    features.push(feature);
    if (features.length > maxFeatures) throw new Error(`O KML excede o limite de ${maxFeatures} geometrias.`);
  };

  for (const placemark of placemarks) {
    const name = directChildByLocalName(placemark, "name")?.textContent?.trim() || "Sem nome";
    const description = directChildByLocalName(placemark, "description")?.textContent ?? "";
    let foundGeometry = false;

    const parseGeometry = (geometry: Element, depth: number): void => {
      if (depth > 8) throw new Error(`${name}: a geometria KML está aninhada em excesso.`);
      const geometryName = geometry.localName;
      if (!knownGeometryNames.has(geometryName)) throw new Error(`${name}: geometria KML não suportada (${geometryName}).`);
      if (!supportedGeometryNames.has(geometryName)) throw new Error(`${name}: geometria KML não suportada (${geometryName}).`);

      if (geometryName === "MultiGeometry") {
        const children = Array.from(geometry.children);
        if (children.length === 0) throw new Error(`${name}: MultiGeometry sem componentes.`);
        for (const child of children) parseGeometry(child, depth + 1);
        return;
      }

      if (geometryName === "Point") {
        const text = directChildByLocalName(geometry, "coordinates")?.textContent ?? "";
        const coords = readCoordinateTuples(text, name);
        if (coords.length !== 1) throw new Error(`${name}: Point deve conter exatamente uma coordenada.`);
        addFeature({ kind: "marker", coordinates: coords[0].latLng, name, description }, name);
        foundGeometry = true;
        return;
      }

      if (geometryName === "LineString" || geometryName === "LinearRing") {
        const text = directChildByLocalName(geometry, "coordinates")?.textContent ?? "";
        const coords = readCoordinateTuples(text, name);
        if (coords.length < 2) throw new Error(`${name}: ${geometryName} requer ao menos duas coordenadas.`);
        if (geometryName === "LinearRing") {
          const first = coords[0].geoJson;
          const last = coords[coords.length - 1].geoJson;
          if (coords.length < 4 || first.length !== last.length || first.some((value, index) => value !== last[index])) {
            throw new Error(`${name}: LinearRing não está fechado.`);
          }
        }
        addFeature({ kind: "line", coordinates: coords.map((coord) => coord.latLng), name, description }, name);
        foundGeometry = true;
        return;
      }

      const outerBoundaries = directChildrenByLocalName(geometry, "outerBoundaryIs");
      const innerBoundaries = directChildrenByLocalName(geometry, "innerBoundaryIs");
      if (outerBoundaries.length !== 1) throw new Error(`${name}: Polygon deve possuir exatamente um anel exterior.`);
      const allBoundaries = [outerBoundaries[0], ...innerBoundaries];
      const ringTuples = allBoundaries.map((boundary, index) => {
        const linearRing = directChildByLocalName(boundary, "LinearRing");
        const coordinates = linearRing && directChildByLocalName(linearRing, "coordinates")?.textContent;
        if (!coordinates) throw new Error(`${name}: anel ${index + 1} sem coordenadas.`);
        const tuples = readCoordinateTuples(coordinates, `${name}, anel ${index + 1}`);
        if (tuples.length < 4) throw new Error(`${name}, anel ${index + 1}: anel deve possuir ao menos quatro posições fechadas.`);
        return tuples;
      });
      validateClosedPolygonCoordinates(ringTuples.map((ring) => ring.map((tuple) => tuple.geoJson)), "geojson-lng-lat");
      addFeature({
        kind: "polygon",
        coordinates: ringTuples.map((ring) => ring.map((tuple) => tuple.latLng)),
        name,
        description,
      }, name);
      foundGeometry = true;
    };

    for (const child of Array.from(placemark.children)) {
      if (knownGeometryNames.has(child.localName)) parseGeometry(child, 0);
    }
    if (!foundGeometry) throw new Error(`${name}: nenhum tipo de geometria KML compatível foi encontrado.`);
  }

  if (features.length === 0) throw new Error("Nenhuma geometria válida foi encontrada no KML.");
  return features;
}

/** Produces popup DOM nodes whose names/descriptions are inserted only as text. */
export function createSafeKmlPopup(document: Document, name: string, description: string): HTMLElement {
  const container = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = name;
  container.append(title);
  if (description) {
    container.append(document.createElement("br"));
    const text = document.createElement("span");
    text.textContent = description;
    container.append(text);
  }
  return container;
}
