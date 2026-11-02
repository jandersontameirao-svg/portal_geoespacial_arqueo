import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { buildPlan, type LayerInfo } from './atena/plan';
import { structuredRequestSchema } from './atena/skills';
import { runKey } from './atena/executor';

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('NETWORK_FORBIDDEN_IN_OFFLINE_TEST'); })));
const layers: LayerInfo[] = [
  { id: 1, name: 'ADA do projeto', crs: 'EPSG:4674', isGroup: false, layerType: 'vector', featureCount: 1 },
  { id: 2, name: 'Sítios SICG', crs: 'EPSG:4674', isGroup: false, layerType: 'vector', featureCount: 40 },
  { id: 3, name: 'Grupo', crs: 'EPSG:4674', isGroup: true, layerType: 'vector', featureCount: 0 },
  { id: 4, name: 'Web Mercator', crs: 'EPSG:3857', isGroup: false, layerType: 'vector', featureCount: 5 },
  { id: 5, name: 'Raster', crs: 'EPSG:4674', isGroup: false, layerType: 'raster', featureCount: 0 },
];

const req = (x: unknown) => structuredRequestSchema.parse(x);

describe('plano: perguntas em vez de escolhas silenciosas', () => {
  it('pede a camada de referência quando não informada (não escolhe pelo nome)', () => {
    const r = buildPlan(req({ operation: 'vector.intersect_area', sourceLayerIds: [2] }), layers);
    expect(r.status).toBe('needs_input');
    if (r.status === 'needs_input') expect(r.questions[0]).toMatch(/área de referência/);
  });
  it('pede a distância do buffer quando não informada', () => {
    const r = buildPlan(req({ operation: 'vector.buffer', sourceLayerIds: [2] }), layers);
    expect(r.status).toBe('needs_input');
    if (r.status === 'needs_input') expect(r.questions[0]).toMatch(/distância/);
  });
});

describe('plano: validações antes da execução', () => {
  it('recusa projeção incompatível (EPSG:3857) com instrução clara', () => {
    const r = buildPlan(req({ operation: 'vector.intersect_area', referenceLayerId: 1, sourceLayerIds: [4] }), layers);
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.errors[0]).toMatch(/EPSG:3857/);
  });
  it('recusa grupo e camada não vetorial como origem', () => {
    const g = buildPlan(req({ operation: 'vector.buffer', distanceM: 100, sourceLayerIds: [3] }), layers);
    const rs = buildPlan(req({ operation: 'vector.buffer', distanceM: 100, sourceLayerIds: [5] }), layers);
    expect(g.status).toBe('error');
    expect(rs.status).toBe('error');
  });
  it('recusa camada que não pertence ao projeto (id desconhecido)', () => {
    const r = buildPlan(req({ operation: 'vector.buffer', distanceM: 100, sourceLayerIds: [999] }), layers);
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.errors[0]).toMatch(/não pertence/);
  });
  it('recusa usar a referência também como origem', () => {
    const r = buildPlan(req({ operation: 'vector.intersect_area', referenceLayerId: 1, sourceLayerIds: [1] }), layers);
    expect(r.status).toBe('error');
  });
  it('rejeita distância fora do limite (esquema zod)', () => {
    expect(() => req({ operation: 'vector.buffer', distanceM: 50000, sourceLayerIds: [2] })).toThrow();
    expect(() => req({ operation: 'vector.buffer', distanceM: -5, sourceLayerIds: [2] })).toThrow();
  });
  it('rejeita operação que não está registrada (sem execução livre)', () => {
    expect(() => req({ operation: 'exec.shell', sourceLayerIds: [2] })).toThrow();
  });
});

describe('plano pronto', () => {
  it('monta plano versionado com parâmetros e unidade explícitos', () => {
    const r = buildPlan(req({ operation: 'vector.intersect_area', referenceLayerId: 1, sourceLayerIds: [2] }), layers);
    expect(r.status).toBe('ready');
    if (r.status === 'ready') {
      expect(r.plan.skill).toBe('vector.intersect_area');
      expect(r.plan.skillVersion).toBe('1.0.0');
      expect(r.plan.referenceLayer?.name).toBe('ADA do projeto');
      expect(r.plan.parameters.unit).toBe('m');
      expect(r.plan.parameters.areaMethod).toMatch(/UTM SIRGAS 2000/);
    }
  });
  it('buffer com distância grava a distância no plano', () => {
    const r = buildPlan(req({ operation: 'vector.buffer', distanceM: 250, sourceLayerIds: [2] }), layers);
    expect(r.status).toBe('ready');
    if (r.status === 'ready') expect(r.plan.parameters.distanceM).toBe(250);
  });
});

describe('idempotência', () => {
  const plan: any = { planVersion: 1, skill: 'vector.buffer', parameters: { distanceM: 100 }, sourceLayers: [{ id: 2 }] };
  it('mesmo projeto, plano e dados geram a mesma chave', () => {
    expect(runKey(1, plan, 'fp')).toBe(runKey(1, plan, 'fp'));
  });
  it('dados alterados ou parâmetro diferente geram outra chave', () => {
    expect(runKey(1, plan, 'fp')).not.toBe(runKey(1, plan, 'fp2'));
    expect(runKey(1, plan, 'fp')).not.toBe(runKey(1, { ...plan, parameters: { distanceM: 200 } }, 'fp'));
    expect(runKey(1, plan, 'fp')).not.toBe(runKey(2, plan, 'fp'));
  });
});

describe('IA bloqueada sem provedor configurado', () => {
  it('não simula resposta: status blocked e mensagem clara', async () => {
    vi.resetModules();
    vi.doMock('./_core/env', () => ({ ENV: { forgeApiUrl: '', forgeApiKey: '' } }));
    const ai = await import('./atena/ai');
    expect(ai.aiStatus().configured).toBe(false);
    const r = await ai.interpretRequest({ text: 'identifique sítios na ADA', layers: [] });
    expect(r.status).toBe('blocked');
    if (r.status === 'blocked') expect(r.message).toMatch(/bloqueada/);
    vi.doUnmock('./_core/env');
  });
});
