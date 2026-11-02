/**
 * Catálogo de modelos cartográficos da Atena. Versionado, validado com zod.
 * Estilo e layout são configuráveis; critérios científicos NÃO são definidos aqui.
 * Modelos bloqueados informam o motivo real; nenhum critério é inventado.
 *
 * Ordem do catálogo é fixa (ver TEMPLATE_ORDER) e mudanças de significado exigem nova versão.
 */
import { z } from "zod";

export const TEMPLATE_ORDER = [
  "areas_influencia",
  "sitios_arqueologicos",
  "unidades_prospeccao",
  "relevo_curvas_nivel",
  "pocos_teste_preditivo",
  "coerencia_arqueologica",
] as const;
export type TemplateId = (typeof TEMPLATE_ORDER)[number];

const geometryType = z.enum(["Point", "LineString", "Polygon"]);

const roleSchema = z.object({
  role: z.string().min(1),
  label: z.string().min(1),
  geometryTypes: z.array(geometryType).min(1),
  optional: z.boolean(),
  description: z.string().min(1),
});

const templateSchema = z.object({
  id: z.enum(TEMPLATE_ORDER),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  title: z.string().min(1),
  purpose: z.string().min(1),
  status: z.enum(["available", "blocked"]),
  blockedReason: z.string().min(1).optional(),
  roles: z.array(roleSchema).min(1),
  layout: z.object({
    pageSizes: z.array(z.enum(["A3", "A4"])).min(1),
    orientations: z.array(z.enum(["landscape", "portrait"])).min(1),
    defaultPageSize: z.enum(["A3", "A4"]),
    defaultOrientation: z.enum(["landscape", "portrait"]),
  }),
  basemap: z.enum(["none"]),
  notes: z.array(z.string()),
});

export type TemplateRole = z.infer<typeof roleSchema>;
export type Template = z.infer<typeof templateSchema>;

