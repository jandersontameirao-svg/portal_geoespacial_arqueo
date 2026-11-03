import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import * as https from "node:https";
import { DOMParser } from "@xmldom/xmldom";
import reviewedOrganizations from "../shared/indeOrganizations.json";
import {
  INDE_CATALOG_LIMITS as LIMITS,
  type IndeBounds,
  type IndeLayer,
  type IndeLayersResult,
  type IndeMapImageInput,
  type IndeMapImageResult,
  type IndeOrganization,
  type IndeOrganizationsResult,
} from "../shared/indeCatalog";

export class IndeCatalogError extends Error {
  constructor(
    public readonly kind:
      | "BAD_REQUEST"
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "BAD_GATEWAY"
      | "TOO_MANY_REQUESTS",
    message: string
  ) {
    super(message);
    this.name = "IndeCatalogError";
  }
}
const badGateway = (message: string) =>
  new IndeCatalogError("BAD_GATEWAY", message);
const badInput = (message: string) =>
  new IndeCatalogError("BAD_REQUEST", message);

const tooManyRequests = () =>
  new IndeCatalogError(
    "TOO_MANY_REQUESTS",
    "Limite de 8 consultas WMS simultâneas atingido. Tente novamente."
  );

/** Conservador: somente unicast público; rejeita também documentação e transição IPv6. */
export function isPublicIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 &&
        (b === 168 ||
          (b === 0 && (c === 0 || c === 2)) ||
          (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (family !== 6 || address.includes("%") || address.includes("."))
    return false;
  const halves = address.toLowerCase().split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const parts =
    halves.length === 1
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  const words = parts.map(p => parseInt(p, 16));
  // ::ffff/96, NAT64, ULA, link-local, multicast, loopback etc. estão fora de 2000::/3.
  if ((words[0] & 0xe000) !== 0x2000) return false;
  if (words[0] === 0x2001 && (words[1] < 0x0200 || words[1] === 0x0db8))
    return false;
  if (words[0] === 0x2002 || (words[0] === 0x3fff && words[1] < 0x1000))
    return false;
  return true;
}

/** Não remove query/porta nem promove HTTP: a origem literal deve ser revisada. */
export function canonicalEndpoint(endpoint: string): URL {
  if (
    typeof endpoint !== "string" ||
    endpoint !== endpoint.trim() ||
    /[\\\s\u0000-\u001f\u007f?#]/.test(endpoint)
  ) {
    throw new IndeCatalogError(
      "FORBIDDEN",
      "Endpoint com query, fragmento ou caracteres não permitidos."
    );
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new IndeCatalogError("FORBIDDEN", "Endpoint inválido no catálogo.");
  }
  if (url.protocol !== "https:")
    throw new IndeCatalogError(
      "FORBIDDEN",
      "Origem HTTP bloqueada: exige HTTPS com TLS válido, sem promoção automática."
    );
  const authority = endpoint.match(/^https:\/\/([^/]+)/i)?.[1] ?? "";
  // Também rejeita :443 explícito (URL.port o normaliza para vazio).
  const explicitPort = authority.startsWith("[")
    ? /\]:/.test(authority)
    : authority.includes(":");
  if (
    url.username ||
    url.password ||
    authority.includes("@") ||
    url.port ||
    explicitPort ||
    !url.hostname
  ) {
    throw new IndeCatalogError(
      "FORBIDDEN",
      "Endpoint com credenciais ou porta explícita bloqueado."
    );
  }
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal) && !isPublicIp(literal))
    throw new IndeCatalogError("FORBIDDEN", "Endereço não público bloqueado.");
  return url;
}

export type ResolvedAddress = { address: string; family: number };
export type IndeResolver = (hostname: string) => Promise<ResolvedAddress[]>;
const publicResolver: IndeResolver = hostname =>
  dnsLookup(hostname, { all: true, verbatim: true });

