import { describe, it, expect } from "vitest";
import { assertIndeMapPrintReady, registerIndeMapPrintState } from "../client/src/lib/indeMapPrintGuard";
describe("Guarda de impressão INDE por mapa", () => {
  it("permite mapa sem seleção institucional", () => { expect(() => assertIndeMapPrintReady({})).not.toThrow(); });
  it("bloqueia camada pendente ou com erro sem produzir captura", () => { const map={}; const stop=registerIndeMapPrintState(map,"a",false); expect(()=>assertIndeMapPrintReady(map)).toThrow(/nenhum PDF parcial/); stop(); expect(()=>assertIndeMapPrintReady(map)).not.toThrow(); });
  it("não bloqueia outros mapas", () => { const a={},b={};const stop=registerIndeMapPrintState(a,"a",false);expect(()=>assertIndeMapPrintReady(b)).not.toThrow();expect(()=>assertIndeMapPrintReady(a)).toThrow();stop(); });
  it("permite somente quando todas as camadas registradas estão prontas", () => {const map={};const a=registerIndeMapPrintState(map,"a",true),b=registerIndeMapPrintState(map,"b",false);expect(()=>assertIndeMapPrintReady(map)).toThrow();b();const c=registerIndeMapPrintState(map,"b",true);expect(()=>assertIndeMapPrintReady(map)).not.toThrow();a();c();});
  it("cleanup antigo não remove o estado mais novo da mesma camada", () => {const map={};const old=registerIndeMapPrintState(map,"a",true),current=registerIndeMapPrintState(map,"a",false);old();expect(()=>assertIndeMapPrintReady(map)).toThrow();current();expect(()=>assertIndeMapPrintReady(map)).not.toThrow();});
});
