import { createHash } from "node:crypto";
import type {
  Feature,
  FeatureCollection,
  Polygon,
  MultiPolygon,
} from "geojson";
import {
  IBGE_ATTRIBUTION,
  IBGE_EDITION,
  IBGE_MAX_BYTES,
  IBGE_PRESETS,
  IBGE_PRESET_ID,
  IBGE_PROBE_BOUNDS,
  IBGE_REMOTE_LAYER,
  IBGE_TIMEOUT_MS,
  type IbgeBounds,
} from "../shared/ibge";

export function assertIbgeEndpoint(endpoint: string, type: "wms" | "wfs") {
  if (endpoint !== IBGE_PRESETS.find(p => p.serviceType === type)!.endpoint)
    throw new Error("Endpoint fora do preset IBGE fixo");
  return new URL(endpoint);
}
export function validateIbgeBounds(b: IbgeBounds) {
  if (
    ![b.west, b.south, b.east, b.north].every(Number.isFinite) ||
    b.west < -180 ||
    b.east > 180 ||
    b.south < -90 ||
    b.north > 90 ||
    b.west >= b.east ||
    b.south >= b.north
  )
    throw new Error(
      "Viewport IBGE inválido; use longitude/latitude sem cruzar o antimeridiano"
    );
}
export function buildIbgeWfsUrl(bounds: IbgeBounds, maxFeatures: number) {
  validateIbgeBounds(bounds);
  if (!Number.isInteger(maxFeatures) || maxFeatures < 1 || maxFeatures > 201)
    throw new Error("Limite WFS IBGE inválido");
  const url = assertIbgeEndpoint(IBGE_PRESETS[1].endpoint, "wfs");
  Object.entries({
    service: "WFS",
    version: "1.0.0",
    request: "GetFeature",
    typeName: IBGE_REMOTE_LAYER,
    outputFormat: "application/json",
    srsName: "EPSG:4674",
    bbox: `${bounds.west},${bounds.south},${bounds.east},${bounds.north},EPSG:4674`,
    maxFeatures: String(maxFeatures),
  }).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}
export function buildIbgeWmsProbeUrl() {
  const url = assertIbgeEndpoint(IBGE_PRESETS[0].endpoint, "wms");
  const x = (lon: number) => (lon * 20037508.342789244) / 180;
  const y = (lat: number) =>
    (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * 20037508.342789244) /
    Math.PI;
  const b = IBGE_PROBE_BOUNDS;
  Object.entries({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: IBGE_REMOTE_LAYER,
    STYLES: "",
    CRS: "EPSG:3857",
    BBOX: `${x(b.west)},${y(b.south)},${x(b.east)},${y(b.north)}`,
    WIDTH: "128",
    HEIGHT: "128",
    FORMAT: "image/png",
    TRANSPARENT: "TRUE",
  }).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}