/** Lookup passado AO socket HTTPS: nunca resolve novamente depois da verificação. */
export function pinnedLookup(addresses: ResolvedAddress[]): LookupFunction {
  if (
    !addresses.length ||
    addresses.some(a => !isPublicIp(a.address) || isIP(a.address) !== a.family)
  ) {
    throw new IndeCatalogError(
      "FORBIDDEN",
      "DNS bloqueado: todos os endereços A/AAAA devem ser públicos."
    );
  }
  const selected = { ...addresses[0] };
  return ((
    _hostname: string,
    options: { all?: boolean } | number,
    callback: (...args: any[]) => void
  ) => {
    if (typeof options === "object" && options.all) callback(null, [selected]);
    else callback(null, selected.address, selected.family);
  }) as LookupFunction;
}

export type IndeTransport = (
  endpoint: string,
  parameters: Readonly<Record<string, string>>,
  maxBytes: number
) => Promise<Buffer>;

// Compartilhado por todas as instâncias que usam o transporte real, inclusive durante DNS.
let pinnedRequestsInFlight = 0;

/** GET isolado: sem proxy, redirect, credenciais, cookies, downgrade TLS ou DNS rebind. */
export async function requestPinnedWms(
  endpoint: string,
  parameters: Readonly<Record<string, string>>,
  maxBytes: number,
  resolve: IndeResolver = publicResolver
): Promise<Buffer> {
  if (pinnedRequestsInFlight >= LIMITS.maxConcurrentRequests)
    throw tooManyRequests();
  pinnedRequestsInFlight++;
  try {
    return await requestPinnedWmsBody(endpoint, parameters, maxBytes, resolve);
  } finally {
    pinnedRequestsInFlight--;
  }
}

async function requestPinnedWmsBody(
  endpoint: string,
  parameters: Readonly<Record<string, string>>,
  maxBytes: number,
  resolve: IndeResolver
): Promise<Buffer> {
  const url = canonicalEndpoint(endpoint);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const started = Date.now();
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  let addresses: ResolvedAddress[];
  try {
    addresses = await Promise.race([
      isIP(hostname)
        ? Promise.resolve([{ address: hostname, family: isIP(hostname) }])
        : resolve(hostname),
      new Promise<never>((_, reject) => {
        dnsTimer = setTimeout(
          () =>
            reject(badGateway("Tempo limite de 12s ao resolver origem WMS.")),
          LIMITS.timeoutMs
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof IndeCatalogError) throw error;
    throw badGateway("Não foi possível resolver o DNS da origem WMS.");
  } finally {
    if (dnsTimer) clearTimeout(dnsTimer);
  }
  const lookup = pinnedLookup(addresses);
  const remaining = LIMITS.timeoutMs - (Date.now() - started);
  if (remaining <= 0) throw badGateway("Tempo limite de 12s na origem WMS.");
  // Nunca aceitar URL do cliente ou OnlineResource do XML. Só este endpoint literal.
  for (const [key, value] of Object.entries(parameters))
    url.searchParams.set(key, value);
  return new Promise<Buffer>((resolveBody, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, data?: Buffer) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolveBody(data!);
    };
    const request = https.request(
      url,
      {
        method: "GET",
        lookup,
        agent: false,
        rejectUnauthorized: true,
        ...(isIP(hostname) ? {} : { servername: hostname }),
        headers: {
          Accept:
            parameters.REQUEST === "GetMap"
              ? "image/png"
              : "application/xml,text/xml",
          "Accept-Encoding": "identity",
        },
      },
      response => {
        const status = response.statusCode ?? 0;
        if (status !== 200) {
          finish(
            badGateway(
              status >= 300 && status < 400
                ? "Redirect WMS bloqueado; revise a origem canônica."
                : `Origem WMS retornou HTTP ${status}.`
            )
          );
          response.destroy();
          request.destroy();
          return;
        }
        const encoding = response.headers["content-encoding"];
        const length = response.headers["content-length"];
        if (
          (encoding && encoding !== "identity") ||
          (length && (!/^\d+$/.test(length) || Number(length) > maxBytes))
        ) {
          finish(
            badGateway("Resposta WMS comprimida ou acima do limite permitido.")
          );
          response.destroy();
          request.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBytes) {
            finish(badGateway("Resposta WMS excedeu o limite de bytes."));
            response.destroy();
            request.destroy();
          } else chunks.push(Buffer.from(chunk));
        });
        response.on("end", () =>
          finish(undefined, Buffer.concat(chunks, received))
        );
        response.on("error", () =>
          finish(badGateway("Falha ao ler resposta WMS."))
        );
        response.on("aborted", () =>
          finish(badGateway("Resposta WMS interrompida."))
        );
      }
    );
    timer = setTimeout(() => {
      finish(badGateway("Tempo limite de 12s na origem WMS."));
      request.destroy();
    }, remaining);
    request.on("error", () =>
      finish(
        badGateway(
          "Falha HTTPS/TLS na origem WMS; certificado estrito obrigatório."
        )
      )
    );
    request.end();
  });
}

