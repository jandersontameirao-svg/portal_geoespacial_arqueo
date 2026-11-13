/**
 * Exportação vetorial via GDAL (ogr2ogr): GeoJSON → Shapefile (.zip) / KML / GPX.
 * Porte de previa-exportar-vetor.mts do Codex para o servidor Linux da VPS.
 *
 * O binário é `ogr2ogr` no PATH (pacote gdal-bin). Defina GDAL_OGR2OGR para
 * apontar um caminho específico. Sem GDAL, lança erro claro e o endpoint
 * responde que a conversão está indisponível (o GeoJSON continua disponível).
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const exec = promisify(execFile);
const ogr2ogr = process.env.GDAL_OGR2OGR?.trim() || "ogr2ogr";

const FORMATS = {
  // .shz = shapefile compactado (GDAL >= 3.1), entregue como .zip.
  shp: { driver: "ESRI Shapefile", ext: "shz", download: "zip", type: "application/zip" },
  kml: { driver: "KML", ext: "kml", download: "kml", type: "application/vnd.google-earth.kml+xml" },
  gpx: { driver: "GPX", ext: "gpx", download: "gpx", type: "application/gpx+xml" },
} as const;

export type VectorExportFormat = "geojson" | keyof typeof FORMATS;

export function isVectorExportFormat(value: string): value is VectorExportFormat {
  return value === "geojson" || Object.hasOwn(FORMATS, value);
}

type FeatureCollectionLike = { features: Array<{ geometry?: { type?: string } | null }> };

export class VectorExportError extends Error {}

function safeName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  return base.replace(/[^A-Za-z0-9_-]+/g, "_") || "camada";
}

export async function exportVector(sourceName: string, vector: FeatureCollectionLike, format: string) {
  if (!isVectorExportFormat(format)) throw new VectorExportError("Formato de exportação não suportado.");
  const name = safeName(sourceName);

  if (format === "geojson") {
    return { name: name + ".geojson", type: "application/geo+json", body: Buffer.from(JSON.stringify(vector)) };
  }

  const spec = FORMATS[format];
  if (format === "gpx" && !vector.features.every((feature) => /^(Multi)?(Point|LineString)$/.test(feature.geometry?.type ?? ""))) {
    throw new VectorExportError("GPX aceita apenas pontos e linhas. Converta a camada antes de exportar.");
  }

  const dir = await mkdtemp(join(tmpdir(), "geoportal-export-"));
  try {
    const input = join(dir, "entrada.geojson");
    const output = join(dir, name + "." + spec.ext);
    await writeFile(input, JSON.stringify(vector));
    const options = format === "gpx" ? ["-dsco", "GPX_USE_EXTENSIONS=YES"]
      : format === "shp" ? ["-lco", "ENCODING=UTF-8"] : [];
    try {
      await exec(ogr2ogr, ["-f", spec.driver, ...options, output, input], { timeout: 30_000, windowsHide: true });
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        throw new VectorExportError("GDAL (ogr2ogr) não está instalado no servidor. Instale gdal-bin para exportar neste formato.");
      }
      throw new VectorExportError("Não foi possível converter a camada para este formato.");
    }
    return { name: name + "." + spec.download, type: spec.type, body: await readFile(output) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
