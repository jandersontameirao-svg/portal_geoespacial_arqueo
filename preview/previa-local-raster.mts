import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("./previa-raster", import.meta.url));
const scripts = fileURLToPath(new URL("../infra/raster", import.meta.url));
const qgis = "C:/Program Files/QGIS 3.44.12";
const environment = { ...process.env, Path: qgis + "/bin;" + process.env.Path,
  PYTHONHOME: qgis + "/apps/Python312", PROJ_DATA: qgis + "/share/proj",
  GDAL_DATA: qgis + "/share/gdal", PYTHONUTF8: "1" };
type Bounds = { west: number; south: number; east: number; north: number };

async function command(program: string, args: string[]) {
  return (await exec(join(qgis, "bin", program), args, { env: environment, timeout: 120_000, windowsHide: true })).stdout;
}

async function python(script: string, args: string[]) {
  return command("python.exe", [join(scripts, script), ...args]);
}

export async function ingestCog(bytes: Buffer, acquisition: string, source: string) {
  const key = randomUUID();
  const folder = join(root, key);
  await mkdir(folder, { recursive: true });
  const raw = join(folder, "original.tif");
  const cog = join(folder, "raster.cog.tif");
  const manifest = join(folder, "stac.json");
  await writeFile(raw, bytes);
  await python("process_to_cog.py", ["--input", raw, "--output", cog, "--manifest", manifest,
    "--asset-id", key, "--datetime", acquisition, "--source", source]);
  const info = JSON.parse(await command("gdalinfo.exe", ["-json", cog]));
  if (info.metadata.IMAGE_STRUCTURE.LAYOUT !== "COG" || !info.bands[0].overviews?.length) throw Error("GDAL não confirmou COG com pirâmides.");
  const stac = JSON.parse(await readFile(manifest, "utf8"));
  if (stac.properties["proj:epsg"] !== 4674 || info.bands[0].noDataValue !== 0) throw Error("CRS ou NoData inesperado.");
  const [west, south, east, north] = stac.bbox;
  await writeFile(join(folder, "gdalinfo.json"), JSON.stringify(info, null, 2));
  return { key, bounds: { west, south, east, north }, sha256: stac.assets.cog["file:checksum"] };
}

const paper: Record<string, number[]> = { A4: [210, 297], A3: [297, 420], A1: [594, 841], A0: [841, 1189] };

export async function renderCog(layer: { key: string; bounds: Bounds }, job: Record<string, any>, atlas: boolean) {
  const size = paper[job.pageSize];
  if (!size || !["portrait", "landscape"].includes(job.orientation) || !Number.isFinite(job.scale) || job.scale <= 0) throw Error("Formato, orientação ou escala inválidos.");
  const [width, height] = job.orientation === "landscape" ? [...size].reverse() : size;
  const frameW = width - 28;
  const frameH = height - 66;
  const bounds = layer.bounds;
  const centreX = (bounds.west + bounds.east) / 2;
  const centreY = (bounds.south + bounds.north) / 2;
  const rows = atlas ? 2 : 1;
  const pages = [];
  const evidence = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < rows; col++) {
      const phi = centreY * Math.PI / 180;
      const e2 = 0.0066943800229;
      const radius = 6378137;
      const d = Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
      const latMetres = Math.PI / 180 * radius * (1 - e2) / d ** 3;
      const latSpan = frameH * job.scale / 1000 / latMetres;
      const lat = centreY + (row - (rows - 1) / 2) * latSpan * 0.9;
      const angle = lat * Math.PI / 180;
      const lonMetres = Math.PI / 180 * radius * Math.cos(angle) / Math.sqrt(1 - e2 * Math.sin(angle) ** 2);
      const lonSpan = frameW * job.scale / 1000 / lonMetres;
      const lon = centreX + (col - (rows - 1) / 2) * lonSpan * 0.9;
      const page = { west: lon - lonSpan / 2, south: lat - latSpan / 2, east: lon + lonSpan / 2, north: lat + latSpan / 2 };
      if (page.west < bounds.west || page.east > bounds.east || page.south < bounds.south || page.north > bounds.north) {
        throw Error("A área da folha excede o COG. Use uma escala com denominador menor ou reduza o papel.");
      }
      pages.push({ bounds: page });
      evidence.push({ bounds: page, frameMm: [frameW, frameH], nominalScale: job.scale });
    }
  }
  const key = randomUUID();
  const folder = join(root, key);
  await mkdir(folder, { recursive: true });
  const pagesPath = join(folder, "pages.json");
  const overlayPath = join(folder, "overlays.json");
  await writeFile(pagesPath, JSON.stringify(pages));
  await writeFile(overlayPath, "[]");
  const output = join(folder, "cartografia.pdf");
  const ratio = frameW / frameH;
  const rasterWidth = Math.max(512, Math.round(1024 * ratio));
  const rasterHeight = Math.max(512, Math.round(rasterWidth / ratio));
  const result = JSON.parse(await python("render_atlas_pages.py", ["--input", join(root, layer.key, "raster.cog.tif"),
    "--output", output, "--pages-json", pagesPath, "--overlays-json", overlayPath, "--page-size", job.pageSize,
    "--orientation", job.orientation, "--title", job.title, "--scale", String(job.scale),
    "--raster-width", String(rasterWidth), "--raster-height", String(rasterHeight)]));
  await writeFile(join(folder, "render.json"), JSON.stringify({ ...result, scaleCheck: evidence }, null, 2));
  return { outputUrl: "/previa/raster/" + key + "/cartografia.pdf", totalPages: pages.length, sha256: result.pdf.sha256 };
}

export async function rasterArtifact(path: string) {
  const model = /^\/modelos-a2\/(localizacao-raipa-11\.pdf|detalhe-canteiro-chinelo-raipa-12\.pdf|projeto-(?:localizacao|detalhe)-a2\.pdf|conferencia-escala\.json)$/.exec(path);
  if (model) {
    const name = model[1];
    const body = await readFile(join(root, "modelos-a2", name));
    return { body, name, type: name.endsWith(".pdf") ? "application/pdf" : "application/json" };
  }
  const match = /^\/([a-f0-9-]{36}|amostras)\/(before_raw_epsg4326\.tif|raster\.cog\.tif|cartografia\.pdf|gdalinfo\.json|stac\.json|render\.json)$/.exec(path);
  if (!match) return;
  const name = match[2];
  try {
    const body = await readFile(resolve(root, match[1], name));
    return { body, name, type: name.endsWith(".pdf") ? "application/pdf" : name.endsWith(".json") ? "application/json" : "image/tiff" };
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
  }
}
