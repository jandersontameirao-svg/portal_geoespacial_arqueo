export const TIFF_MIME_TYPES = ["image/tiff", "image/geotiff", "application/geotiff"] as const;
export type TiffMimeType = typeof TIFF_MIME_TYPES[number];
export type TiffUploadMode = "raster" | "original";

/** Infer extension only when the browser provided no MIME; never override a conflicting MIME. */
export function effectiveUploadMime(file: { name: string; type: string }): string {
  if (file.type) return file.type;
  if (/\.tiff?$/i.test(file.name)) return "image/tiff";
  if (/\.geojson$/i.test(file.name)) return "application/geo+json";
  if (/\.json$/i.test(file.name)) return "application/json";
  return "";
}

export function isTiffMime(mime: string): mime is TiffMimeType {
  return (TIFF_MIME_TYPES as readonly string[]).includes(mime);
}

/** Preserve the filename. A short basename uses the complete name, within the existing 2..255 contract. */
export function rasterNameFromFilename(filename: string): string {
  const basename = filename.replace(/\.(tif|tiff)$/i, "").trim();
  return (basename.length >= 2 ? basename : filename.trim().length >= 2 ? filename.trim() : "Raster").slice(0, 255);
}

/** Original-only TIFF keeps the baseline generic image contract; no claim of georeferencing/COG. */
export function resolveTiffUpload(file: { name: string; type: string }, mode: TiffUploadMode) {
  const mime = effectiveUploadMime(file);
  const isTiff = isTiffMime(mime);
  return {
    mime,
    isTiff,
    route: isTiff && mode === "raster" ? "raster" as const : "generic" as const,
    genericMime: isTiff && mode === "original" ? "image/tiff" : mime,
    rasterName: rasterNameFromFilename(file.name),
  };
}
