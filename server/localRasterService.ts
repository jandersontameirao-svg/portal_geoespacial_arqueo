import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export type RasterBounds = { north: number; south: number; east: number; west: number };
export type RasterLayerRecord = { id: number; projectId: number; layerType: string; crs: string; bounds: RasterBounds | null; layerData: unknown; metadata: unknown; isVisible: boolean };
export type LocalRasterDescriptor = { cogKey: string; tilesKey: string; minZoom: number; maxZoom: number; expectedCrs: "EPSG:4674"; nodata: number };
export type RasterIngestionResult = {
  descriptor: LocalRasterDescriptor;
  sourceKey: string;
  cogKey: string;
  stacKey: string;
  manifestKey: string;
  bounds: RasterBounds;
  crs: "EPSG:4674";
  sourceSha256: string;
  cogSha256: string;
  sourceBytes: number;
  cogBytes: number;
  processing: Record<string, unknown>;
};

const MAX_EXPORT_PIXELS = 33_554_432;
const MAX_STDOUT = 1024 * 1024;

export class RasterAssetError extends Error {}

export function getLocalRasterRoot(value = process.env.ARQUEO_LOCAL_RASTER_ROOT): string {
  if (!value || !path.isAbsolute(value)) throw new RasterAssetError("Raster local não configurado: ARQUEO_LOCAL_RASTER_ROOT precisa ser um path absoluto");
  return path.resolve(value);
}

export function validateRelativeRasterKey(value: string): string {
  const normalized = path.posix.normalize(value);
  if (!value || value.length > 1024 || value.includes("\\") || value.includes(":") || path.posix.isAbsolute(normalized) || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new RasterAssetError("Chave local de raster inválida");
  }
  return normalized;
}

export function resolveLocalRasterPath(root: string, key: string): string {
  const relative = validateRelativeRasterKey(key);
  const target = path.resolve(root, ...relative.split("/"));
  if (!target.startsWith(`${root}${path.sep}`)) throw new RasterAssetError("Raster resolve fora da raiz local");
  return target;
}

export function descriptorFromLayer(layer: RasterLayerRecord): LocalRasterDescriptor {
  if (layer.layerType !== "raster") throw new RasterAssetError("Camada não é raster");
  const metadata = (layer.metadata || {}) as Record<string, unknown>;
  const local = metadata.localRaster as Record<string, unknown> | undefined;
  if (!local) throw new RasterAssetError("Camada raster não possui descriptor local aprovado");
  const cogKey = typeof local.cogKey === "string" ? validateRelativeRasterKey(local.cogKey) : "";
  const tilesKey = typeof local.tilesKey === "string" ? validateRelativeRasterKey(local.tilesKey) : "";
  const minZoom = Number(local.minZoom);
  const maxZoom = Number(local.maxZoom);
  const expectedCrs = local.expectedCrs === "EPSG:4674" ? local.expectedCrs : null;
  const nodata = Number(local.nodata);
  if (!cogKey || !tilesKey || !Number.isInteger(minZoom) || !Number.isInteger(maxZoom) || minZoom < 0 || maxZoom > 22 || minZoom > maxZoom || !expectedCrs || !Number.isFinite(nodata)) {
    throw new RasterAssetError("Descriptor raster local incompleto ou inválido");
  }
  return { cogKey, tilesKey, minZoom, maxZoom, expectedCrs, nodata };
}

export function validateTileCoordinates(z: number, x: number, y: number, descriptor: LocalRasterDescriptor): void {
  if (![z, x, y].every(Number.isInteger) || z < descriptor.minZoom || z > descriptor.maxZoom || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
    throw new RasterAssetError("Coordenadas XYZ fora do intervalo autorizado");
  }
}

export function tilePath(root: string, descriptor: LocalRasterDescriptor, z: number, x: number, y: number): string {
  validateTileCoordinates(z, x, y, descriptor);
  return resolveLocalRasterPath(root, `${descriptor.tilesKey}/${z}/${x}/${y}.png`);
}