const RAW: Template[] = [
  {
    id: "areas_influencia",
    version: "1.0.0",
    title: "Áreas de influência (ADA, AID e AII)",
    purpose: "Mapa de ADA, AID e AII com limites municipais e fontes.",
    status: "available",
    roles: [
      { role: "ADA", label: "ADA", geometryTypes: ["Polygon", "LineString"], optional: false, description: "Polígono da ADA, ou eixo da linha de transmissão com largura por lado." },
      { role: "AID", label: "AID", geometryTypes: ["Polygon"], optional: true, description: "Polígono da AID. Se ausente, é derivada da ADA com 250 m no entorno (padrão aprovado)." },
      { role: "AII", label: "AII", geometryTypes: ["Polygon"], optional: true, description: "Municípios integrais interceptados pela ADA. Exige a malha municipal mais recente do IBGE (2025)." },
    ],
    layout: { pageSizes: ["A3", "A4"], orientations: ["landscape", "portrait"], defaultPageSize: "A3", defaultOrientation: "landscape" },
    basemap: "none",
    notes: ["AII nunca é gerada por buffer.", "AID padrão: 250 m no entorno da ADA.", "AII exige a malha municipal mais recente do IBGE; sem ela, fica bloqueada e o mapa indica a ausência."],
  },
  {
    id: "sitios_arqueologicos",
    version: "1.0.0",
    title: "Sítios arqueológicos",
    purpose: "Ocorrências de sítios arqueológicos sobre a ADA.",
    status: "available",
    roles: [
      { role: "sitios", label: "Sítios", geometryTypes: ["Point", "Polygon"], optional: false, description: "Ocorrências pontuais ou perímetros de sítios." },
      { role: "ADA", label: "ADA", geometryTypes: ["Polygon"], optional: true, description: "Área de referência para destacar sítios na ADA." },
    ],
    layout: { pageSizes: ["A3", "A4"], orientations: ["landscape", "portrait"], defaultPageSize: "A3", defaultOrientation: "landscape" },
    basemap: "none",
    notes: ["Símbolos só com atributos existentes nos dados."],
  },
  {
    id: "unidades_prospeccao",
    version: "1.0.0",
    title: "Unidades de prospecção",
    purpose: "Unidades de prospecção arqueológica sobre a ADA.",
    status: "available",
    roles: [
      { role: "unidades", label: "Unidades", geometryTypes: ["Point", "LineString", "Polygon"], optional: false, description: "Unidades de prospecção como pontos, linhas ou polígonos." },
      { role: "ADA", label: "ADA", geometryTypes: ["Polygon"], optional: true, description: "Área de referência." },
    ],
    layout: { pageSizes: ["A3", "A4"], orientations: ["landscape", "portrait"], defaultPageSize: "A4", defaultOrientation: "landscape" },
    basemap: "none",
    notes: ["Identificadores e classes só quando presentes nos atributos."],
  },
  {
    id: "relevo_curvas_nivel",
    version: "1.0.0",
    title: "Relevo e curvas de nível",
    purpose: "Relevo e curvas de nível da área de estudo.",
    status: "blocked",
    blockedReason: "Falta fonte altimétrica autorizada, documentação da resolução e critérios de intervalo das curvas.",
    roles: [{ role: "ADA", label: "ADA", geometryTypes: ["Polygon"], optional: false, description: "Área de estudo." }],
    layout: { pageSizes: ["A3", "A4"], orientations: ["landscape", "portrait"], defaultPageSize: "A3", defaultOrientation: "landscape" },
    basemap: "none",
    notes: [],
  },
  {
    id: "pocos_teste_preditivo",
    version: "1.0.0",
    title: "Mapa preditivo de poços-teste",
    purpose: "Áreas com potencial preditivo para poços-teste.",
    status: "blocked",
    blockedReason: "Falta método de predição validado pela equipe e suas limitações.",
    roles: [{ role: "ADA", label: "ADA", geometryTypes: ["Polygon"], optional: false, description: "Área de estudo." }],
    layout: { pageSizes: ["A3", "A4"], orientations: ["landscape", "portrait"], defaultPageSize: "A3", defaultOrientation: "landscape" },
    basemap: "none",
    notes: [],
  },
  {
    id: "coerencia_arqueologica",
    version: "1.0.0",
    title: "Coerência arqueológica",
    purpose: "Mapa de coerência arqueológica da área de estudo.",
    status: "blocked",
    blockedReason: "Faltam critérios científicos de coerência arqueológica e avaliação técnica.",
    roles: [{ role: "ADA", label: "ADA", geometryTypes: ["Polygon"], optional: false, description: "Área de estudo." }],
    layout: { pageSizes: ["A3", "A4"], orientations: ["landscape", "portrait"], defaultPageSize: "A3", defaultOrientation: "landscape" },
    basemap: "none",
    notes: [],
  },
];

// Valida o catálogo na importação: falha cedo se algo estiver incorreto.
export const TEMPLATES: Template[] = RAW.map(t => templateSchema.parse(t));

// Invariantes: ordem fixa, bloqueados sempre com motivo
for (let i = 0; i < TEMPLATE_ORDER.length; i++) {
  if (TEMPLATES[i].id !== TEMPLATE_ORDER[i]) throw new Error("Catálogo fora de ordem");
}
for (const t of TEMPLATES) {
  if (t.status === "blocked" && !t.blockedReason) throw new Error(`Modelo bloqueado sem motivo: ${t.id}`);
}

export function getTemplate(id: string): Template {
  const found = TEMPLATES.find(t => t.id === id);
  if (!found) throw new Error(`Modelo cartográfico desconhecido: ${id}`);
  return found;
}

/** Verifica quais papéis obrigatórios faltam para um modelo, dado o que o projeto tem. */
export function checkRequirements(template: Template, availableRoles: string[]) {
  const missing = template.roles
    .filter(r => !r.optional && !availableRoles.includes(r.role))
    .map(r => ({ role: r.role, label: r.label, reason: `Falta a camada da ${r.label} (${r.description})` }));
  return { ready: template.status === "available" && missing.length === 0, missing };
}