function children(element: Element, tag: string): Element[] {
  const result: Element[] = [];
  for (let i = 0; i < element.childNodes.length; i++) {
    const node = element.childNodes.item(i);
    if (
      node?.nodeType === 1 &&
      ((node as Element).localName || node.nodeName) === tag
    )
      result.push(node as Element);
  }
  return result;
}
const text = (element: Element, tag: string) =>
  children(element, tag)[0]?.textContent?.trim() ?? "";
const titleText = (value: string) =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 2_048);
export function isSafeLayerName(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f,]/.test(value)
  );
}
function geographicBounds(values: string[]): IndeBounds | undefined {
  if (values.some(v => !v.trim())) return;
  const [west, south, east, north] = values.map(Number);
  if (
    ![west, south, east, north].every(Number.isFinite) ||
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    west >= east ||
    south >= north
  )
    return;
  return { west, south, east, north };
}
function boundsOf(element: Element, version: string): IndeBounds | undefined {
  const latlon = children(element, "LatLonBoundingBox")[0];
  if (latlon) {
    const box = geographicBounds(
      ["minx", "miny", "maxx", "maxy"].map(a => latlon.getAttribute(a) ?? "")
    );
    if (box) return box;
  }
  const ex = children(element, "EX_GeographicBoundingBox")[0];
  if (ex) {
    const box = geographicBounds(
      [
        "westBoundLongitude",
        "southBoundLatitude",
        "eastBoundLongitude",
        "northBoundLatitude",
      ].map(t => text(ex, t))
    );
    if (box) return box;
  }
  for (const bbox of children(element, "BoundingBox")) {
    if (
      (version === "1.3.0"
        ? bbox.getAttribute("CRS")
        : bbox.getAttribute("SRS") || bbox.getAttribute("CRS")
      )?.toUpperCase() === "EPSG:4326"
    ) {
      // WMS 1.3.0 EPSG:4326 anuncia latitude/longitude; a API permanece lon/lat.
      const box = geographicBounds(
        (version === "1.3.0"
          ? ["miny", "minx", "maxy", "maxx"]
          : ["minx", "miny", "maxx", "maxy"]
        ).map(a => bbox.getAttribute(a) ?? "")
      );
      if (box) return box;
    }
  }
}

