import { describe, expect, it } from 'vitest';
import { lineString, polygon } from '@turf/helpers';
import { deriveAdaFromAxis, deriveAid, selectMunicipalities, buildAii, aiiStatus, type Municipality } from './atena/areas';
import { localProjection, lineLengthM, ringAreaM2, type Feat } from './atena/geo';

const axisFeat = (coords: number[][]): Feat => ({ id: 1, name: 'Eixo LT', type: 'LineString', feature: lineString(coords) as any });
const polyFeat = (id: number, name: string, ring: number[][]): Feat => ({ id, name, type: 'Polygon', feature: polygon([ring]) as any });
const rect = (w: number, s: number, e: number, n: number) => [[w, s], [e, s], [e, n], [w, n], [w, s]];

// Eixo sintético: ~0,1° de comprimento em latitude -23,5
const AXIS = axisFeat([[-46.6, -23.5], [-46.5, -23.5]]);

describe('ADA a partir do eixo (buffer por lado, em metros)', () => {
  for (const h of [30, 35, 40]) {
    it(`largura de ${h} m por lado: área ≈ comprimento·2h + π·h² (tolerância 1%)`, () => {
      const r = deriveAdaFromAxis(AXIS, h);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const proj = localProjection([AXIS]);
      const len = lineLengthM(AXIS.feature as any, proj);
      const expected = len * 2 * h + Math.PI * h * h;
      expect(Math.abs(r.areaM2 / expected - 1)).toBeLessThan(0.01);
      expect(r.geometry.type === 'Polygon' || r.geometry.type === 'MultiPolygon').toBe(true);
      expect(r.params.larguraLadoM).toBe(h);
      expect(r.params.larguraTotalM).toBe(2 * h);
    });
  }
  it('rejeita largura fora do limite', () => {
    expect(deriveAdaFromAxis(AXIS, 0).ok).toBe(false);
    expect(deriveAdaFromAxis(AXIS, 600).ok).toBe(false);
  });
  it('rejeita origem que não é linha', () => {
    const r = deriveAdaFromAxis(polyFeat(2, 'x', rect(-46.6, -23.51, -46.55, -23.5)), 35);
    expect(r.ok).toBe(false);
  });
  it('eixo em zigue-zague fechado produz polígono válido, sem autointerseção', () => {
    // O buffer é uma união: sobreposições internas são dissolvidas, e o resultado é validado.
    const zig = axisFeat([[-46.6, -23.5], [-46.5999, -23.5], [-46.6, -23.5001]]);
    const r = deriveAdaFromAxis(zig, 50);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.areaM2).toBeGreaterThan(0);
  });
});

describe('AID: origem e distância explícitas', () => {
  it('AID a partir do eixo com 250 m difere da AID a partir da ADA com 250 m', () => {
    const ada = deriveAdaFromAxis(AXIS, 35);
    if (!ada.ok) throw new Error('ADA falhou');
    const adaFeat = polyFeat(3, 'ADA', [[-46.6, -23.5], [-46.5, -23.5], [-46.5, -23.49], [-46.6, -23.49], [-46.6, -23.5]]);
    const aidAxis = deriveAid({ kind: 'eixo', feat: AXIS }, 250, adaFeat);
    const aidAda = deriveAid({ kind: 'ada', feat: adaFeat }, 250, adaFeat);
    expect(aidAxis.ok && aidAda.ok).toBe(true);
    if (aidAxis.ok && aidAda.ok) {
      expect(aidAda.areaM2).toBeGreaterThan(aidAxis.areaM2 * 1.02);
      expect(aidAxis.params.origemAID).toBe('eixo');
      expect(aidAda.params.origemAID).toBe('ada');
      expect(aidAxis.params.distanciaM).toBe(250);
    }
    void ada;
  });
  it('avisa quando a AID não cobre a ADA', () => {
    const adaFeat = polyFeat(3, 'ADA', [[-46.6, -23.5], [-46.5, -23.5], [-46.5, -23.49], [-46.6, -23.49], [-46.6, -23.5]]);
    const r = deriveAid({ kind: 'ada', feat: adaFeat }, 1, adaFeat);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.length).toBe(0); // AID=ADA+1 m cobre a ADA
    const small = deriveAid({ kind: 'eixo', feat: AXIS }, 5, adaFeat);
    expect(small.ok).toBe(true);
    if (small.ok) expect(small.warnings.join(' ')).toMatch(/não cobre/);
  });
  it('rejeita distância fora do limite', () => {
    expect(deriveAid({ kind: 'eixo', feat: AXIS }, 0).ok).toBe(false);
  });
});