async function fetchBounded(url: URL, accept: string, fetchImpl: typeof fetch) {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0")
    throw new Error("TLS estrito obrigatório para IBGE");
  const started = Date.now();
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(IBGE_TIMEOUT_MS),
    headers: { Accept: accept },
  });
  if (!response.ok) throw new Error(`IBGE retornou HTTP ${response.status}`);
  const advertised = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertised) && advertised > IBGE_MAX_BYTES) {
    await response.body?.cancel();
    throw new Error("IBGE excedeu limite de 4 MiB");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Resposta IBGE sem corpo");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > IBGE_MAX_BYTES) {
        await reader.cancel();
        throw new Error("IBGE excedeu limite de 4 MiB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return {
    body: Buffer.concat(chunks),
    bytes,
    httpStatus: response.status,
    contentType: response.headers.get("content-type") || "",
    elapsedMs: Date.now() - started,
    fetchedAt: new Date().toISOString(),
    requestUrl: url.toString(),
  };
}
type MunicipalFeature = Feature<Polygon | MultiPolygon>;
function validPolygon(coords: unknown): boolean {
  return (
    Array.isArray(coords) &&
    coords.length > 0 &&
    coords.every(
      ring =>
        Array.isArray(ring) &&
        ring.length >= 4 &&
        ring.every(
          pos =>
            Array.isArray(pos) &&
            pos.length >= 2 &&
            pos.every(n => typeof n === "number" && Number.isFinite(n)) &&
            pos[0] >= -180 &&
            pos[0] <= 180 &&
            pos[1] >= -90 &&
            pos[1] <= 90
        ) &&
        ring[0][0] === ring[ring.length - 1][0] &&
        ring[0][1] === ring[ring.length - 1][1]
    )
  );
}
export function decodeIbgeCollection(body: Buffer): {
  collection: FeatureCollection<Polygon | MultiPolygon>;
  matched: number | null;
} {
  const raw = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(body)
  );
  if (!raw || raw.type !== "FeatureCollection" || !Array.isArray(raw.features))
    throw new Error("IBGE não retornou FeatureCollection válido");
  if (raw.crs !== undefined && raw.crs !== null) {
    const name = raw.crs?.type === "name" ? raw.crs?.properties?.name : null;
    if (
      typeof name !== "string" ||
      !/^(?:EPSG:4674|urn:ogc:def:crs:EPSG::4674|http:\/\/www\.opengis\.net\/def\/crs\/EPSG\/0\/4674)$/i.test(
        name
      )
    )
      throw new Error("CRS IBGE contradiz EPSG:4674 solicitado");
  }
  for (const feature of raw.features) {
    if (
      !feature ||
      feature.type !== "Feature" ||
      !feature.properties ||
      typeof feature.properties !== "object" ||
      Array.isArray(feature.properties)
    )
      throw new Error("Feição IBGE inválida");
    const g = feature.geometry;
    if (
      !g ||
      !(g.type === "Polygon"
        ? validPolygon(g.coordinates)
        : g.type === "MultiPolygon" &&
          Array.isArray(g.coordinates) &&
          g.coordinates.length > 0 &&
          g.coordinates.every(validPolygon))
    )
      throw new Error("Geometria municipal IBGE inválida");
  }
  const counts = [raw.numberMatched, raw.totalFeatures].filter(
    v => v !== undefined && v !== null && v !== "unknown"
  );
  const parsed = counts.map(v =>
    typeof v === "number"
      ? v
      : typeof v === "string" && /^\d+$/.test(v)
        ? Number(v)
        : NaN
  );
  if (
    parsed.some(n => !Number.isSafeInteger(n) || n < raw.features.length) ||
    (parsed.length > 1 && parsed.some(n => n !== parsed[0]))
  )
    throw new Error("Contagem IBGE inconsistente");
  if (
    raw.numberReturned !== undefined &&
    Number(raw.numberReturned) !== raw.features.length
  )
    throw new Error("Resposta IBGE incompleta");
  return {
    collection: {
      type: "FeatureCollection",
      features: raw.features as MunicipalFeature[],
    },
    matched: parsed[0] ?? null,
  };
}
export async function probeIbgePreset(fetchImpl: typeof fetch = fetch) {
  const [map, vector] = await Promise.all([
    fetchBounded(buildIbgeWmsProbeUrl(), "image/png", fetchImpl),
    fetchBounded(
      buildIbgeWfsUrl(IBGE_PROBE_BOUNDS, 2),
      "application/json,application/geo+json",
      fetchImpl
    ),
  ]);
  if (
    !/^image\/png(?:;|$)/i.test(map.contentType) ||
    map.body.length < 24 ||
    !map.body
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    map.body.toString("ascii", 12, 16) !== "IHDR" ||
    map.body.readUInt32BE(16) !== 128 ||
    map.body.readUInt32BE(20) !== 128
  )
    throw new Error("GetMap IBGE não retornou PNG 128×128 válido");
  if (!/^(application\/(?:geo\+json|json))(?:;|$)/i.test(vector.contentType))
    throw new Error("GetFeature IBGE não retornou JSON");
  const decoded = decodeIbgeCollection(vector.body);
  if (
    decoded.collection.features.length !== 1 ||
    String(decoded.collection.features[0].properties?.CodMunic) !== "5300108" ||
    (decoded.matched !== null && decoded.matched !== 1)
  )
    throw new Error(
      "Probe IBGE não confirmou exatamente o município de Brasília (5300108)"
    );
  const evidence = (r: typeof map) => ({
    requestUrl: r.requestUrl,
    fetchedAt: r.fetchedAt,
    httpStatus: r.httpStatus,
    contentType: r.contentType,
    bytes: r.bytes,
    sha256: createHash("sha256").update(r.body).digest("hex"),
    elapsedMs: r.elapsedMs,
  });
  return {
    presetId: IBGE_PRESET_ID,
    edition: IBGE_EDITION,
    remoteLayer: IBGE_REMOTE_LAYER,
    healthCheck: "targeted-layer-probe" as const,
    healthy: true as const,
    strictTls: true as const,
    redirect: "error" as const,
    maxBytesPerResponse: IBGE_MAX_BYTES,
    timeoutMs: IBGE_TIMEOUT_MS,
    bounds: IBGE_PROBE_BOUNDS,
    wms: {
      ...evidence(map),
      request: "GetMap",
      version: "1.3.0",
      crs: "EPSG:3857",
      width: 128,
      height: 128,
      pngSignatureVerified: true,
    },
    wfs: {
      ...evidence(vector),
      request: "GetFeature",
      version: "1.0.0",
      crs: "EPSG:4674",
      axisOrder: "longitude,latitude",
      maxFeatures: 2,
      featureCount: 1,
      municipalityCode: "5300108",
      geometryType: decoded.collection.features[0].geometry.type,
    },
  };
}
export type IbgeProbeEvidence = Awaited<ReturnType<typeof probeIbgePreset>>;
/** Uma requisição limitada, inteiramente em memória; nunca cria layers nem persiste GeoJSON. */
export async function queryIbgeRemote(
  input: { bounds: IbgeBounds; limit?: number; decodeRemote: true },
  fetchImpl: typeof fetch = fetch
) {
  if (input.decodeRemote !== true)
    throw new Error(
      "Confirme decodeRemote:true para decodificação temporária em memória"
    );
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new Error("Limite IBGE deve ser inteiro entre 1 e 200");
  const response = await fetchBounded(
    buildIbgeWfsUrl(input.bounds, limit + 1),
    "application/json,application/geo+json",
    fetchImpl
  );
  if (!/^application\/(?:geo\+json|json)(?:;|$)/i.test(response.contentType))
    throw new Error("IBGE não retornou JSON");
  const { collection, matched } = decodeIbgeCollection(response.body);
  if (
    collection.features.length > limit ||
    (matched !== null && matched !== collection.features.length)
  )
    throw new Error(
      "Viewport IBGE excede o limite ou resposta truncada; aproxime o mapa. Nenhuma feição parcial foi retornada."
    );
  return {
    type: "FeatureCollection" as const,
    features: collection.features,
    complete: true as const,
    truncated: false as const,
    matched: matched ?? collection.features.length,
    attribution: IBGE_ATTRIBUTION,
    metadata: {
      presetId: IBGE_PRESET_ID,
      publisher: "IBGE",
      edition: IBGE_EDITION,
      remoteLayer: IBGE_REMOTE_LAYER,
      crs: "EPSG:4674",
      axisOrder: "longitude,latitude",
      bounds: input.bounds,
      limit,
      requestedMaxFeatures: limit + 1,
      bytesFetched: response.bytes,
      fetchedAt: response.fetchedAt,
      maxBytes: IBGE_MAX_BYTES,
      timeoutMs: IBGE_TIMEOUT_MS,
      decodeRemote: true,
      persistence: "none",
      matchedSource:
        matched === null ? "exhausted-bounded-response" : "remote-count",
    },
  };
}