/** XML não confiável: sem DTD/ENTITY; strings são texto, não HTML renderizável. */
export function parseIndeCapabilities(
  body: Buffer,
  organizationId: string,
  fetchedAt: string
): IndeLayersResult {
  if (!body.length || body.length > LIMITS.capabilitiesBytes)
    throw badGateway("Capabilities vazio ou acima de 8 MiB.");
  const xml = body.toString("utf8");
  if (/\u0000/.test(xml) || /<\s*!\s*(DOCTYPE|ENTITY)\b/i.test(xml))
    throw badGateway(
      "Capabilities com DTD, ENTITY ou codificação não permitida."
    );
  let malformed = false;
  let document: Document;
  try {
    document = new DOMParser({
      errorHandler: {
        warning: () => {
          malformed = true;
        },
        error: () => {
          malformed = true;
        },
        fatalError: () => {
          malformed = true;
        },
      },
    }).parseFromString(xml, "text/xml") as unknown as Document;
  } catch {
    throw badGateway("XML de capabilities inválido.");
  }
  const root = document.documentElement;
  const version = root?.getAttribute("version");
  const rootName = root && (root.localName || root.nodeName);
  if (
    malformed ||
    !root ||
    !(
      (rootName === "WMS_Capabilities" && version === "1.3.0") ||
      (rootName === "WMT_MS_Capabilities" && version === "1.1.1")
    )
  ) {
    throw badGateway(
      "Resposta não é GetCapabilities WMS 1.3.0 ou 1.1.1 válido."
    );
  }
  const capability = children(root, "Capability")[0];
  const roots = capability ? children(capability, "Layer") : [];
  if (!roots.length)
    throw badGateway("Capabilities sem hierarquia de camadas WMS.");
  // Limites de estrutura também impedem recursão profunda na extração.
  const scan: { node: Node; depth: number }[] = [{ node: root, depth: 0 }];
  let nodes = 0;
  while (scan.length) {
    const { node, depth } = scan.pop()!;
    if (++nodes > 200_000 || depth > 128)
      throw badGateway("Hierarquia XML acima dos limites seguros.");
    for (let i = 0; i < (node.childNodes?.length ?? 0); i++)
      scan.push({ node: node.childNodes.item(i)!, depth: depth + 1 });
  }
  const stack = roots.reverse().map(element => ({
    element,
    crs: [] as string[],
    bounds: undefined as IndeBounds | undefined,
  }));
  const layers: IndeLayer[] = [];
  const seen = new Set<string>();
  let truncated = false;
  while (stack.length) {
    const {
      element,
      crs: inheritedCrs,
      bounds: inheritedBounds,
    } = stack.pop()!;
    const ownCrs = [...children(element, "SRS"), ...children(element, "CRS")]
      .flatMap(c => (c.textContent ?? "").trim().split(/\s+/))
      .map(c => c.toUpperCase())
      .filter(c => c.length > 0 && c.length <= 128);
    const crs = Array.from(new Set([...inheritedCrs, ...ownCrs]));
    const bounds = boundsOf(element, version!) ?? inheritedBounds;
    const name = text(element, "Name");
    if (name && !seen.has(name)) {
      if (!isSafeLayerName(name))
        throw badGateway("Capabilities contém nome de camada não permitido.");
      seen.add(name);
      if (layers.length >= LIMITS.namedLayers) {
        truncated = true;
        break;
      }
      layers.push({
        name,
        title: titleText(text(element, "Title") || name),
        crs,
        ...(bounds ? { bounds: { ...bounds } } : {}),
      });
    }
    for (const child of children(element, "Layer").reverse())
      stack.push({ element: child, crs, bounds });
  }
  return {
    organizationId,
    layers,
    version: version!,
    fetchedAt,
    capabilitySha256: createHash("sha256").update(body).digest("hex"),
    truncated,
  };
}

export function validateIndeMapInput(input: IndeMapImageInput): void {
  if (
    !input ||
    !isSafeLayerName(input.layerName ?? "") ||
    typeof input.organizationId !== "string" ||
    !input.organizationId ||
    input.organizationId.length > 200
  )
    throw badInput("Identificador ou nome de camada inválido.");
  if (input.crs !== "EPSG:4326" && input.crs !== "EPSG:3857")
    throw badInput("CRS de mapa não permitido.");
  const { width, height } = input;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > LIMITS.maxWidth ||
    height > LIMITS.maxHeight ||
    width * height > LIMITS.maxPixels
  )
    throw badInput("Dimensões excedem 1024×512 / 524288 pixels.");
  if (
    !Array.isArray(input.bounds) ||
    input.bounds.length !== 4 ||
    !input.bounds.every(Number.isFinite)
  )
    throw badInput("BBOX deve ter quatro números finitos.");
  const [west, south, east, north] = input.bounds;
  const x = input.crs === "EPSG:4326" ? 180 : LIMITS.webMercatorExtent;
  const y = input.crs === "EPSG:4326" ? 90 : LIMITS.webMercatorExtent;
  if (
    west < -x ||
    east > x ||
    south < -y ||
    north > y ||
    west >= east ||
    south >= north
  )
    throw badInput("BBOX fora do domínio do CRS ou com eixos invertidos.");
}