function runPython(script: string, args: string[]): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/python3", [script, ...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONNOUSERSITE: "1", PYTHONPATH: "/usr/lib/python3/dist-packages" } });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; if (stdout.length > MAX_STDOUT) child.kill("SIGKILL"); });
    child.stderr.on("data", (chunk) => { stderr += chunk; if (stderr.length > MAX_STDOUT) child.kill("SIGKILL"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new RasterAssetError(`Processamento raster falhou (${code}): ${stderr.slice(-1000)}`));
      try { resolve(JSON.parse(stdout.trim().split("\n").filter(Boolean).at(-1) || "{}")); }
      catch { reject(new RasterAssetError("Processamento raster não retornou JSON válido")); }
    });
  });
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function assertTiffSignature(bytes: Buffer): void {
  const littleEndian = bytes.length >= 4 && bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00;
  const bigEndian = bytes.length >= 4 && bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a;
  if (!littleEndian && !bigEndian) throw new RasterAssetError("Arquivo de origem não possui assinatura TIFF válida");
}

async function atomicWrite(filename: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
    await rename(temporary, filename);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

/**
 * Ingestão local sem URL de origem e sem shell. Apenas um adapter/worker
 * configurado deve chamá-la; o navegador nunca informa paths de filesystem.
 */
export async function ingestLocalGeoTiff(input: {
  root: string;
  projectId: number;
  layerId: number;
  bytes: Buffer;
  acquisitionAt: string;
  sourceLabel: string;
  minZoom: number;
  maxZoom: number;
  nodata?: number;
  resampling?: "nearest" | "bilinear" | "cubic" | "lanczos";
}): Promise<RasterIngestionResult> {
  if (!Number.isInteger(input.projectId) || !Number.isInteger(input.layerId) || input.projectId <= 0 || input.layerId <= 0) throw new RasterAssetError("Projeto/camada inválidos para ingestão raster");
  if (!Number.isInteger(input.minZoom) || !Number.isInteger(input.maxZoom) || input.minZoom < 0 || input.maxZoom > 22 || input.minZoom > input.maxZoom) throw new RasterAssetError("Intervalo de zoom inválido para ingestão raster");
  if (!input.acquisitionAt.endsWith("Z") || Number.isNaN(Date.parse(input.acquisitionAt))) throw new RasterAssetError("Data de aquisição deve ser ISO-8601 UTC terminada em Z");
  if (!input.sourceLabel.trim() || input.sourceLabel.length > 500) throw new RasterAssetError("Fonte raster inválida");
  if (!input.bytes.length || input.bytes.length > 100 * 1024 * 1024) throw new RasterAssetError("Tamanho raster fora do limite de 100 MB");
  assertTiffSignature(input.bytes);

  const sourceKey = `projects/${input.projectId}/rasters/${input.layerId}/source/original.tif`;
  const cogKey = `projects/${input.projectId}/rasters/${input.layerId}/source.cog.tif`;
  const stacKey = `projects/${input.projectId}/rasters/${input.layerId}/source.stac-item.json`;
  const sourcePath = resolveLocalRasterPath(input.root, sourceKey);
  const cogPath = resolveLocalRasterPath(input.root, cogKey);
  const stacPath = resolveLocalRasterPath(input.root, stacKey);
  await atomicWrite(sourcePath, input.bytes);

  const processor = path.resolve(process.cwd(), "infra/raster/process_to_cog.py");
  const nodata = input.nodata ?? 0;
  const processing = await runPython(processor, [
    "--input", sourcePath, "--output", cogPath,
    "--asset-id", `project-${input.projectId}-layer-${input.layerId}`,
    "--datetime", input.acquisitionAt, "--source", input.sourceLabel,
    "--target-crs", "EPSG:4674", "--nodata", String(nodata),
    "--resampling", input.resampling || "cubic", "--manifest", stacPath,
  ]);
  const stac = JSON.parse(await readFile(stacPath, "utf8")) as { bbox?: unknown; properties?: Record<string, unknown> };
  const bbox = stac.bbox;
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((value) => typeof value === "number" && Number.isFinite(value))) throw new RasterAssetError("COG gerado sem bounds válidos no manifesto");
  const [west, south, east, north] = bbox as number[];
  const bounds = { north, south, east, west };
  validateExportRequest(bounds, 256, 256);
  const prepared = await prepareLocalRasterAssets({ root: input.root, projectId: input.projectId, layerId: input.layerId, cogKey, minZoom: input.minZoom, maxZoom: input.maxZoom, expectedCrs: "EPSG:4674", nodata });
  const sourceBytes = await readFile(sourcePath);
  const cogBytes = await readFile(cogPath);
  return {
    descriptor: prepared.descriptor, sourceKey, cogKey, stacKey, manifestKey: prepared.manifestKey, bounds, crs: "EPSG:4674",
    sourceSha256: sha256(sourceBytes), cogSha256: sha256(cogBytes), sourceBytes: sourceBytes.byteLength, cogBytes: cogBytes.byteLength,
    processing: { ...processing, tileReport: prepared.report, stacProperties: stac.properties || {} },
  };
}

