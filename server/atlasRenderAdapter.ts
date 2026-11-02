import { createHash } from "crypto";
import type { AtlasVectorOverlay } from "./atlasVectorOverlay";

export type AtlasRenderRequest = {
  atlasId: number;
  projectId: number;
  rasterLayerId: number;
  pages: Array<{ bounds: { north: number; south: number; east: number; west: number } }>;
  title: string;
  pageSize: "A4" | "A3" | "A1" | "A0";
  orientation: "portrait" | "landscape";
  scale: number;
  crs: string;
  showNorthArrow: boolean;
  showFrame: boolean;
  showLegend: boolean;
  showScaleBar: boolean;
  overlays: AtlasVectorOverlay[];
};

export type AtlasRenderResult = {
  outputKey: string;
  outputSha256: string;
  outputBytes: number;
  sourceCogSha256: string;
  pages: Array<{ page: number; bounds: unknown; png: string; sha256: string; bytes: number; overlayFeatures?: number }>;
  pdfBytes: Buffer;
};

export type AtlasRenderAvailability = { available: boolean; reason: string };

function workerUrl(environment = process.env): URL | null {
  const raw = environment.ARQUEO_CARTOGRAPHY_WORKER_URL;
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("ARQUEO_CARTOGRAPHY_WORKER_URL inválida"); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("URL do worker cartográfico inválida");
  return url;
}

export function atlasRenderAvailability(environment = process.env): AtlasRenderAvailability {
  const url = workerUrl(environment);
  return url ? { available: true, reason: "Worker cartográfico configurado no servidor." } : { available: false, reason: "Renderização do Atlas indisponível: configure ARQUEO_CARTOGRAPHY_WORKER_URL no servidor que compartilha o volume raster." };
}

export async function renderAtlasWithConfiguredAdapter(input: AtlasRenderRequest, environment = process.env): Promise<AtlasRenderResult> {
  const availability = atlasRenderAvailability(environment);
  if (!availability.available) throw new Error(availability.reason);
  const base = workerUrl(environment)!;
  const endpoint = new URL("render-atlas", base.href.endsWith("/") ? base.href : `${base.href}/`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15 * 60_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...(environment.ARQUEO_CARTOGRAPHY_WORKER_TOKEN ? { "x-arqueo-worker-token": environment.ARQUEO_CARTOGRAPHY_WORKER_TOKEN } : {}) },
      body: JSON.stringify(input), signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Worker cartográfico recusou a renderização (${response.status}): ${payload?.error || "erro desconhecido"}`);
    const bytes = Buffer.from(String(payload?.pdfBase64 || ""), "base64");
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (!bytes.length || !String(payload?.outputSha256 || "").match(/^[a-f0-9]{64}$/i) || hash !== payload.outputSha256 || !String(payload?.sourceCogSha256 || "").match(/^[a-f0-9]{64}$/i)) throw new Error("Worker cartográfico retornou PDF inválido ou checksum divergente");
    return { outputKey: String(payload.outputKey), outputSha256: hash, outputBytes: bytes.length, sourceCogSha256: String(payload.sourceCogSha256), pages: Array.isArray(payload.pages) ? payload.pages : [], pdfBytes: bytes };
  } catch (error) {
    throw new Error(error instanceof Error && error.name === "AbortError" ? "Tempo limite do worker cartográfico excedido" : error instanceof Error ? error.message : "Falha no worker cartográfico");
  } finally { clearTimeout(timeout); }
}
