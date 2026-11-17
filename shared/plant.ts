/**
 * Estúdio de Plantas — modelo de desenho 2D (implantação / pranchas técnicas).
 * Porte de previa-plantas.mts da prévia do Codex. Compartilhado entre cliente
 * (editor/preview) e servidor (validação e georreferência para o mapa).
 */
export type Point = [number, number];
export type Entity = {
  kind: "line" | "rect" | "circle" | "text" | "dimension" | "block";
  a: Point;
  b: Point;
  layer: string;
  label: string;
};
export type PlantOrigin = { zone: number; south: boolean; east: number; north: number; rotation: number; unit: "m" | "cm" | "mm" };
export type Plant = {
  title: string;
  scale: number;
  paper: "A4" | "A3";
  portrait: boolean;
  author: string;
  origin?: PlantOrigin;
  entities: Entity[];
};

const kinds = ["line", "rect", "circle", "text", "dimension", "block"];

function label(value: unknown, length: number): string {
  if (typeof value !== "string" || value.length > length || /[\x00-\x1f]/.test(value)) throw Error("Confira os campos de texto.");
  return value.trim();
}
function point(value: unknown): Point {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => Number.isFinite(n) && Math.abs(n) <= 100000)) throw Error("Informe coordenadas locais válidas.");
  return [value[0], value[1]];
}

export function readPlant(value: Plant): Plant {
  if (!value || !Array.isArray(value.entities) || value.entities.length > 400) throw Error("Use até 400 elementos por planta.");
  const title = label(value.title, 100);
  if (!title || !Number.isInteger(value.scale) || value.scale < 1 || value.scale > 100000 || !["A3", "A4"].includes(value.paper)) throw Error("Confira título, papel e escala.");
  const o = value.origin;
  if (o && (!Number.isInteger(o.zone) || o.zone < 1 || o.zone > 60 || typeof o.south !== "boolean" ||
    !Number.isFinite(o.east) || o.east < 100000 || o.east > 900000 || !Number.isFinite(o.north) || o.north < 0 || o.north > 10000000 ||
    !Number.isFinite(o.rotation) || Math.abs(o.rotation) > 360 || !["m", "cm", "mm"].includes(o.unit))) throw Error("Confira a implantação SIRGAS 2000 / UTM.");
  return {
    title, scale: value.scale, paper: value.paper, portrait: value.portrait === true, author: label(value.author, 80),
    origin: o && { zone: o.zone, south: o.south, east: o.east, north: o.north, rotation: o.rotation, unit: o.unit },
    entities: value.entities.map((item) => {
      if (!item || !kinds.includes(item.kind)) throw Error("Tipo de elemento indisponível.");
      const a = point(item.a), b = point(item.b);
      if (["rect", "block"].includes(item.kind) && (a[0] === b[0] || a[1] === b[1])) throw Error("O retângulo precisa de largura e altura.");
      if (item.kind !== "text" && a[0] === b[0] && a[1] === b[1]) throw Error("Os dois pontos precisam ser diferentes.");
      return { kind: item.kind, a, b, layer: label(item.layer, 40) || "Geral", label: label(item.label, 100) };
    }),
  };
}

export const metresPerUnit = (unit?: string) => (unit === "mm" ? 0.001 : unit === "cm" ? 0.01 : 1);

export function samplePlant(title: string): Plant {
  return {
    title, scale: 100, paper: "A3", portrait: false, author: "Ensaio fictício",
    entities: [
      { kind: "rect", a: [0, 0], b: [12, 8], layer: "Implantação", label: "Lote fictício" },
      { kind: "rect", a: [2, 2], b: [9, 6], layer: "Edificação", label: "Edificação fictícia" },
      { kind: "text", a: [3, 4], b: [3, 4], layer: "Anotações", label: "Planta de ensaio" },
      { kind: "dimension", a: [0, -1], b: [12, -1], layer: "Cotas", label: "" },
    ],
  };
}

/** Converte os elementos desenháveis da planta em GeoJSON, projetando cada ponto. */
export function plantGeoJson(plant: Plant, project: (point: Point) => Point) {
  return {
    type: "FeatureCollection" as const,
    features: plant.entities.flatMap((entity, index) => {
      const { kind, a, b } = entity;
      if (kind === "dimension" || kind === "text") return [];
      let geometry: unknown;
      if (kind === "line") geometry = { type: "LineString", coordinates: [a, b].map(project) };
      else {
        const radius = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const ring: Point[] = kind === "circle"
          ? Array.from({ length: 48 }, (_, i) => {
              const theta = i * Math.PI / 24;
              return [a[0] + radius * Math.cos(theta), a[1] + radius * Math.sin(theta)] as Point;
            })
          : [a, [b[0], a[1]], b, [a[0], b[1]]];
        geometry = { type: "Polygon", coordinates: [[...ring, ring[0]].map(project)] };
      }
      return [{ type: "Feature" as const, id: index + 1, geometry, properties: { nome: entity.label || entity.layer, camada: entity.layer, tipo: kind } }];
    }),
  };
}
