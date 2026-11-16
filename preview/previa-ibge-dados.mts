import { readFileSync } from "node:fs";

type Box = [number, number, number, number];
const files = {
  estados: ["estados"],
  municipios: ["municipios-BR"],
  localidades: ["localidades"],
};
const cache = new Map<string, { feature: any; bounds: Box }[]>();

function loadLayer(id: keyof typeof files) {
  if (!cache.has(id)) {
    cache.set(id, files[id as keyof typeof files].flatMap(name => {
      const data = JSON.parse(readFileSync(new URL("./previa-raster/angicos/" + name + ".geojson", import.meta.url), "utf8"));
      return data.features.map((feature: any) => {
        const bounds: Box = [Infinity, Infinity, -Infinity, -Infinity];
        function extend(coords: any[]) {
          if (typeof coords[0] === "number") {
            bounds[0] = Math.min(bounds[0], coords[0]); bounds[2] = Math.max(bounds[2], coords[0]);
            bounds[1] = Math.min(bounds[1], coords[1]); bounds[3] = Math.max(bounds[3], coords[1]);
          } else coords.forEach(extend);
        }
        extend(feature.geometry.coordinates);
        const p = feature.properties;
        const properties = {
          nome: p.NM_LOCALIDADE ?? p.NM_MUN ?? p.NM_UF ?? p.SIGLA_UF,
          uf: p.SIGLA_UF,
          codigo: p.CD_LOCALIDADE ?? p.CD_MUN ?? p.CD_UF ?? p.SIGLA_UF,
          rotulo: p.ROT_LON == null ? undefined : [p.ROT_LON, p.ROT_LAT],
        };
        return { feature: { ...feature, properties }, bounds };
      });
    }));
  }
  return cache.get(id)!;
}

let palmaresCodes: Set<string> | undefined;

export function readIbgeLayer(id: string, bbox: string, projectBox: string | null = null) {
  const palmares = id === "palmares";
  if (!palmares && !Object.hasOwn(files, id)) return;
  const view = bbox.split(",").map(Number) as Box;
  if (view.length !== 4 || !view.every(Number.isFinite) || view[1] > view[3]) return;
  const region = projectBox?.split(",").map(Number);
  if (region && (region.length !== 4 || !region.every(Number.isFinite))) return;
  const [west, south, east, north] = view;
  if (palmares) {
    palmaresCodes ??= new Set(JSON.parse(readFileSync(
      new URL("./previa-raster/angicos/palmares-municipios.json", import.meta.url), "utf8"
    )).municipalityCodes);
  }
  const base = palmares ? "municipios" : id as keyof typeof files;
  const features = loadLayer(base).filter(({ feature, bounds: [a,b,c,d] }) => {
    if (palmares && !palmaresCodes!.has(String(feature.properties.codigo))) return false;
    if (region && (c < region[0] || a > region[2] || d < region[1] || b > region[3])) return false;
    if (b > north || d < south) return false;
    if (east - west >= 360) return true;
    const left = ((west + 180) % 360 + 360) % 360 - 180;
    const right = left + (east - west);
    return (a <= right && c >= left) || (right > 180 && a <= right - 360);
  }).map(({ feature }) => feature);
  if (id === "municipios" && features.length > 450) {
    return { type: "FeatureCollection", features: [], zoomRequired: true };
  }
  return { type: "FeatureCollection", features };
}

export function* ibgeSearchEntries() {
  const categories = { municipios: "Município", estados: "Estado", localidades: "Localidade" } as const;
  for (const id of Object.keys(categories) as (keyof typeof categories)[]) {
    for (const { feature, bounds: [west, south, east, north] } of loadLayer(id)) {
      const { nome, uf, rotulo, codigo } = feature.properties;
      if (!nome) continue;
      const [lng, lat] = rotulo ?? [(west + east) / 2, (south + north) / 2];
      yield { key: id + codigo, title: nome, uf, detail: [uf, "IBGE"].filter(Boolean).join(" · "),
        category: categories[id], lat, lng, zoom: id === "estados" ? 7 : id === "municipios" ? 11 : 14 };
    }
  }
}
