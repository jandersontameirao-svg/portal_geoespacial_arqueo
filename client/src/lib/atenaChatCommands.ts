/** Comandos determinísticos: texto nunca vira URL, endpoint ou código. */
export const ATENA_CHAT_ROUTE_PATHS = {
  map: "/", projects: "/projects", files: "/files", atlas: "/atlas",
  backups: "/admin/backups", atena: "/atena",
} as const;
export type AtenaNavigationTarget = keyof typeof ATENA_CHAT_ROUTE_PATHS;
export type AtenaChatIntent =
  | { kind: "list_projects" }
  | { kind: "navigate"; target: AtenaNavigationTarget }
  | { kind: "gis_analysis" } | { kind: "advanced_gis" }
  | { kind: "help" } | { kind: "unsupported" };

function normalize(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
export function classifyAtenaChatCommand(rawText: string): AtenaChatIntent {
  const text = normalize(rawText);
  if (!text || text.length > 2000) return { kind: "unsupported" };
  if (/https?:\/\/|javascript:|data:|\b(eval|curl|wget|sudo|fetch|select\s+\*|drop\s+table)\b|[`;{}]|\/api\//.test(text)) return { kind: "unsupported" };
  if (/\b(ajuda|o que voce pode fazer|o que voce consegue fazer|comandos disponiveis|como funciona a atena)\b/.test(text)) return { kind: "help" };
  if (/\b(meus projetos|listar projetos|liste projetos|mostrar projetos|mostre projetos|quais projetos|projetos disponiveis)\b/.test(text) || /^projetos?$/.test(text)) return { kind: "list_projects" };
  if (/\b(gerar mapa por modelo|mapa por modelo|gerar mapa tecnico|gerar pdf|exportar mapa|prospeccao)\b/.test(text)) return { kind: "advanced_gis" };
  if (/\b(buffer|intersecc\w*|intersect\w*|zona de distancia)\b/.test(text)) return { kind: "gis_analysis" };
  if (/\b(criar|crie|calcular|calcule|delimitar|delimite|analisar|analise)\b/.test(text) && /\b(ada|aid|aii)\b/.test(text)) return { kind: "advanced_gis" };
  if (/\b(abrir|abra|ir para|va para|acessar|acesse|navegar para|voltar para|mostrar|mostre)\b/.test(text)) {
    if (/\b(backups?)\b/.test(text)) return { kind: "navigate", target: "backups" };
    if (/\b(arquivo|arquivos|documentos)\b/.test(text)) return { kind: "navigate", target: "files" };
    if (/\b(atlas)\b/.test(text)) return { kind: "navigate", target: "atlas" };
    if (/\b(atena)\b/.test(text)) return { kind: "navigate", target: "atena" };
    if (/\b(projetos)\b/.test(text)) return { kind: "navigate", target: "projects" };
    if (/\b(mapa|globo|inicio|pagina inicial)\b/.test(text)) return { kind: "navigate", target: "map" };
  }
  if (/^(mapa|globo|inicio|pagina inicial)$/.test(text)) return { kind: "navigate", target: "map" };
  if (/^atena$/.test(text)) return { kind: "navigate", target: "atena" };
  return { kind: "unsupported" };
}
/** A URL é candidata: resolver contra projects.list antes de consultar o projeto. */
export function parseAtenaProjectId(location: string, search = ""): number | undefined {
  const [path, ...parts] = location.split("?");
  const pathMatch = path.match(/^\/projects\/(\d+)\/?$/);
  const params = new URLSearchParams(parts.length ? parts.join("?") : search);
  const values = params.getAll("projectId");
  if (!pathMatch && values.length !== 1) return undefined;
  const raw = pathMatch?.[1] ?? values[0];
  if (!raw || !/^[1-9]\d*$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}
export function authorizedAtenaProject<T extends { id: number }>(candidate: number | null | undefined, projects: readonly T[] | undefined): T | undefined {
  if (!candidate || !Number.isSafeInteger(candidate) || candidate < 1) return undefined;
  return projects?.find(project => project.id === candidate);
}
export function atenaNavigationPath(target: AtenaNavigationTarget, authorizedProjectId?: number): string {
  const base = ATENA_CHAT_ROUTE_PATHS[target];
  // O mapa baseline não consome projectId; contexto avançado pertence a /atena.
  return target === "atena" && authorizedProjectId && Number.isSafeInteger(authorizedProjectId) && authorizedProjectId > 0
    ? `${base}?projectId=${authorizedProjectId}` : base;
}
export function safeAtenaArtifactUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export type AtenaAnalysisRequest = {
  operation: "vector.intersect_area" | "vector.buffer";
  referenceLayerId?: number; sourceLayerIds: number[]; distanceM?: number; outputName?: string;
};
export function atenaRequestKey(projectId: number, request: AtenaAnalysisRequest): string {
  return JSON.stringify([projectId, request.operation, request.referenceLayerId ?? null, [...request.sourceLayerIds].sort((a, b) => a - b), request.distanceM ?? null, request.outputName?.trim() || null]);
}
export function validAtenaCoordinates(coordinates: readonly number[]): boolean {
  return coordinates.length === 2 && coordinates.every(Number.isFinite) && Math.abs(coordinates[0]) <= 180 && Math.abs(coordinates[1]) <= 90;
}