/** Valida assinatura e IHDR, estrutura de chunks, dimensões e fim; nunca retorna XML 200. */
export function validateIndePng(
  body: Buffer,
  width: number,
  height: number
): void {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    body.length > LIMITS.imageBytes ||
    body.length < 45 ||
    !body.subarray(0, 8).equals(signature)
  )
    throw badGateway("GetMap não retornou PNG válido (pode ser exceção WMS).");
  let offset = 8;
  let first = true;
  let imageData = false;
  let ended = false;
  while (offset + 12 <= body.length) {
    const length = body.readUInt32BE(offset);
    const type = body.toString("ascii", offset + 4, offset + 8);
    if (length > body.length - offset - 12 || !/^[A-Za-z]{4}$/.test(type))
      throw badGateway("Chunk PNG inválido.");
    if (first) {
      if (
        type !== "IHDR" ||
        length !== 13 ||
        body.readUInt32BE(offset + 8) !== width ||
        body.readUInt32BE(offset + 12) !== height
      )
        throw badGateway("Dimensões IHDR diferentes do mapa solicitado.");
      const depth = body[offset + 16];
      const color = body[offset + 17];
      const allowedDepths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        !allowedDepths[color]?.includes(depth) ||
        body[offset + 18] !== 0 ||
        body[offset + 19] !== 0 ||
        body[offset + 20] > 1
      )
        throw badGateway("IHDR PNG inválido.");
      first = false;
    } else if (type === "IHDR") throw badGateway("IHDR PNG duplicado.");
    if (type === "IDAT" && length > 0) imageData = true;
    offset += length + 12;
    if (type === "IEND") {
      if (length !== 0 || offset !== body.length)
        throw badGateway("Fim PNG inválido.");
      ended = true;
      break;
    }
  }
  if (!imageData || !ended) throw badGateway("PNG incompleto.");
}

export interface IndeCatalogService {
  organizations(): IndeOrganizationsResult;
  layers(organizationId: string): Promise<IndeLayersResult>;
  mapImage(input: IndeMapImageInput): Promise<IndeMapImageResult>;
}

