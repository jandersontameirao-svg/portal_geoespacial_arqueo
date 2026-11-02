import { describe, expect, it } from 'vitest';
import { parseRow, parseRows, localProjection, intersectWithReference, bufferFeature, unionPolygons, toStoredPolygons, ringAreaM2, type Feat, type SourceRow } from './atena/geo';

// Área analítica de um retângulo em elipsoide GRS80 (independente do LAEA usado no código).
const A = 6378137, E2 = 0.00669438002290;
function rectAreaGeodesic(latS: number, latN: number, lngW: number, lngE: number) {
  const phi = ((latS + latN) / 2) * Math.PI / 180;
  const dPhi = (latN - latS) * Math.PI / 180, dLam = (lngE - lngW) * Math.PI / 180;
  const W = Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
  const N = A / W, M = A * (1 - E2) / (W ** 3);
  return M * N * Math.cos(phi) * dPhi * dLam;
}

const poly = (id: number, name: string, latS: number, latN: number, lngW: number, lngE: number): SourceRow => ({
  id, name, type: 'polygon', layerId: id === 1 ? 10 : 20,
  // Armazenamento canônico: [lat, lng], anel sem repetir o primeiro ponto
  coordinates: JSON.stringify([[latS, lngW], [latS, lngE], [latN, lngE], [latN, lngW]]),
});
const feat = (r: SourceRow): Feat => { const x = parseRow(r); if (!x.ok) throw new Error(x.issue.message); return x.value; };

describe('parseRow: ordem, envelope e validade', () => {
  it('aceita polígono válido em [lat,lng] dentro do Brasil', () => {
    expect(parseRow(poly(1, 'ADA', -23.5, -23.49, -46.6, -46.59)).ok).toBe(true);
  });
  it('recusa coordenadas gravadas como [lng,lat] (ordem invertida)', () => {
    const r: SourceRow = { id: 2, name: 'KML', type: 'polygon', layerId: 1,
      coordinates: JSON.stringify([[-46.6, -23.5], [-46.59, -23.5], [-46.59, -23.49], [-46.6, -23.49]]) };
    const x = parseRow(r);
    expect(x.ok).toBe(false);
    if (!x.ok) expect(x.issue.code).toBe('ORDEM_INVERTIDA');
  });
  it('recusa coordenadas fora do envelope do Brasil', () => {
    const x = parseRow(poly(3, 'Fora', 40, 41, 10, 11));
    expect(x.ok).toBe(false);
    if (!x.ok) expect(x.issue.code).toBe('FORA_DO_BRASIL');
  });
  it('recusa polígono com autointerseção (gravata)', () => {
    const r: SourceRow = { id: 4, name: 'Gravata', type: 'polygon', layerId: 1,
      coordinates: JSON.stringify([[-23.5, -46.6], [-23.49, -46.59], [-23.5, -46.59], [-23.49, -46.6]]) };
    const x = parseRow(r);
    expect(x.ok).toBe(false);
    if (!x.ok) expect(x.issue.code).toBe('GEOMETRIA_INVALIDA');
  });
  it('recusa JSON ilegível', () => {
    const x = parseRow({ id: 5, name: 'X', type: 'polygon', layerId: 1, coordinates: '{nope' });
    expect(x.ok).toBe(false);
  });
  it('parseRows separa válidas de inválidas sem descartar silenciosamente', () => {
    const { feats, issues } = parseRows([poly(1, 'ok', -23.5, -23.49, -46.6, -46.59), poly(6, 'fora', 40, 41, 10, 11)]);
    expect(feats.length).toBe(1);
    expect(issues.map(i => i.code)).toEqual(['FORA_DO_BRASIL']);
  });
});

describe('interseção com área de referência (área conhecida)', () => {
  // Dois quadrados de 0,01° x 0,01°, sobrepostos em 0,005° x 0,005°.
  const ref = feat(poly(1, 'ADA', -23.5, -23.49, -46.6, -46.59));
  const src = feat(poly(2, 'Sítio parcial', -23.495, -23.485, -46.595, -46.585));
  const proj = localProjection([ref, src]);

  it('área de interseção bate com a área analítica do retângulo sobreposto (< 0,3%)', () => {
    const [row] = intersectWithReference([src], ref.feature as any, proj);
    const expected = rectAreaGeodesic(-23.495, -23.49, -46.595, -46.59);
    expect(row.intersectionAreaM2 / expected).toBeGreaterThan(0.997);
    expect(row.intersectionAreaM2 / expected).toBeLessThan(1.003);
  });

  it('área total do sítio é separada da área interna', () => {
    const [row] = intersectWithReference([src], ref.feature as any, proj);
    const total = rectAreaGeodesic(-23.495, -23.485, -46.595, -46.585);
    expect(row.sourceAreaM2 / total).toBeGreaterThan(0.997);
    expect(row.sourceAreaM2 / total).toBeLessThan(1.003);
    // Sobreposição de 0,005° x 0,005° dentro de um sítio de 0,01° x 0,01°: 25%
    expect(row.percentInside).toBeGreaterThan(24.7);
    expect(row.percentInside).toBeLessThan(25.3);
  });

  it('sítio fora da ADA não tem interseção', () => {
    const far = feat(poly(3, 'Longe', -23.2, -23.19, -46.2, -46.19));
    const [row] = intersectWithReference([far], ref.feature as any, proj);
    expect(row.intersectionAreaM2).toBe(0);
    expect(row.pieces).toBeNull();
  });

  it('une várias partes da ADA antes de interceptar', () => {
    const p1 = feat(poly(7, 'ADA-1', -23.5, -23.495, -46.6, -46.595));
    const p2 = feat(poly(8, 'ADA-2', -23.495, -23.49, -46.595, -46.59));
    const u = unionPolygons([p1, p2]);
    expect(u).not.toBeNull();
    const area = ringAreaM2(u!.geometry as any, proj);
    // Dois quadrados diagonais de 0,005° cada (sem sobreposição)
    const expected = rectAreaGeodesic(-23.5, -23.495, -46.6, -46.595) + rectAreaGeodesic(-23.495, -23.49, -46.595, -46.59);
    expect(area / expected).toBeGreaterThan(0.997);
    expect(area / expected).toBeLessThan(1.003);
  });
});

