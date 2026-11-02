/**
 * ADA, AID e AII como polígonos de referência do projeto.
 * - ADA: polígono, derivado de eixo + largura por lado, ou polígono aprovado.
 * - AID: polígono, derivado do eixo ou da ADA com distância explícita.
 * - AII: união INTEGRAL dos municípios da malha que intersectam a ADA.
 *   Não é recortada pela ADA e não usa buffer.
 * O GIS calcula; a IA não participa. Nada é inventado: sem insumo, o resultado fica bloqueado.
 */
import buffer from "@turf/buffer";
import union from "@turf/union";
import intersect from "@turf/intersect";
import booleanIntersects from "@turf/boolean-intersects";
import kinks from "@turf/kinks";
import { featureCollection } from "@turf/helpers";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import { localProjection, ringAreaM2, unionPolygons, BUFFER_STEPS, type Feat } from "./geo";

export const LIMITS = { halfWidthMinM: 1, halfWidthMaxM: 500, distanceMinM: 1, distanceMaxM: 10000 } as const;

export type AreaResult =
  | { ok: true; geometry: Polygon | MultiPolygon; areaM2: number; params: Record<string, unknown>; warnings: string[] }
  | { ok: false; code: string; message: string };

function bufferSafe(feat: Feature<any>, distanceM: number): Feature<Polygon | MultiPolygon> | null {
  return buffer(feat as any, distanceM, { units: "meters", steps: BUFFER_STEPS }) as any;
}

function validPolygon(g: Polygon | MultiPolygon): boolean {
  const f = { type: "Feature", properties: {}, geometry: g } as any;
  return kinks(f).features.length === 0;
}

/** ADA a partir do eixo: buffer simétrico com `halfWidthM` para cada lado. */
export function deriveAdaFromAxis(axis: Feat, halfWidthM: number): AreaResult {
  if (axis.type !== "LineString") return { ok: false, code: "TIPO_INVALIDO", message: "O eixo da ADA precisa ser uma linha." };
  if (!(halfWidthM >= LIMITS.halfWidthMinM && halfWidthM <= LIMITS.halfWidthMaxM)) {
    return { ok: false, code: "LARGURA_INVALIDA", message: `Largura por lado entre ${LIMITS.halfWidthMinM} e ${LIMITS.halfWidthMaxM} m.` };
  }
  const b = bufferSafe(axis.feature, halfWidthM);
  if (!b) return { ok: false, code: "VAZIO", message: "O buffer do eixo ficou vazio." };
  if (!validPolygon(b.geometry)) {
    return { ok: false, code: "AUTOINTERSECCAO", message: "O buffer do eixo tem autointerseção (curva muito fechada). Revise o eixo ou a largura." };
  }
  const proj = localProjection([axis]);
  return {
    ok: true,
    geometry: b.geometry,
    areaM2: ringAreaM2(b.geometry, proj),
    params: { tipoDeArea: "ADA", origemMetodo: "buffer_eixo", larguraLadoM: halfWidthM, larguraTotalM: halfWidthM * 2 },
    warnings: [],
  };
}

/** AID a partir do eixo ou da ADA, com distância informada. Avisa se não cobrir a ADA. */
export function deriveAid(source: { kind: "eixo"; feat: Feat } | { kind: "ada"; feat: Feat }, distanceM: number, ada?: Feat): AreaResult {
  if (!(distanceM >= LIMITS.distanceMinM && distanceM <= LIMITS.distanceMaxM)) {
    return { ok: false, code: "DISTANCIA_INVALIDA", message: `Distância entre ${LIMITS.distanceMinM} e ${LIMITS.distanceMaxM} m.` };
  }
  const b = bufferSafe(source.feat.feature, distanceM);
  if (!b) return { ok: false, code: "VAZIO", message: "O buffer ficou vazio." };
  if (!validPolygon(b.geometry)) return { ok: false, code: "AUTOINTERSECCAO", message: "A AID tem autointerseção. Revise a origem." };
  const proj = localProjection(ada ? [source.feat, ada] : [source.feat]);
  const warnings: string[] = [];
  if (ada) {
    const inter = intersect(featureCollection([b as any, ada.feature as any]) as any) as any;
    const adaArea = ringAreaM2(ada.feature.geometry as any, proj);
    const covered = inter ? ringAreaM2(inter.geometry, proj) : 0;
    if (adaArea > 0 && covered / adaArea < 0.999) warnings.push("A AID não cobre integralmente a ADA. Revise a distância.");
  }
  return {
    ok: true,
    geometry: b.geometry,
    areaM2: ringAreaM2(b.geometry, proj),
    params: { tipoDeArea: "AID", origemMetodo: source.kind === "eixo" ? "buffer_eixo" : "buffer_ada", distanciaM: distanceM, origemAID: source.kind },
    warnings,
  };
}

