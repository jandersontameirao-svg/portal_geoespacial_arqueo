/**
 * Leitor local das malhas oficiais do IBGE (estados, municípios, localidades)
 * em GeoJSON. Porte de previa-ibge-dados.mts da prévia do Codex.
 *
 * Os arquivos NÃO ficam no repositório (são grandes e de licença própria do
 * IBGE). Coloque-os no diretório apontado por ARQUEO_IBGE_DATA_DIR (padrão:
 * <cwd>/data/ibge), com os nomes:
 *   - estados.geojson        (malha de UFs 2024; usa NM_UF / SIGLA_UF)
 *   - municipios-BR.geojson  (malha municipal 2024; usa NM_MUN / CD_MUN)
 *   - localidades.geojson    (localidades 2022; usa NM_LOCALIDADE)
 * Rótulos opcionais: ROT_LON / ROT_LAT por feição. Sem os arquivos, as camadas
 * respondem vazio e a UI mostra "Base indisponível".
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type Bounds = [number, number, number, number];
type IndexedFeature = { feature: any; bounds: Bounds };

const FILES: Record<string, string> = {
  estados: "estados.geojson",
  municipios: "municipios-BR.geojson",
  localidades: "localidades.geojson",
};

const cache = new Map<string, IndexedFeature[]>();

function dataDir(): string {
  const configured = process.env.ARQUEO_IBGE_DATA_DIR?.trim();
  return configured && configured.length > 0 ? configured : path.resolve(process.cwd(), "data/ibge");
}

export function isIbgeLayerId(id: string): boolean {
  return Object.hasOwn(FILES, id);
}

/** Diz se há ao menos um arquivo de malha disponível no servidor. */
export function ibgeDataAvailability(): { available: boolean; dir: string; layers: string[] } {
  const dir = dataDir();
  const layers = Object.entries(FILES).filter(([, file]) => existsSync(path.join(dir, file))).map(([id]) => id);
  return { available: layers.length > 0, dir, layers };
}

function loadLayer(id: string): IndexedFeature[] {
  if (cache.has(id)) return cache.get(id)!;
  const file = FILES[id];
  const full = path.join(dataDir(), file);
  if (!existsSync(full)) {
    cache.set(id, []);
    return [];
  }
  let parsed: any;
  try {
    parsed = JSON.parse(readFileSync(full, "utf8"));
  } catch {
    cache.set(id, []);
    return [];
  }
  const features: IndexedFeature[] = (parsed.features ?? []).map((feature: any) => {
    const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
    const extend = (coords: any[]) => {
      if (typeof coords[0] === "number") {
        bounds[0] = Math.min(bounds[0], coords[0]); bounds[2] = Math.max(bounds[2], coords[0]);
        bounds[1] = Math.min(bounds[1], coords[1]); bounds[3] = Math.max(bounds[3], coords[1]);
      } else coords.forEach(extend);
    };
    extend(feature.geometry.coordinates);
    const p = feature.properties ?? {};
    const properties = {
      nome: p.NM_LOCALIDADE ?? p.NM_MUN ?? p.NM_UF ?? p.SIGLA_UF,
      uf: p.SIGLA_UF,
      codigo: p.CD_LOCALIDADE ?? p.CD_MUN ?? p.CD_UF ?? p.SIGLA_UF,
      rotulo: p.ROT_LON == null ? undefined : [p.ROT_LON, p.ROT_LAT],
    };
    return { feature: { ...feature, properties }, bounds };
  });
  cache.set(id, features);
  return features;
}

/** Feições de uma malha dentro da vista (bbox) e, opcional, de uma área do projeto. */
export function readIbgeLayer(id: string, bbox: string, projectBox: string | null = null) {
  if (!isIbgeLayerId(id)) return undefined;
  const view = bbox.split(",").map(Number) as Bounds;
  if (view.length !== 4 || !view.every(Number.isFinite) || view[1] > view[3]) return undefined;
  const region = projectBox?.split(",").map(Number);
  if (region && (region.length !== 4 || !region.every(Number.isFinite))) return undefined;
  const [west, south, east, north] = view;
  const features = loadLayer(id).filter(({ bounds: [a, b, c, d] }) => {
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
