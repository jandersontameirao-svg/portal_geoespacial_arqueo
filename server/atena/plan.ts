/**
 * Monta o plano de uma análise a partir de um pedido estruturado. Não executa
 * nada. Quando falta informação indispensável, devolve perguntas objetivas em
 * vez de escolher silenciosamente uma camada, distância ou projeção.
 */
import { skillVersions, type SkillId, type StructuredRequest } from "./skills";

export const ACCEPTED_CRS = ["EPSG:4674", "EPSG:4326"] as const;

export type LayerInfo = {
  id: number;
  name: string;
  crs: string;
  isGroup: boolean;
  layerType: string;
  featureCount: number;
};

export type Plan = {
  planVersion: 1;
  skill: SkillId;
  skillVersion: string;
  referenceLayer: { id: number; name: string; crs: string; featureCount: number } | null;
  sourceLayers: Array<{ id: number; name: string; crs: string; featureCount: number }>;
  parameters: {
    distanceM: number | null;
    unit: "m";
    areaMethod: string;
    bufferMethod: string;
  };
  outputName: string;
  steps: string[];
};

export type PlanResult =
  | { status: "ready"; plan: Plan }
  | { status: "needs_input"; questions: string[] }
  | { status: "error"; errors: string[] };

const AREA_METHOD = "Projeção UTM SIRGAS 2000 local pela zona do extent; áreas em m²";
const BUFFER_METHOD = "Buffer geodésico (turf), 128 passos por quarto de círculo";

export function buildPlan(req: StructuredRequest, layers: LayerInfo[]): PlanResult {
  const byId = new Map(layers.map(l => [l.id, l]));
  const errors: string[] = [];
  const questions: string[] = [];
  const skill = req.operation;
  if (new Set(req.sourceLayerIds).size !== req.sourceLayerIds.length) return { status: "error", errors: ["Camadas de origem duplicadas: selecione cada camada apenas uma vez."] };

  const checkLayer = (id: number, role: string): LayerInfo | null => {
    const l = byId.get(id);
    if (!l) { errors.push(`Camada ${id} (${role}) não pertence a este projeto.`); return null; }
    if (l.isGroup) { errors.push(`"${l.name}" é um grupo, não uma camada de dados.`); return null; }
    if (l.layerType !== "vector") { errors.push(`"${l.name}" não é vetorial; a Atena analisa apenas vetores nesta versão.`); return null; }
    if (!(ACCEPTED_CRS as readonly string[]).includes(l.crs)) {
      errors.push(`"${l.name}" usa ${l.crs}. Sistemas aceitos: ${ACCEPTED_CRS.join(", ")}. Reprojete a camada antes da análise.`);
      return null;
    }
    return l;
  };

  let reference: LayerInfo | null = null;
  if (skill === "vector.intersect_area") {
    if (req.referenceLayerId == null) {
      questions.push("Qual é a camada de área de referência (por exemplo, a ADA)? Informe a camada.");
    } else {
      reference = checkLayer(req.referenceLayerId, "referência");
    }
  }

  const sources: LayerInfo[] = [];
  for (const id of req.sourceLayerIds) {
    if (reference && id === reference.id) {
      errors.push("A camada de referência não pode ser também camada de origem.");
      continue;
    }
    const l = checkLayer(id, "origem");
    if (l) sources.push(l);
  }

  let distanceM: number | null = null;
  if (skill === "vector.buffer") {
    if (req.distanceM == null) questions.push("Qual distância do buffer, em metros?");
    else distanceM = req.distanceM;
  }

  if (errors.length > 0) return { status: "error", errors };
  if (questions.length > 0) return { status: "needs_input", questions };

  const outputName = req.outputName ?? (skill === "vector.intersect_area"
    ? `Interseção com ${reference!.name}`
    : `Buffer ${distanceM} m`);

  const steps = skill === "vector.intersect_area"
    ? ["Verificar CRS, ordem, envelope e validade", "Calcular interseção", "Calcular áreas", "Gravar camadas de resultado", "Gerar tabela de áreas"]
    : ["Verificar CRS, ordem, envelope e validade", "Calcular buffer", "Calcular áreas", "Gravar camadas de resultado"];

  const pick = (l: LayerInfo) => ({ id: l.id, name: l.name, crs: l.crs, featureCount: l.featureCount });
  const plan: Plan = {
    planVersion: 1,
    skill,
    skillVersion: skillVersions()[skill],
    referenceLayer: reference ? pick(reference) : null,
    sourceLayers: sources.map(pick),
    parameters: { distanceM, unit: "m", areaMethod: AREA_METHOD, bufferMethod: BUFFER_METHOD },
    outputName,
    steps,
  };
  return { status: "ready", plan };
}
