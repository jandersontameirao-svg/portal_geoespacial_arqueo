/**
 * Registro de habilidades da Atena. Cada habilidade é uma ferramenta GIS
 * implementada no código (não um arquivo de instruções). A IA só pode escolher
 * entre estas entradas, com parâmetros validados por zod.
 *
 * Versão: incrementar `version` sempre que o comportamento mudar. A versão é
 * gravada em cada execução para rastreabilidade.
 */
import { z } from "zod";

export const ATENA_CODE_VERSION = process.env.ATENA_CODE_VERSION ?? "atena-0.1.0";

export const SKILLS = {
  "vector.intersect_area": {
    version: "1.0.0",
    title: "Interseção com área de referência",
    purpose: "Calcula, para cada polígono de origem, a parte que cai dentro da área de referência (ex.: ADA) e as áreas total e interna.",
    inputs: "Camada de referência (polígonos) e camadas de origem (polígonos).",
    parameters: "Nenhum. Áreas em m² por projeção de igual área (LAEA) centrada no extent.",
    permissions: "write (cria grupo e camadas de resultado); leitura das camadas do projeto.",
    validations: [
      "CRS aceito: EPSG:4674 ou EPSG:4326.",
      "Ordem [lat,lng] e envelope do Brasil.",
      "Polígonos sem autointerseção e fechados.",
      "Limite de extent e de feições.",
    ],
    outputs: "Uma camada de resultado com as partes interceptadas, e uma tabela de áreas.",
    sideEffects: "Cria um grupo 'Atena · execução' com novas camadas. Não altera camadas existentes.",
    requiresConfirmation: false,
    instructions:
      "Use quando o pedido pedir sítios, polígonos ou áreas que intersectam uma área de referência. " +
      "Sempre informe a área de referência e as camadas de origem. Não use para pontos ou linhas nesta versão.",
  },
  "vector.buffer": {
    version: "1.0.0",
    title: "Zona de distância (buffer)",
    purpose: "Gera zonas de distância em torno de pontos, linhas ou polígonos.",
    inputs: "Camadas de origem (pontos, linhas ou polígonos).",
    parameters: "Distância em metros (obrigatória, entre 1 e 10.000).",
    permissions: "write (cria grupo e camadas de resultado).",
    validations: [
      "Distância informada e positiva.",
      "CRS, ordem, envelope e validade das geometrias.",
      "Limite de extent e de feições.",
    ],
    outputs: "Uma camada de zonas por camada de origem, com área de cada zona.",
    sideEffects: "Cria um grupo 'Atena · execução' com novas camadas. Não altera camadas existentes.",
    requiresConfirmation: false,
    instructions:
      "Use quando o pedido pedir distância, faixa ou zona de influência. " +
      "Exija a distância e a unidade. Se a unidade não for informada, pergunte antes de executar.",
  },
} as const;

export type SkillId = keyof typeof SKILLS;

export const SKILL_IDS = Object.keys(SKILLS) as [SkillId, ...SkillId[]];

export const skillVersions = (): Record<string, string> =>
  Object.fromEntries(Object.entries(SKILLS).map(([id, s]) => [id, s.version]));

export const structuredRequestSchema = z.object({
  operation: z.enum(["vector.intersect_area", "vector.buffer"]),
  referenceLayerId: z.number().int().positive().optional(),
  sourceLayerIds: z.array(z.number().int().positive()).min(1).max(10),
  distanceM: z.number().positive().max(10000).optional(),
  outputName: z.string().trim().min(1).max(120).optional(),
});

export type StructuredRequest = z.infer<typeof structuredRequestSchema>;