export async function prepareLocalRasterAssets(input: { root: string; projectId: number; layerId: number; cogKey: string; minZoom: number; maxZoom: number; expectedCrs?: "EPSG:4674"; nodata?: number }) {
  if (!Number.isInteger(input.projectId) || !Number.isInteger(input.layerId) || input.projectId <= 0 || input.layerId <= 0) throw new RasterAssetError("Projeto/camada inválidos");
  const cogKey = validateRelativeRasterKey(input.cogKey);
  const tilesKey = `projects/${input.projectId}/rasters/${input.layerId}/tiles`;
  const source = resolveLocalRasterPath(input.root, cogKey);
  await access(source);
  const manifestKey = `projects/${input.projectId}/rasters/${input.layerId}/tile-manifest.json`;
  const script = path.resolve(process.cwd(), "infra/raster/build_local_raster_assets.py");
  const report = await runPython(script, ["--input", source, "--tiles", resolveLocalRasterPath(input.root, tilesKey), "--min-zoom", String(input.minZoom), "--max-zoom", String(input.maxZoom), "--expected-crs", input.expectedCrs || "EPSG:4674", "--require-nodata", "--manifest", resolveLocalRasterPath(input.root, manifestKey)]);
  return { descriptor: { cogKey, tilesKey, minZoom: input.minZoom, maxZoom: input.maxZoom, expectedCrs: input.expectedCrs || "EPSG:4674", nodata: input.nodata ?? 0 } as LocalRasterDescriptor, manifestKey, report };
}

export function validateExportRequest(bounds: RasterBounds, width: number, height: number): void {
  if (!Number.isFinite(bounds.west) || !Number.isFinite(bounds.east) || !Number.isFinite(bounds.south) || !Number.isFinite(bounds.north) || !(bounds.west < bounds.east && bounds.south < bounds.north)) throw new RasterAssetError("Bounds de exportação inválidos");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 256 || height < 256 || width > 8192 || height > 8192 || width * height > MAX_EXPORT_PIXELS) throw new RasterAssetError("Dimensões de exportação fora do limite");
}

export async function createLocalRasterExport(input: { root: string; layer: RasterLayerRecord; bounds: RasterBounds; width: number; height: number }) {
  const descriptor = descriptorFromLayer(input.layer);
  validateExportRequest(input.bounds, input.width, input.height);
  const source = resolveLocalRasterPath(input.root, descriptor.cogKey);
  await access(source);
  const exportId = randomUUID();
  const exportKey = `projects/${input.layer.projectId}/rasters/${input.layer.id}/exports/${exportId}`;
  const outputDir = resolveLocalRasterPath(input.root, exportKey);
  const script = path.resolve(process.cwd(), "infra/raster/export_raster_map.py");
  const report = await runPython(script, ["--input", source, "--output-dir", outputDir, "--west", String(input.bounds.west), "--south", String(input.bounds.south), "--east", String(input.bounds.east), "--north", String(input.bounds.north), "--width", String(input.width), "--height", String(input.height), "--expected-crs", descriptor.expectedCrs, "--require-nodata"]);
  return { exportId, exportKey, report };
}

export async function exportFilePath(root: string, layer: RasterLayerRecord, exportId: string, kind: "png" | "worldfile" | "prj" | "pdf"): Promise<{ path: string; contentType: string; filename: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(exportId)) throw new RasterAssetError("ID de exportação inválido");
  const descriptor = descriptorFromLayer(layer);
  void descriptor;
  const exportKey = `projects/${layer.projectId}/rasters/${layer.id}/exports/${exportId}`;
  const names: Record<typeof kind, string> = { png: "map.png", worldfile: "map.wld", prj: "map.prj", pdf: "map.pdf" };
  const key = `${exportKey}/${names[kind]}`;
  const filename = resolveLocalRasterPath(root, key);
  try { const info = await stat(filename); if (!info.isFile()) throw new Error(); }
  catch { throw new RasterAssetError("Arquivo de exportação não encontrado"); }
  return { path: filename, filename: names[kind], contentType: kind === "png" ? "image/png" : kind === "pdf" ? "application/pdf" : "text/plain; charset=utf-8" };
}

export async function readLocalRasterManifest(root: string, key: string): Promise<Record<string, unknown>> {
  const content = await readFile(resolveLocalRasterPath(root, key), "utf8");
  return JSON.parse(content) as Record<string, unknown>;
}
