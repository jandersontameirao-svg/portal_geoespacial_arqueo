import { createHash } from "node:crypto";
import { isIP } from "node:net";

export type OgcServiceType = "wms" | "wfs";
export type OgcHealth = "healthy" | "timeout" | "tls_error" | "http_error" | "invalid_capabilities" | "blocked";
export type OgcEndpointPolicy = { allowedHosts: readonly string[]; allowTestHttp?: boolean; allowTestLoopback?: boolean };
export type CatalogVariant = { id: number; logicalLayerId: number; role: "primary" | "fallback"; priority: number; serviceType: OgcServiceType; endpoint: string; remoteLayer: string; enabled: boolean; health: OgcHealth };

const MAX_CAPABILITIES_BYTES = 2 * 1024 * 1024;

export function normalizeOgcEndpoint(value: string, policy: OgcEndpointPolicy): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Endpoint OGC inválido"); }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isTestLoopback = ["127.0.0.1", "::1", "localhost"].includes(hostname);
  if (isIP(hostname) && !isTestLoopback) throw new Error("Endpoint OGC não pode usar IP literal");
  const allowedProtocol = url.protocol === "https:" || (policy.allowTestHttp && url.protocol === "http:");
  if (!allowedProtocol) throw new Error("Somente HTTPS é permitido para endpoints OGC");
  if (url.username || url.password || url.hash || url.search) throw new Error("Endpoint não pode conter credenciais, fragmento ou query");
  if (url.port && url.port !== "443" && !(policy.allowTestHttp && isTestLoopback)) throw new Error("Porta não permitida para endpoint OGC");
  if (isTestLoopback && !policy.allowTestLoopback) throw new Error("Host local é bloqueado fora de testes");
  if (!isTestLoopback && !policy.allowedHosts.includes(hostname)) throw new Error("Host não está na allowlist OGC");
  if (!url.pathname.startsWith("/")) throw new Error("Path OGC inválido");
  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  return url;
}

export function buildCapabilitiesUrl(endpoint: URL, serviceType: OgcServiceType): URL {
  const url = new URL(endpoint.toString());
  url.searchParams.set("SERVICE", serviceType.toUpperCase());
  url.searchParams.set("REQUEST", "GetCapabilities");
  return url;
}

export function parseCapabilities(xml: string, serviceType: OgcServiceType) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Capabilities com DTD/entidade externa não é aceito");
  const expected = serviceType === "wms" ? /<(WMS_Capabilities|WMT_MS_Capabilities)\b/i : /<(WFS_Capabilities|wfs:WFS_Capabilities)\b/i;
  if (!expected.test(xml)) throw new Error("XML não corresponde ao serviço OGC solicitado");
  const matches = Array.from(serviceType === "wms"
    ? xml.matchAll(/<Name>\s*([^<\s]+)\s*<\/Name>/gi)
    : xml.matchAll(/<(?:\w+:)?Name>\s*([^<\s]+)\s*<\/(?:\w+:)?Name>/gi));
  const names = matches.map((match) => match[1]).filter((name) => !(serviceType === "wms" ? /^WMS$/i : /^WFS$/i).test(name));
  return { capabilitySha256: createHash("sha256").update(xml).digest("hex"), remoteLayers: Array.from(new Set(names)).slice(0, 500) };
}

export async function probeOgcCapabilities(
  endpoint: string,
  serviceType: OgcServiceType,
  policy: OgcEndpointPolicy,
  fetchImpl: typeof fetch = fetch,
): Promise<{ health: OgcHealth; latencyMs: number; httpStatus?: number; details?: string; capabilities?: ReturnType<typeof parseCapabilities> }> {
  const started = Date.now();
  let normalized: URL;
  try { normalized = normalizeOgcEndpoint(endpoint, policy); }
  catch (error) { return { health: "blocked", latencyMs: Date.now() - started, details: error instanceof Error ? error.message : "Endpoint bloqueado" }; }
  try {
    const response = await fetchImpl(buildCapabilitiesUrl(normalized, serviceType), { redirect: "error", signal: AbortSignal.timeout(12_000), headers: { Accept: "application/xml,text/xml" } });
    if (!response.ok) return { health: "http_error", latencyMs: Date.now() - started, httpStatus: response.status };
    const contentType = response.headers.get("content-type") || "";
    if (!/xml|text\//i.test(contentType)) return { health: "invalid_capabilities", latencyMs: Date.now() - started, httpStatus: response.status, details: "Content-Type não é XML" };
    const reader = response.body?.getReader();
    if (!reader) return { health: "invalid_capabilities", latencyMs: Date.now() - started, httpStatus: response.status, details: "Resposta sem corpo" };
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > MAX_CAPABILITIES_BYTES) { await reader.cancel(); return { health: "invalid_capabilities", latencyMs: Date.now() - started, httpStatus: response.status, details: "Capabilities excede limite" }; }
      chunks.push(value);
    }
    const xml = new TextDecoder().decode(Buffer.concat(chunks));
    return { health: "healthy", latencyMs: Date.now() - started, httpStatus: response.status, capabilities: parseCapabilities(xml, serviceType) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro OGC";
    const health: OgcHealth = /certificate|tls|ssl/i.test(message) ? "tls_error" : /timeout|aborted/i.test(message) ? "timeout" : "http_error";
    return { health, latencyMs: Date.now() - started, details: health === "tls_error" ? "Falha TLS; certificado não foi ignorado" : "Falha de conectividade OGC" };
  }
}

export function selectOgcVariant(variants: CatalogVariant[]) {
  const active = variants.filter((variant) => variant.enabled).sort((a, b) => a.priority - b.priority);
  const primary = active.find((variant) => variant.role === "primary");
  if (primary?.health === "healthy") return { selected: primary, primary, isFallback: false, reason: null };
  const fallback = active.find((variant) => variant.role === "fallback" && variant.health === "healthy");
  if (fallback) return { selected: fallback, primary: primary || null, isFallback: true, reason: primary ? `Fonte primária indisponível: ${primary.health}` : "Sem fonte primária ativa" };
  return { selected: null, primary: primary || null, isFallback: false, reason: primary ? `Fonte primária indisponível: ${primary.health}; sem fallback saudável` : "Nenhuma variante ativa" };
}