describe('AII: municípios inteiros intersectados pela ADA (nunca recorte, nunca buffer)', () => {
  // ADA quadrada que atravessa Alfa e Beta; Gama não é tocada; Delta só toca a fronteira.
  const ADA = polyFeat(10, 'ADA', rect(-46.6, -23.51, -46.55, -23.5));
  const mesh: Municipality[] = [
    { code: '3500001', name: 'Alfa', feat: polyFeat(21, 'Alfa', rect(-46.70, -23.60, -46.58, -23.40)) },
    { code: '3500002', name: 'Beta', feat: polyFeat(22, 'Beta', rect(-46.58, -23.60, -46.45, -23.40)) },
    { code: '3500003', name: 'Gama', feat: polyFeat(23, 'Gama', rect(-46.30, -23.60, -46.20, -23.40)) },
    { code: '3500004', name: 'Delta', feat: polyFeat(24, 'Delta', rect(-46.55, -23.70, -46.40, -23.62)) },
  ];

  it('seleciona municípios que intersectam a ADA e não seleciona os demais', () => {
    const { selected, review } = selectMunicipalities(ADA, mesh);
    expect(selected.map(s => s.code).sort()).toEqual(['3500001', '3500002']);
    expect(review.length).toBe(0);
  });

  it('município que só toca a ADA na fronteira vai para revisão humana, não é descartado em silêncio', () => {
    const touching: Municipality = { code: '3500005', name: 'Epsilon', feat: polyFeat(25, 'Epsilon', rect(-46.55, -23.52, -46.50, -23.49)) };
    // Epsilon compartilha só a aresta lng=-46,55 com a ADA
    const ADA2 = polyFeat(11, 'ADA', rect(-46.6, -23.51, -46.55, -23.5));
    const { selected, review } = selectMunicipalities(ADA2, [touching]);
    expect(selected.length).toBe(0);
    expect(review.map(r => r.code)).toEqual(['3500005']);
    expect(review[0].status).toBe('revisar_toque');
  });

  it('AII contém os municípios inteiros: área = soma das áreas (tolerância 0,5%), não o recorte pela ADA', () => {
    const { selected } = selectMunicipalities(ADA, mesh);
    const feats = selected.map(s => mesh.find(m => m.code === s.code)!.feat);
    const r = buildAii(feats);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const proj = localProjection(feats);
    const sumIndividual = feats.reduce((acc, f) => acc + ringAreaM2(f.feature.geometry as any, proj), 0);
    expect(Math.abs(r.areaM2 / sumIndividual - 1)).toBeLessThan(0.005);
    // Muito maior que a ADA: prova que não foi recortada
    expect(r.areaM2).toBeGreaterThan(ringAreaM2(ADA.feature.geometry as any, proj) * 50);
    expect(r.params.municipios).toBe(2);
    expect(r.params.origemMetodo).toBe('municipios_intersectados_pela_ada');
  });

  it('sem malha municipal, a AII fica bloqueada com o motivo exato e sem fallback de buffer', () => {
    const s = aiiStatus(false);
    expect(s.status).toBe('bloqueado');
    expect(s.reason).toBe('Malha municipal necessária para delimitar AII');
    expect(aiiStatus(true).status).toBe('disponivel');
  });

  it('versão de malha alterada muda a seleção sem alterar a regra (teste de regressão)', () => {
    const reduced = mesh.filter(m => m.code !== '3500002');
    const { selected } = selectMunicipalities(ADA, reduced);
    expect(selected.map(s => s.code)).toEqual(['3500001']);
  });
});

import { AID_PADRAO, MALHA_IBGE_REFERENCIA, checkMalhaVersion } from './atena/areas';

describe('decisões aprovadas: AID padrão e malha mais recente do IBGE', () => {
  it('AID padrão é 250 m a partir da ADA', () => {
    expect(AID_PADRAO).toEqual({ origem: 'ada', distanciaM: 250 });
  });
  it('malha mais recente do IBGE é 2025', () => {
    expect(MALHA_IBGE_REFERENCIA.anoMaisRecente).toBe(2025);
  });
  it('aceita somente a malha mais recente', () => {
    expect(checkMalhaVersion(2025, true).ok).toBe(true);
    const antiga = checkMalhaVersion(2024, true);
    expect(antiga.ok).toBe(false);
    if (!antiga.ok) expect(antiga.reason).toMatch(/não é a versão mais recente/);
    const sem = checkMalhaVersion(undefined);
    expect(sem.ok).toBe(false);
  });
});