export type Municipality = { code: string; name: string; feat: Feat };
export type MunicipalitySelection = { code: string; name: string; status: "selecionado" | "revisar_toque"; overlapAreaM2: number };

/**
 * Seleciona municípios INTEIROS que intersectam a ADA.
 * Interseção com área > 0 seleciona automaticamente. Apenas toque de fronteira vai para revisão humana.
 */
export function selectMunicipalities(ada: Feat, municipalities: Municipality[]) {
  const proj = localProjection([ada, ...municipalities.map(m => m.feat)]);
  const selected: MunicipalitySelection[] = [];
  const review: MunicipalitySelection[] = [];
  for (const m of municipalities) {
    if (!booleanIntersects(ada.feature as any, m.feat.feature as any)) continue;
    const inter = intersect(featureCollection([ada.feature as any, m.feat.feature as any]) as any) as any;
    const overlap = inter ? ringAreaM2(inter.geometry, proj) : 0;
    const row: MunicipalitySelection = { code: m.code, name: m.name, status: overlap > 0 ? "selecionado" : "revisar_toque", overlapAreaM2: overlap };
    (row.status === "selecionado" ? selected : review).push(row);
  }
  return { selected, review };
}

/** AII: união dos municípios selecionados, inteiros. Sem recorte pela ADA e sem buffer. */
export function buildAii(selectedFeats: Feat[]): AreaResult {
  if (selectedFeats.length === 0) return { ok: false, code: "SEM_MUNICIPIOS", message: "Nenhum município selecionado para a AII." };
  const u = unionPolygons(selectedFeats);
  if (!u) return { ok: false, code: "VAZIO", message: "União vazia." };
  const proj = localProjection(selectedFeats);
  return {
    ok: true,
    geometry: u.geometry as any,
    areaM2: ringAreaM2(u.geometry as any, proj),
    params: { tipoDeArea: "AII", origemMetodo: "municipios_intersectados_pela_ada", municipios: selectedFeats.length },
    warnings: [],
  };
}

/** Status da AII: bloqueado com motivo quando não há malha municipal validada. */
export function aiiStatus(municipalityMeshAvailable: boolean): { status: "bloqueado" | "disponivel"; reason?: string } {
  if (!municipalityMeshAvailable) return { status: "bloqueado", reason: "Malha municipal necessária para delimitar AII" };
  return { status: "disponivel" };
}


/** Padrão aprovado: AID = 250 m no entorno da ADA (pode ser substituída por polígono informado). */
export const AID_PADRAO = { origem: "ada" as const, distanciaM: 250 };

/**
 * Malha municipal de referência: a versão MAIS RECENTE publicada pelo IBGE.
 * Atualizar quando o IBGE publicar nova versão (publicação anual, normalmente em março).
 * Fonte verificada em 31/10/2026: IBGE divulgou a Malha Municipal Digital 2025 em 30/03/2026.
 */
export const MALHA_IBGE_REFERENCIA = {
  anoMaisRecente: 2025,
  fonte: "IBGE – Malha Municipal Digital 2025",
  divulgacao: "30/03/2026",
} as const;

/** Verifica se a malha declarada é a versão mais recente do IBGE. */
export function checkMalhaVersion(ano: number | undefined): { ok: true } | { ok: false; reason: string } {
  if (ano == null) {
    return { ok: false, reason: `Informe o ano da malha municipal. A AII exige a versão mais recente do IBGE (${MALHA_IBGE_REFERENCIA.anoMaisRecente}).` };
  }
  if (ano !== MALHA_IBGE_REFERENCIA.anoMaisRecente) {
    return { ok: false, reason: `Malha de ${ano} não é a versão mais recente do IBGE (${MALHA_IBGE_REFERENCIA.anoMaisRecente}). Use a malha ${MALHA_IBGE_REFERENCIA.anoMaisRecente}.` };
  }
  return { ok: true };
}
