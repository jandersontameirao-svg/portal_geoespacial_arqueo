import { describe, expect, it } from 'vitest';
import { TEMPLATES, TEMPLATE_ORDER, getTemplate, checkRequirements } from './atena/templates';

describe('catálogo de modelos cartográficos', () => {
  it('tem exatamente os seis modelos na ordem aprovada', () => {
    expect(TEMPLATES.map(t => t.id)).toEqual([...TEMPLATE_ORDER]);
    expect(TEMPLATES.length).toBe(6);
  });
  it('os três primeiros estão disponíveis e os três últimos bloqueados com motivo', () => {
    expect(TEMPLATES.slice(0, 3).every(t => t.status === 'available')).toBe(true);
    const blocked = TEMPLATES.slice(3);
    expect(blocked.every(t => t.status === 'blocked' && !!t.blockedReason)).toBe(true);
    expect(getTemplate('relevo_curvas_nivel').blockedReason).toMatch(/fonte altimétrica/);
    expect(getTemplate('pocos_teste_preditivo').blockedReason).toMatch(/método de predição/);
    expect(getTemplate('coerencia_arqueologica').blockedReason).toMatch(/critérios científicos/);
  });
  it('todas as versões seguem semver', () => {
    expect(TEMPLATES.every(t => /^\d+\.\d+\.\d+$/.test(t.version))).toBe(true);
  });
  it('id desconhecido gera erro explícito', () => {
    expect(() => getTemplate('mapa_inventado')).toThrow(/desconhecido/);
  });
  it('papéis obrigatórios faltantes aparecem como pendência específica', () => {
    const t = getTemplate('areas_influencia');
    const r = checkRequirements(t, []);
    expect(r.ready).toBe(false);
    expect(r.missing.map(m => m.role)).toEqual(['ADA']);
    expect(checkRequirements(t, ['ADA']).ready).toBe(true);
  });
  it('modelo bloqueado nunca fica pronto, mesmo com papéis presentes', () => {
    expect(checkRequirements(getTemplate('relevo_curvas_nivel'), ['ADA']).ready).toBe(false);
  });
  it('nenhum modelo usa mapa-base no PDF nesta versão', () => {
    expect(TEMPLATES.every(t => t.basemap === 'none')).toBe(true);
  });
});
