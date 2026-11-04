// MIME correto por extensão para downloads de exportação geoespacial.
// O nome do arquivo é definido pelo servidor; aqui só escolhemos o tipo do Blob
// para que o sistema operacional e outros programas reconheçam o formato.
const EXPORT_MIME: Record<string, string> = {
  geojson: "application/geo+json",
  json: "application/geo+json",
  kml: "application/vnd.google-earth.kml+xml",
  kmz: "application/vnd.google-earth.kmz",
  gpx: "application/gpx+xml",
};

export function mimeForFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return EXPORT_MIME[ext] || "application/octet-stream";
}
