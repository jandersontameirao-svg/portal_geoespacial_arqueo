import { RasterAssetError, getLocalRasterRoot, ingestLocalGeoTiff, type RasterIngestionResult } from "./localRasterService";

export type RasterIngestionInput = {
  projectId: number;
  layerId: number;
  bytes: Buffer;
  acquisitionAt: string;
  sourceLabel: string;
  minZoom: number;
  maxZoom: number;
  nodata: number;
  resampling: "nearest" | "bilinear" | "cubic" | "lanczos";
};

export type RasterIngestionAvailability = {
  available: boolean;
  mode: "worker" | "direct-local" | "unconfigured";
  reason: string;
};

function configuredWorkerUrl(environment = process.env): URL | null {
  const raw = environment.ARQUEO_RASTER_WORKER_URL;
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { throw new RasterAssetError("ARQUEO_RASTER_WORKER_URL inválida"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new RasterAssetError("Worker raster deve usar HTTP(S)");
  if (url.username || url.password || url.search || url.hash) throw new RasterAssetError("URL do worker raster não pode conter credenciais, query ou fragmento");
  return url;
}

export function rasterIngestionAvailability(environment = process.env): RasterIngestionAvailability {
  const worker = configuredWorkerUrl(environment);
  if (worker) return { available: true, mode: "worker", reason: "Worker raster configurado por variável de ambiente do servidor." };
  if (environment.ARQUEO_RASTER_INGESTION_MODE === "direct-local") {
    try { getLocalRasterRoot(environment.ARQUEO_LOCAL_RASTER_ROOT); return { available: true, mode: "direct-local", reason: "Processamento raster local explicitamente habilitado no servidor." }; }
    catch (error) { return { available: false, mode: "unconfigured", reason: error instanceof Error ? error.message : "Volume raster local inválido" }; }
  }
  return { available: false, mode: "unconfigured", reason: "Ingestão raster indisponível: configure ARQUEO_RASTER_WORKER_URL ou habilite ARQUEO_RASTER_INGESTION_MODE=direct-local com ARQUEO_LOCAL_RASTER_ROOT absoluto." };
}

function jsonToResult(value: unknown): RasterIngestionResult {
  const result = value as RasterIngestionResult;
  if (!result || result.crs !== "EPSG:4674" || !result.descriptor || !result.bounds || typeof result.cogSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(result.cogSha256)) {
    throw new RasterAssetError("Worker raster retornou resultado inválido");
  }
  return result;
}

export async function ingestRasterWithConfiguredAdapter(input: RasterIngestionInput, environment = process.env): Promise<RasterIngestionResult> {
  const availability = rasterIngestionAvailability(environment);
  if (!availability.available) throw new RasterAssetError(availability.reason);
  if (availability.mode === "direct-local") {
    return ingestLocalGeoTiff({ ...input, root: getLocalRasterRoot(environment.ARQUEO_LOCAL_RASTER_ROOT) });
  }
  const base = configuredWorkerUrl(environment)!;
  const endpoint = new URL("ingest", base.href.endsWith("/") ? base.href : `${base.href}/`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15 * 60_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...(environment.ARQUEO_RASTER_WORKER_TOKEN ? { "x-arqueo-worker-token": environment.ARQUEO_RASTER_WORKER_TOKEN } : {}) },
      signal: controller.signal,
      body: JSON.stringify({ ...input, bytesBase64: input.bytes.toString("base64"), bytes: undefined }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new RasterAssetError(`Worker raster recusou a ingestão (${response.status}): ${payload?.error || "erro desconhecido"}`);
    return jsonToResult(payload);
  } catch (error) {
    if (error instanceof RasterAssetError) throw error;
    throw new RasterAssetError(error instanceof Error && error.name === "AbortError" ? "Tempo limite do worker raster excedido" : `Falha ao chamar worker raster: ${error instanceof Error ? error.message : "erro desconhecido"}`);
  } finally { clearTimeout(timeout); }
}