export function createIndeCatalogService(
  options: {
    organizations?: readonly IndeOrganization[];
    transport?: IndeTransport;
    now?: () => number;
  } = {}
): IndeCatalogService {
  const now = options.now ?? Date.now;
  const upstreamTransport = options.transport ?? requestPinnedWms;
  // Um só orçamento para capabilities e mapas, também com transporte injetado nos testes.
  let requestsInFlight = 0;
  const transport: IndeTransport = async (endpoint, parameters, maxBytes) => {
    if (requestsInFlight >= LIMITS.maxConcurrentRequests)
      throw tooManyRequests();
    requestsInFlight++;
    try {
      return await upstreamTransport(endpoint, parameters, maxBytes);
    } finally {
      requestsInFlight--;
    }
  };
  const listFetchedAt = new Date(now()).toISOString();
  const sourceFetchedAt = options.organizations
    ? listFetchedAt
    : (reviewedOrganizations[0]?.fetchedAt ?? listFetchedAt);
  const registry = new Map<string, IndeOrganization>();
  for (const raw of options.organizations ?? reviewedOrganizations) {
    if (
      !raw ||
      ![raw.id, raw.label, raw.name, raw.level, raw.endpoint].every(
        v => typeof v === "string"
      ) ||
      !raw.id ||
      registry.has(raw.id) ||
      typeof raw.eligible !== "boolean" ||
      !(raw.blocker === null || typeof raw.blocker === "string")
    )
      throw new Error("Metadados INDE locais inválidos ou duplicados.");
    const org: IndeOrganization = {
      id: raw.id,
      label: titleText(raw.label),
      name: titleText(raw.name),
      level: titleText(raw.level),
      endpoint: raw.endpoint,
      eligible: raw.eligible,
      blocker: raw.blocker,
    };
    try {
      canonicalEndpoint(org.endpoint);
    } catch (error) {
      org.eligible = false;
      org.blocker =
        error instanceof Error ? error.message : "Endpoint bloqueado.";
    }
    if (!org.eligible && !org.blocker)
      org.blocker = "Origem não habilitada na revisão do catálogo.";
    if (org.blocker) org.eligible = false;
    registry.set(org.id, org);
  }
  const cache = new Map<string, { expires: number; value: IndeLayersResult }>();
  const pending = new Map<string, Promise<IndeLayersResult>>();
  function ownedOrganization(id: string): IndeOrganization {
    const org = registry.get(id);
    if (!org)
      throw new IndeCatalogError(
        "NOT_FOUND",
        "Órgão fora do catálogo INDE revisado."
      );
    if (!org.eligible)
      throw new IndeCatalogError(
        "FORBIDDEN",
        org.blocker || "Origem bloqueada."
      );
    canonicalEndpoint(org.endpoint);
    return org;
  }
  async function layers(organizationId: string): Promise<IndeLayersResult> {
    const org = ownedOrganization(organizationId);
    const cached = cache.get(org.id);
    if (cached && cached.expires > now()) {
      cache.delete(org.id);
      cache.set(org.id, cached);
      return structuredClone(cached.value);
    }
    cache.delete(org.id);
    const existing = pending.get(org.id);
    if (existing) return structuredClone(await existing);
    if (pending.size >= LIMITS.maxConcurrentRequests) throw tooManyRequests();
    const task = (async () => {
      const body = await transport(
        org.endpoint,
        { SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetCapabilities" },
        LIMITS.capabilitiesBytes
      );
      const result = parseIndeCapabilities(
        body,
        org.id,
        new Date(now()).toISOString()
      );
      cache.set(org.id, { expires: now() + LIMITS.cacheTtlMs, value: result });
      while (cache.size > LIMITS.cacheEntries)
        cache.delete(cache.keys().next().value!);
      return result;
    })();
    pending.set(org.id, task);
    try {
      return structuredClone(await task);
    } finally {
      if (pending.get(org.id) === task) pending.delete(org.id);
    }
  }
  return {
    organizations: () => ({
      organizations: Array.from(registry.values(), org => ({ ...org })),
      sourceUrl: "https://visualizador.inde.gov.br/api/buscacamada",
      fetchedAt: sourceFetchedAt,
      listFetchedAt,
    }),
    layers,
    async mapImage(input) {
      validateIndeMapInput(input);
      const org = ownedOrganization(input.organizationId);
      const capabilities = await layers(org.id);
      const layer = capabilities.layers.find(
        candidate => candidate.name === input.layerName
      );
      if (!layer)
        throw badInput(
          "Camada não pertence às capabilities deste órgão (ou está além do limite visível de 1000)."
        );
      if (!layer.crs.includes(input.crs))
        throw badInput("CRS não anunciado para esta camada WMS.");
      const modern = capabilities.version === "1.3.0";
      const [west, south, east, north] = input.bounds;
      const wmsBounds =
        modern && input.crs === "EPSG:4326"
          ? [south, west, north, east]
          : input.bounds;
      const body = await transport(
        org.endpoint,
        {
          SERVICE: "WMS",
          VERSION: capabilities.version,
          REQUEST: "GetMap",
          LAYERS: layer.name,
          STYLES: "",
          [modern ? "CRS" : "SRS"]: input.crs,
          BBOX: wmsBounds.join(","),
          WIDTH: String(input.width),
          HEIGHT: String(input.height),
          FORMAT: "image/png",
          TRANSPARENT: "TRUE",
          EXCEPTIONS: modern ? "XML" : "application/vnd.ogc.se_xml",
        },
        LIMITS.imageBytes
      );
      validateIndePng(body, input.width, input.height);
      return {
        dataUrl: `data:image/png;base64,${body.toString("base64")}`,
        crs: input.crs,
        bounds: [...input.bounds],
        attribution: `Fonte: ${org.label} — catálogo INDE`,
      };
    },
  };
}

/** Sem chamadas de rede na importação; capabilities são consultadas apenas sob demanda autenticada. */
export const indeCatalogService = createIndeCatalogService();
