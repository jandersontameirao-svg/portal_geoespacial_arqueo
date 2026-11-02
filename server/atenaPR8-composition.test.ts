import { describe, expect, it } from 'vitest';
import { renderMapPdf, chooseScale, PAGE, clipPolygon } from './atena/composition';
import { localProjection } from './atena/geo';

describe('escala cartográfica', () => {
  it('escolhe escala redonda que cabe o extent na moldura', () => {
    // 2.000 m de extent em moldura de 300 mm: 2000/300 = 6,67 m/mm → escala ~1:6.667 → arredonda para cima
    const s = chooseScale(2000, 1000, 300, 200);
    expect([500, 1000, 2000, 2500, 5000, 10000].includes(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(2000 / 300 * 1000);
  });
});

describe('PDF cartográfico', () => {
  const pt = (lng: number, lat: number) => [lng, lat];
  const sq = (lat: number, lng: number, d: number) => [[pt(lng, lat), pt(lng + d, lat), pt(lng + d, lat + d), pt(lng, lat + d), pt(lng, lat)]];
  let base: any = {
    run: { id: 7, projectId: 1, finishedAt: new Date(), codeVersion: 'atena-test', skillVersions: { 'vector.intersect_area': '1.0.0' }, plan: {}, outputs: {}, inputs: {} } as any,
    title: 'Teste', orientation: 'landscape' as const,
    proj: { code: 'LOCAL', def: '', epsgUtm: 'EPSG:31983', utmZone: 23, lat0: -23.495, lng0: -46.595 },
    table: [{ sourceName: 'Sítio A', sourceAreaM2: 10000, intersectionAreaM2: 2500, percentInside: 25 }],
    sources: ['ADA (referência)', 'Sítios'],
    referenceName: 'ADA',
    generatedAt: new Date('2026-10-31T00:00:00Z'),
  };

  it('gera PDF A3 paisagem com conteúdo', () => {
    const sqFn = sq;
    // Registra a projeção local antes de desenhar (mesmo caminho do router)
    const p = localProjection([{ id: 1, name: 'a', type: 'Polygon', feature: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-46.6, -23.5], [-46.59, -23.5], [-46.59, -23.49], [-46.6, -23.49], [-46.6, -23.5]]] } } } as any]);
    base.proj = { code: p.code, def: p.def, epsgUtm: p.epsgUtm, utmZone: p.utmZone, lat0: p.lat0, lng0: p.lng0 };
    const buf = renderMapPdf({ ...base, pageSize: 'A3', items: [
      { kind: 'ref', name: 'ADA', polygons: [sq(-23.5, -46.6, 0.01)] },
      { kind: 'source', name: 'Sítios', polygons: [sq(-23.495, -46.595, 0.01)] },
      { kind: 'result', name: 'Interseção', polygons: [sq(-23.495, -46.595, 0.005)] },
    ] } as any);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(2000);
    expect(PAGE.A3.w).toBe(420);
  });

  it('gera PDF com exterior assimétrico, furo e dois componentes MultiPolygon', () => {
    const p = localProjection([{ id: 2, name: 'multi', type: 'MultiPolygon', feature: {
      type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [
        [[[-46.63, -23.52], [-46.60, -23.52], [-46.59, -23.49], [-46.62, -23.47], [-46.63, -23.52]], [[-46.622, -23.505], [-46.608, -23.505], [-46.605, -23.492], [-46.618, -23.488], [-46.622, -23.505]]],
        [[[-46.55, -23.43], [-46.52, -23.43], [-46.51, -23.40], [-46.54, -23.39], [-46.55, -23.43]], [[-46.542, -23.418], [-46.528, -23.418], [-46.525, -23.405], [-46.539, -23.401], [-46.542, -23.418]]],
      ] },
    } } as any]);
    const buf = renderMapPdf({ ...base, pageSize: 'A3', proj: { code: p.code, def: p.def, epsgUtm: p.epsgUtm, utmZone: p.utmZone, lat0: p.lat0, lng0: p.lng0 }, items: [{
      kind: 'source', name: 'Multi com furos', polygons: [[
        [[-46.63, -23.52], [-46.60, -23.52], [-46.59, -23.49], [-46.62, -23.47], [-46.63, -23.52]],
        [[-46.622, -23.505], [-46.608, -23.505], [-46.605, -23.492], [-46.618, -23.488], [-46.622, -23.505]],
      ], [
        [[-46.55, -23.43], [-46.52, -23.43], [-46.51, -23.40], [-46.54, -23.39], [-46.55, -23.43]],
        [[-46.542, -23.418], [-46.528, -23.418], [-46.525, -23.405], [-46.539, -23.401], [-46.542, -23.418]],
      ]],
    }] } as any);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(2000);
  });
});

describe('recorte à moldura (Sutherland-Hodgman)', () => {
  const box = { x0: 0, y0: 0, x1: 10, y1: 10 };
  const area = (p: number[][]) => { let a = 0; for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; a += p[i][0] * p[j][1] - p[j][0] * p[i][1]; } return Math.abs(a) / 2; };
  it('quadrado que cruza a borda fica com metade da área', () => {
    const sq = [[5, 2], [15, 2], [15, 8], [5, 8]];
    expect(area(clipPolygon(sq, box))).toBeCloseTo(30, 6); // recorte x em [5,10], y em [2,8]: 5 x 6
  });
  it('polígono totalmente fora é descartado', () => {
    expect(clipPolygon([[20, 20], [30, 20], [30, 30]], box).length).toBe(0);
  });
  it('polígono totalmente dentro não muda', () => {
    const sq = [[1, 1], [3, 1], [3, 3], [1, 3]];
    expect(area(clipPolygon(sq, box))).toBeCloseTo(4, 6);
  });
});
