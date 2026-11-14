// Approximate 1:4,500 from the approved Leaflet view (zoom 17 at the LT).
export const linearAtlasScale = 4500;

export const defaultLayout = {
  legenda: { x: 478, y: 202, w: 104, h: 65 },
  norte: { x: 33, y: 36, w: 14, h: 20 },
  brasil: { x: 479, y: 30, w: 100, h: 79 },
  regional: { x: 479, y: 112, w: 100, h: 79 },
};
export type Layout = typeof defaultLayout;
export function readLayout(value: unknown): Layout {
  if (value === undefined) return defaultLayout;
  if (!value || typeof value !== "object") throw Error("Layout inválido.");
  const result = {} as Layout;
  for (const key of Object.keys(defaultLayout) as (keyof Layout)[]) {
    const box = (value as Layout)[key];
    if (!box || ![box.x, box.y, box.w, box.h].every(Number.isFinite) ||
        box.x < 0 || box.y < 0 || box.w < 10 || box.h < 10 || box.x+box.w > 594.001 || box.y+box.h > 420.001) throw Error("Elemento fora da folha.");
    result[key] = { x: box.x, y: box.y, w: box.w, h: box.h };
  }
  return result;
}
export function readScale(value: unknown): number | undefined {
  if (value == null || value === "") return;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1000 || value > 10000000) throw Error("Use uma escala entre 1:1.000 e 1:10.000.000.");
  return value;
}
