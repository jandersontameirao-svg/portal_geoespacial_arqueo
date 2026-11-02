import { describe, expect, it } from "vitest";
import {
  ATENA_CHAT_ROUTE_PATHS, atenaNavigationPath, atenaRequestKey, authorizedAtenaProject,
  classifyAtenaChatCommand, parseAtenaProjectId, safeAtenaArtifactUrl, validAtenaCoordinates,
} from "../client/src/lib/atenaChatCommands";

describe("Atena: comandos puros e rotas reais, sem API/modelo", () => {
  it.each([
    ["listar projetos", { kind: "list_projects" }], ["MEUS PROJETOS", { kind: "list_projects" }],
    ["abrir projetos", { kind: "navigate", target: "projects" }],
    ["Abrir arquivos", { kind: "navigate", target: "files" }],
    ["vá para o Atlas", { kind: "navigate", target: "atlas" }],
    ["abrir backups", { kind: "navigate", target: "backups" }],
    ["abrir Atena", { kind: "navigate", target: "atena" }],
    ["abrir mapa", { kind: "navigate", target: "map" }],
    ["buffer de 50 metros", { kind: "gis_analysis" }],
    ["calcular intersecção", { kind: "gis_analysis" }],
    ["gerar PDF", { kind: "advanced_gis" }], ["calcular AII", { kind: "advanced_gis" }],
    ["ajuda", { kind: "help" }],
  ])("classifica %s sem execução", (input, expected) => expect(classifyAtenaChatCommand(input as string)).toEqual(expected));
  it.each(["", "executar rm -rf /", "abrir https://example.com/atlas", "fetch('/api/foo')", "abrir arquivos; sudo ls", "eval buffer", "abrir javascript:alert(1)", "curl /api/run buffer", "x".repeat(2001)])("recusa entrada arbitrária %s", input => expect(classifyAtenaChatCommand(input)).toEqual({ kind: "unsupported" }));
  it("mantém destinos especializados e não inventa contexto no mapa baseline", () => {
    expect(ATENA_CHAT_ROUTE_PATHS.files).toBe("/files");
    expect(ATENA_CHAT_ROUTE_PATHS.backups).toBe("/admin/backups");
    expect(atenaNavigationPath("map", 12)).toBe("/");
    expect(atenaNavigationPath("atena", 12)).toBe("/atena?projectId=12");
    expect(atenaNavigationPath("atena", -12)).toBe("/atena");
  });
});
describe("Atena: ID de URL não concede acesso", () => {
  it.each([["/projects/12", "", 12], ["/atena?projectId=15", "", 15], ["/atena", "projectId=4", 4]])("extrai apenas candidato em %s", (location, search, expected) => expect(parseAtenaProjectId(location as string, search as string)).toBe(expected));
  it.each(["/atena?projectId=0", "/atena?projectId=-1", "/atena?projectId=1.5", "/atena?projectId=001", "/atena?projectId=9007199254740992", "/atena?projectId=1&projectId=2", "/atena?projectId=1e2", "/projects/12/secret", "/atena?projectId=%3Cscript%3E"])('não aceita %s', location => expect(parseAtenaProjectId(location)).toBeUndefined());
  it("resolve somente a lista autorizada, inclusive lista vazia e query ainda carregando", () => {
    const rows = [{ id: 4, name: "Autorizado" }];
    expect(authorizedAtenaProject(4, rows)).toBe(rows[0]);
    expect(authorizedAtenaProject(15, rows)).toBeUndefined();
    expect(authorizedAtenaProject(4, undefined)).toBeUndefined();
    expect(authorizedAtenaProject(4, [])).toBeUndefined();
  });
});
describe("Atena: vínculo da revisão e segurança de saída", () => {
  it("qualquer parâmetro efetivo invalida o plano confirmado", () => {
    const request = { operation: "vector.buffer" as const, sourceLayerIds: [3, 2], distanceM: 50 };
    const key = atenaRequestKey(4, request);
    expect(atenaRequestKey(4, { ...request, sourceLayerIds: [2, 3] })).toBe(key);
    expect(atenaRequestKey(5, request)).not.toBe(key);
    expect(atenaRequestKey(4, { ...request, distanceM: 100 })).not.toBe(key);
    expect(atenaRequestKey(4, { ...request, sourceLayerIds: [3] })).not.toBe(key);
    expect(atenaRequestKey(4, { ...request, outputName: "Nova saída" })).not.toBe(key);
  });
  it.each(["javascript:alert(1)", "data:text/html,x", "//external.invalid/a", "http://external.invalid/a", "https://u:p@external.invalid/a", "/\\external.invalid/a", "https://external.invalid/a\n"])('recusa artefato %s', url => expect(safeAtenaArtifactUrl(url)).toBeNull());
  it("aceita HTTPS ou caminhos locais de artefato e mantém o conteúdo como texto", () => {
    expect(safeAtenaArtifactUrl("/files/mapa.pdf")).toBe("/files/mapa.pdf");
    expect(safeAtenaArtifactUrl("https://storage.invalid/mapa.pdf?sig=abc")).toBe("https://storage.invalid/mapa.pdf?sig=abc");
    expect(validAtenaCoordinates([-46, -23])).toBe(true);
    expect(validAtenaCoordinates([-46, 91])).toBe(false);
    expect(validAtenaCoordinates([181, -23])).toBe(false);
    expect(validAtenaCoordinates([NaN, -23])).toBe(false);
  });
});