describe('buffer com distância verificada', () => {
  it('buffer de 50 m em um ponto tem área próxima de π·50² (< 1%)', () => {
    const pt: Feat = { id: 9, name: 'P', type: 'Point', feature: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-46.6, -23.5] } } as any };
    const b = bufferFeature(pt, 50)!;
    const proj = localProjection([pt]);
    const area = ringAreaM2(b.geometry as any, proj);
    const expected = Math.PI * 50 * 50;
    expect(Math.abs(area / expected - 1)).toBeLessThan(0.01);
  });
});

describe('projeção e gravação', () => {
  it('usa UTM SIRGAS 2000 da zona do centro do extent (decisão aprovada)', () => {
    const p = localProjection([feat(poly(1, 'ADA', -23.5, -23.49, -46.6, -46.59))]);
    // Lng -46,6 está na zona 23 (-48° a -42°)
    expect(p.epsgUtm).toBe('EPSG:31983');
    expect(p.utmZone).toBe(23);
    expect(p.def).toContain('+proj=utm +zone=23 +south');
    expect(p.def).toContain('+ellps=GRS80');
  });
  it('extent que cruza fuso UTM é recusado com mensagem clara', () => {
    // Zona 22 termina em -48°; zona 23 começa nesse ponto
    const a = feat(poly(1, 'A', -23.5, -23.49, -48.05, -48.02));
    const b = feat(poly(2, 'B', -23.5, -23.49, -47.95, -47.92));
    expect(() => localProjection([a, b])).toThrow(/cruza mais de um fuso UTM/);
  });
  it('grava polígonos de volta em [lat,lng] e um registro por parte', () => {
    const f = feat(poly(1, 'ADA', -23.5, -23.49, -46.6, -46.59));
    const stored = toStoredPolygons(f.feature.geometry as any);
    expect(stored.length).toBe(1);
    const back = JSON.parse(stored[0]);
    expect(back[0][0][0]).toBeCloseTo(-23.5);
    expect(back[0][0][1]).toBeCloseTo(-46.6);
  });

  it('preserva componentes, exteriores e furos assimétricos no parse e na gravação', () => {
    const firstExterior = [
      [-23.52, -46.63], [-23.52, -46.60], [-23.49, -46.59], [-23.47, -46.62], [-23.52, -46.63],
    ];
    const firstHole = [
      [-23.505, -46.622], [-23.505, -46.608], [-23.492, -46.605], [-23.488, -46.618], [-23.505, -46.622],
    ];
    const secondExterior = [
      [-23.43, -46.55], [-23.43, -46.52], [-23.40, -46.51], [-23.39, -46.54], [-23.43, -46.55],
    ];
    const secondHole = [
      [-23.418, -46.542], [-23.418, -46.528], [-23.405, -46.525], [-23.401, -46.539], [-23.418, -46.542],
    ];
    const row: SourceRow = {
      id: 11,
      name: 'Multi assimétrico',
      type: 'polygon',
      layerId: 1,
      coordinates: JSON.stringify([[firstExterior, firstHole], [secondExterior, secondHole]]),
    };
    const parsed = parseRow(row);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.type).toBe('MultiPolygon');
    expect(parsed.value.feature.geometry.coordinates).toHaveLength(2);
    expect(parsed.value.feature.geometry.coordinates[0]).toHaveLength(2);
    expect(parsed.value.feature.geometry.coordinates[1]).toHaveLength(2);

    const stored = toStoredPolygons(parsed.value.feature.geometry as any);
    expect(stored).toHaveLength(2);
    expect(JSON.parse(stored[0])).toHaveLength(2);
    expect(JSON.parse(stored[1])).toHaveLength(2);
    expect(JSON.parse(stored[0])[1][2]).toEqual(firstHole[2]);
  });
});
