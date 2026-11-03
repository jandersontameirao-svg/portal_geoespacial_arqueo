import { createHash } from "node:crypto";
import type { FeatureCollection, Geometry } from "geojson";
import {
  INSTITUTIONAL_MAX_BYTES,
  INSTITUTIONAL_TIMEOUT_MS,
  eligibleInstitutionalProtocols,
  getInstitutionalSource,
  type InstitutionalBounds,
  type InstitutionalPublisher,
  type InstitutionalProtocol,
  type InstitutionalSource,
} from "../shared/institutionalOgc";

export function validateInstitutionalBounds(b: InstitutionalBounds) {
  if (
    ![b.west, b.south, b.east, b.north].every(Number.isFinite) ||
    b.west < -180 ||
    b.east > 180 ||
    b.south < -90 ||
    b.north > 90 ||
    b.west >= b.east ||
    b.south >= b.north ||
    b.east - b.west > 2 ||
    b.north - b.south > 2
  )
    throw new Error("Viewport inválido ou superior a 2°; aproxime o mapa");
}
export function assertInstitutionalEndpoint(
  publisher: InstitutionalPublisher,
  type: InstitutionalProtocol,
  endpoint: string
) {
  const fixed = getInstitutionalSource(publisher).protocols[type]?.endpoint;
  const url = new URL(endpoint);
  if (
    !fixed ||
    endpoint !== fixed ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.port && url.port !== "443")
  )
    throw new Error("Endpoint fora da allowlist HTTPS institucional fixa");
  return url;
}
function usable(
  publisher: InstitutionalPublisher,
  type: InstitutionalProtocol
) {
  const source = getInstitutionalSource(publisher);
  if (!eligibleInstitutionalProtocols(source).includes(type))
    throw new Error(source.blocker || "Protocolo institucional não comprovado");
  return source;
}
export function buildInstitutionalWfsUrl(
  publisher: InstitutionalPublisher,
  bounds: InstitutionalBounds,
  maxFeatures: number
) {
  const source = usable(publisher, "wfs");
  validateInstitutionalBounds(bounds);
  if (!Number.isInteger(maxFeatures) || maxFeatures < 1 || maxFeatures > 201)
    throw new Error("Limite WFS inválido");
  const config = source.protocols.wfs!;
  if (config.version !== "1.0.0" && config.version !== "2.0.0")
    throw new Error("Versão WFS não comprovada");
  const url = assertInstitutionalEndpoint(publisher, "wfs", config.endpoint);
  const bboxCrs = config.bboxCrs ?? source.sourceCrs;
  const bbox =
    config.bboxAxisOrder === "latitude,longitude"
      ? `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`
      : `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;
  Object.entries({
    service: "WFS",
    version: config.version,
    request: "GetFeature",
    [config.version === "2.0.0" ? "typeNames" : "typeName"]:
      source.remoteLayer!,
    outputFormat: "application/json",
    srsName: source.sourceCrs,
    bbox: `${bbox},${bboxCrs}`,
    [config.version === "2.0.0" ? "count" : "maxFeatures"]: String(maxFeatures),
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  return url;
}
export function buildInstitutionalWmsProbeUrl(
  publisher: InstitutionalPublisher
) {
  const source = usable(publisher, "wms");
  const b = source.probeBounds!;
  validateInstitutionalBounds(b);
  const url = assertInstitutionalEndpoint(
    publisher,
    "wms",
    source.protocols.wms!.endpoint
  );
  if (source.protocols.wms!.version !== "1.1.1")
    throw new Error("WMS exige versão 1.1.1 comprovada");
  const x = (lon: number) => (lon * 20037508.342789244) / 180;
  const y = (lat: number) =>
    (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * 20037508.342789244) /
    Math.PI;
  if (b.south <= -85.05112878 || b.north >= 85.05112878)
    throw new Error("BBOX fora do Web Mercator");
  Object.entries({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    LAYERS: source.remoteLayer!,
    STYLES: "",
    SRS: "EPSG:3857",
    BBOX: `${x(b.west)},${y(b.south)},${x(b.east)},${y(b.north)}`,
    WIDTH: "128",
    HEIGHT: "128",
    FORMAT: "image/png",
    TRANSPARENT: "TRUE",
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  return url;
}
async function fetchBounded(url: URL, accept: string, fetchImpl: typeof fetch) {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0")
    throw new Error("TLS estrito obrigatório");
  const started = Date.now();
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(INSTITUTIONAL_TIMEOUT_MS),
    headers: { Accept: accept },
  });
  if (!response.ok)
    throw new Error(`Serviço institucional retornou HTTP ${response.status}`);
  if (response.redirected)
    throw new Error("Redirecionamento institucional proibido");
  if (
    Number(response.headers.get("content-length")) > INSTITUTIONAL_MAX_BYTES
  ) {
    await response.body?.cancel();
    throw new Error("Resposta excedeu 4 MiB");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Resposta sem corpo");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > INSTITUTIONAL_MAX_BYTES) {
        await reader.cancel();
        throw new Error("Resposta excedeu 4 MiB");
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
function safeProperties(value: unknown, depth = 0): any {
  if (depth > 5) throw new Error("Atributos excedem profundidade máxima");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length <= 16384) return value;
  if (Array.isArray(value) && value.length <= 512)
    return value.map(v => safeProperties(v, depth + 1));
  if (typeof value === "object" && value && Object.keys(value).length <= 256) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (
        ["__proto__", "constructor", "prototype"].includes(k) ||
        k.length > 256
      )
        throw new Error("Chave de atributo insegura");
      result[k] = safeProperties(v, depth + 1);
    }
    return result;
  }
  throw new Error("Atributo inválido ou excessivo");
}
export function decodeInstitutionalCollection(
  body: Buffer,
  sourceCrs: InstitutionalSource["sourceCrs"]
) {
  if (body.length > INSTITUTIONAL_MAX_BYTES)
    throw new Error("Resposta excedeu 4 MiB");
  const raw = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(body)
  );
  if (
    !raw ||
    raw.type !== "FeatureCollection" ||
    !Array.isArray(raw.features) ||
    raw.features.length > 201
  )
    throw new Error("FeatureCollection inválida ou excessiva");
  if (raw.crs != null) {
    const code = sourceCrs.split(":")[1];
    const names = [
      sourceCrs,
      `urn:ogc:def:crs:EPSG::${code}`,
      `http://www.opengis.net/def/crs/EPSG/0/${code}`,
    ];
    if (raw.crs.type !== "name" || !names.includes(raw.crs.properties?.name))
      throw new Error("CRS remoto contradiz CRS comprovado");
  }
  let points = 0;
  function pos(v: any) {
    if (
      !Array.isArray(v) ||
      v.length < 2 ||
      v.length > 3 ||
      !v.every((n: any) => typeof n === "number" && Number.isFinite(n)) ||
      v[0] < -180 ||
      v[0] > 180 ||
      v[1] < -90 ||
      v[1] > 90 ||
      ++points > 100000
    )
      throw new Error("Coordenadas inválidas ou excessivas");
  }
  function line(v: any, min = 2) {
    if (!Array.isArray(v) || v.length < min) throw new Error("Linha inválida");
    v.forEach(pos);
  }
  function polygon(v: any) {
    if (!Array.isArray(v) || !v.length) throw new Error("Polígono inválido");
    v.forEach((r: any) => {
      line(r, 4);
      if (
        r[0].length !== r[r.length - 1].length ||
        !r[0].every((n: number, i: number) => n === r[r.length - 1][i])
      )
        throw new Error("Anel não fechado");
    });
  }
  function geometry(g: any, depth = 0): Geometry {
    if (!g || depth > 4) throw new Error("Geometria inválida");
    const c = g.coordinates;
    switch (g.type) {
      case "Point":
        pos(c);
        break;
      case "MultiPoint":
        if (!Array.isArray(c) || !c.length)
          throw new Error("MultiPoint inválido");
        c.forEach(pos);
        break;
      case "LineString":
        line(c);
        break;
      case "MultiLineString":
        if (!Array.isArray(c) || !c.length)
          throw new Error("MultiLineString inválido");
        c.forEach((l: any) => line(l));
        break;
      case "Polygon":
        polygon(c);
        break;
      case "MultiPolygon":
        if (!Array.isArray(c) || !c.length)
          throw new Error("MultiPolygon inválido");
        c.forEach(polygon);
        break;
      case "GeometryCollection":
        if (!Array.isArray(g.geometries) || g.geometries.length > 512)
          throw new Error("GeometryCollection inválida");
        return {
          type: "GeometryCollection",
          geometries: g.geometries.map((v: any) => geometry(v, depth + 1)),
        };
      default:
        throw new Error("Tipo geométrico não permitido");
    }
    return { type: g.type, coordinates: c } as Geometry;
  }
  const features = raw.features.map((f: any) => {
    if (
      !f ||
      f.type !== "Feature" ||
      !f.properties ||
      typeof f.properties !== "object" ||
      Array.isArray(f.properties)
    )
      throw new Error("Feição inválida");
    if (
      f.id !== undefined &&
      !(typeof f.id === "string" && f.id.length <= 512) &&
      !(typeof f.id === "number" && Number.isSafeInteger(f.id))
    )
      throw new Error("ID inválido");
    return {
      type: "Feature",
      ...(f.id === undefined ? {} : { id: f.id }),
      geometry: geometry(f.geometry),
      properties: safeProperties(f.properties),
    };
  });
  const counts = [raw.numberMatched, raw.totalFeatures]
    .filter(v => v !== undefined && v !== null && v !== "unknown")
    .map(v =>
      typeof v === "number"
        ? v
        : typeof v === "string" && /^\d+$/.test(v)
          ? Number(v)
          : NaN
    );
  if (
    counts.some(
      v => !Number.isSafeInteger(v) || v < features.length || v !== counts[0]
    )
  )
    throw new Error("Contagem remota inconsistente");
  if (
    raw.numberReturned !== undefined &&
    (!/^\d+$/.test(String(raw.numberReturned)) ||
      Number(raw.numberReturned) !== features.length)
  )
    throw new Error("Resposta incompleta");
  if (raw.next || raw.links?.some?.((v: any) => v?.rel === "next"))
    throw new Error("Resposta paginada/truncada não permitida");
  return {
    collection: { type: "FeatureCollection", features } as FeatureCollection,
    matched: counts[0] ?? null,
  };
}
export async function queryInstitutionalRemote(
  input: {
    publisher: InstitutionalPublisher;
    bounds: InstitutionalBounds;
    limit?: number;
  },
  fetchImpl: typeof fetch = fetch
) {
  const source = usable(input.publisher, "wfs");
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new Error("Limite deve estar entre 1 e 200");
  const response = await fetchBounded(
    buildInstitutionalWfsUrl(input.publisher, input.bounds, limit + 1),
    "application/json,application/geo+json",
    fetchImpl
  );
  if (!/^application\/(?:geo\+json|json)(?:;|$)/i.test(response.contentType))
    throw new Error("GetFeature não retornou JSON");
  const { collection, matched } = decodeInstitutionalCollection(
    response.body,
    source.sourceCrs
  );
  if (
    collection.features.length > limit ||
    (matched !== null && matched !== collection.features.length)
  )
    throw new Error(
      "Viewport excede limite ou resposta truncada; aproxime o mapa. Nenhuma feição parcial retornada."
    );
  return {
    collection,
    complete: true as const,
    truncated: false as const,
    matched: matched ?? collection.features.length,
    queriedAt: response.fetchedAt,
    attribution: source.attribution,
    featureCount: collection.features.length,
    metadata: {
      presetId: source.presetId,
      publisher: source.publisher,
      edition: source.edition,
      remoteLayer: source.remoteLayer,
      crs: source.sourceCrs,
      axisOrder: "longitude,latitude",
      bboxAxisOrder:
        source.protocols.wfs!.bboxAxisOrder ?? "longitude,latitude",
      bboxCrs: source.protocols.wfs!.bboxCrs ?? source.sourceCrs,
      bounds: input.bounds,
      limit,
      requestedMaxFeatures: limit + 1,
      bytesFetched: response.bytes,
      fetchedAt: response.fetchedAt,
      maxBytes: INSTITUTIONAL_MAX_BYTES,
      timeoutMs: INSTITUTIONAL_TIMEOUT_MS,
      decodeRemote: true,
      persistence: "none",
      matchedSource:
        matched === null ? "exhausted-bounded-response" : "remote-count",
    },
  };
}
export async function probeInstitutionalSource(
  publisher: InstitutionalPublisher,
  fetchImpl: typeof fetch = fetch
) {
  const source = getInstitutionalSource(publisher);
  const types = eligibleInstitutionalProtocols(source);
  if (!types.length)
    throw new Error(source.blocker || "Fonte institucional bloqueada");
  const protocols: Partial<
    Record<InstitutionalProtocol, Record<string, unknown>>
  > = {};
  for (const type of types) {
    const response = await fetchBounded(
      type === "wms"
        ? buildInstitutionalWmsProbeUrl(publisher)
        : buildInstitutionalWfsUrl(publisher, source.probeBounds!, 201),
      type === "wms" ? "image/png" : "application/json,application/geo+json",
      fetchImpl
    );
    let featureCount: number | undefined;
    if (type === "wms") {
      if (
        !/^image\/png(?:;|$)/i.test(response.contentType) ||
        response.body.length < 24 ||
        !response.body
          .subarray(0, 8)
          .equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
        response.body.toString("ascii", 12, 16) !== "IHDR" ||
        response.body.readUInt32BE(16) !== 128 ||
        response.body.readUInt32BE(20) !== 128
      )
        throw new Error("GetMap não confirmou PNG 128×128");
    } else {
      if (
        !/^application\/(?:geo\+json|json)(?:;|$)/i.test(response.contentType)
      )
        throw new Error("GetFeature não retornou JSON");
      const decoded = decodeInstitutionalCollection(
        response.body,
        source.sourceCrs
      );
      featureCount = decoded.collection.features.length;
      if (
        featureCount < 1 ||
        featureCount > 200 ||
        (decoded.matched !== null && decoded.matched !== featureCount)
      )
        throw new Error("Probe WFS não confirmou conjunto completo não vazio");
    }
    protocols[type] = {
      requestUrl: response.requestUrl,
      fetchedAt: response.fetchedAt,
      httpStatus: response.httpStatus,
      bytes: response.bytes,
      contentType: response.contentType,
      elapsedMs: response.elapsedMs,
      sha256: createHash("sha256").update(response.body).digest("hex"),
      version: source.protocols[type]!.version,
      crs: type === "wms" ? "EPSG:3857" : source.sourceCrs,
      axisOrder: "longitude,latitude",
      bboxAxisOrder:
        type === "wms"
          ? "easting,northing"
          : (source.protocols.wfs!.bboxAxisOrder ?? "longitude,latitude"),
      ...(featureCount === undefined ? {} : { featureCount }),
    };
  }
  return {
    publisher,
    presetId: source.presetId,
    edition: source.edition,
    remoteLayer: source.remoteLayer,
    healthy: true as const,
    healthCheck: "targeted-layer-probe" as const,
    strictTls: true as const,
    redirect: "error" as const,
    probedAt: new Date().toISOString(),
    protocols,
  };
}
export type InstitutionalProbeEvidence = Awaited<
  ReturnType<typeof probeInstitutionalSource>
>;
