import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const exec = promisify(execFile);
const qgis = "C:/Program Files/QGIS 3.44.12";
const formats = {
  shp: { driver: "ESRI Shapefile", ext: "shz", download: "zip", type: "application/zip" },
  kml: { driver: "KML", ext: "kml", download: "kml", type: "application/vnd.google-earth.kml+xml" },
  gpx: { driver: "GPX", ext: "gpx", download: "gpx", type: "application/gpx+xml" },
};

export async function exportVector(file: { name: string; vector: { features: { geometry: { type: string } }[] } }, format: string) {
  const name = basename(file.name, "." + file.name.split(".").at(-1)).replace(/[^\p{L}\p{N}_-]+/gu, "_") || "camada";
  if (format === "geojson") return { name: name + ".geojson", type: "application/geo+json", body: Buffer.from(JSON.stringify(file.vector)) };
  if (!Object.hasOwn(formats, format)) return;
  const spec = formats[format as keyof typeof formats];
  if (format === "gpx" && !file.vector.features.every(feature => /^(Multi)?(Point|LineString)$/.test(feature.geometry.type))) return;
  const dir = await mkdtemp(join(tmpdir(), "geoportal-export-"));
  try {
    const input = join(dir, "entrada.geojson");
    const output = join(dir, name + "." + spec.ext);
    await writeFile(input, JSON.stringify(file.vector));
    const options = format === "gpx" ? ["-dsco", "GPX_USE_EXTENSIONS=YES"] :
      format === "shp" ? ["-lco", "ENCODING=UTF-8"] : [];
    await exec(join(qgis, "bin", "ogr2ogr.exe"), ["-f", spec.driver, ...options, output, input], {
      env: { ...process.env, Path: qgis + "/bin;" + process.env.Path, PROJ_DATA: qgis + "/share/proj", GDAL_DATA: qgis + "/share/gdal" },
      timeout: 30_000, windowsHide: true,
    });
    return { name: name + "." + spec.download, type: spec.type, body: await readFile(output) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
