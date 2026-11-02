/**
 * Executor das análises da Atena. Cada execução:
 * - tem chave de idempotência (projeto + plano + dados de entrada), para que o
 *   mesmo pedido não gere resultados duplicados;
 * - registra cada etapa com duração e status;
 * - respeita cancelamento e limite de tempo entre etapas;
 * - grava os resultados de uma vez, em um grupo próprio, e desfaz a escrita se
 *   algo falhar (nenhuma camada parcial fica no projeto).
 * Camadas e geometrias de origem nunca são alteradas.
 */
import { collectCoordinatePositions } from "../../shared/geometry-coordinates";
import { createHash } from "crypto";
import { eq, and, inArray, desc } from "drizzle-orm";
import { getDb } from "../db";
import { withLayerHierarchyLock } from "../layersRouter";
import { atenaRuns, layers, geometries } from "../../drizzle/schema";
import { buildPlan, type LayerInfo, type Plan } from "./plan";
import { ATENA_CODE_VERSION, skillVersions, structuredRequestSchema, type StructuredRequest } from "./skills";
import {
  parseRows, localProjection, extentKm2, unionPolygons, intersectWithReference, bufferFeature,
  toStoredPolygons, ringAreaM2, MAX_EXTENT_KM2, MAX_FEATURES, type SourceRow, type Feat, type GeoIssue,
} from "./geo";

import { selectLayerRows, layerFeatureCollection, featureFromStored, collectionBounds, resultMetadata } from "./workspace";

export const RUN_TIMEOUT_MS = 60_000;
const MAX_STEPS = 10;
const ACTIVE = ["queued", "running", "cancel_requested"] as const;

type Step = { name: string; status: "done" | "failed" | "cancelled" | "skipped"; startedAt: string; finishedAt: string; durationMs: number; message?: string };

export class RunError extends Error {
  constructor(message: string, public code = "RUN_FAILED", public issues: GeoIssue[] = []) { super(message); }
}

const inflight = new Map<string, Promise<void>>();

/** Lê coluna JSON que pode voltar como string (inclusive codificada duas vezes). */
export function jsonValue<T = any>(v: unknown): T {
  let out: any = v;
  for (let i = 0; i < 3 && typeof out === 'string'; i++) {
    try { out = JSON.parse(out); } catch { break; }
  }
  return out as T;
}

export function sha256(s: string) { return createHash("sha256").update(s).digest("hex"); }

export function scopeGeometryRowsToProject<T extends { projectId: number }>(rows: T[], projectId: number): T[] {
  return rows.filter(row => row.projectId === projectId);
}

/** Lê linhas de geometria de um conjunto de camadas, marcando a camada de origem. */
export async function loadGeometryRows(projectId: number, layerIds: number[]): Promise<SourceRow[]> {
  if (!layerIds.length) return [];
  const ids = Array.from(new Set(layerIds));
  if (ids.length > 30) throw new RunError("Limite de camadas excedido", "LIMIT");
  const db = await getDb();
  if (!db) throw new RunError("Banco de dados indisponível");
  const projectLayers = await db.select().from(layers).where(and(eq(layers.projectId, projectId), inArray(layers.id, ids)));
  if (projectLayers.length !== ids.length || projectLayers.some(layer => layer.isGroup || layer.layerType !== "vector")) throw new RunError("Camada não pertence ao projeto ou não é vetorial folha.", "INPUT_ACCESS");
  if (projectLayers.some(layer => !["EPSG:4326", "EPSG:4674"].includes(layer.crs))) throw new RunError("CRS incompatível: transforme explicitamente a entrada para EPSG:4326 ou EPSG:4674.", "CRS");
  const rows = await db.select().from(geometries).where(and(eq(geometries.projectId, projectId), inArray(geometries.layerId, ids))).limit(MAX_FEATURES + 1);
  const sources = scopeGeometryRowsToProject(rows, projectId).map(row => ({ id: row.id, name: row.name, type: row.type, coordinates: row.coordinates, layerId: row.layerId }));
  const selected = projectLayers.flatMap(layer => selectLayerRows(layer, sources));
  if (rows.length > MAX_FEATURES || selected.length > MAX_FEATURES) throw new RunError(`Limite de ${MAX_FEATURES} feições excedido.`, "LIMIT");
  return selected;
}

/** Impressão digital dos dados de entrada: muda se qualquer geometria mudar. */
export function inputFingerprint(rows: SourceRow[]) {
  const sorted = [...rows].sort((a, b) => (a.layerId ?? 0) - (b.layerId ?? 0) || a.id - b.id);
  return sha256(JSON.stringify(sorted.map(r => [r.id, r.name, r.type, r.coordinates, r.layerId])));
}

export async function loadProjectLayers(projectId: number): Promise<LayerInfo[]> {
  const db = await getDb();
  if (!db) throw new RunError("Banco de dados indisponível");
  const rows = await db.select().from(layers).where(eq(layers.projectId, projectId));
  const geos = await db.select({ layerId: geometries.layerId }).from(geometries).where(eq(geometries.projectId, projectId));
  const counts = new Map<number, number>();
  for (const g of geos) if (g.layerId != null) counts.set(g.layerId, (counts.get(g.layerId) ?? 0) + 1);
  return rows.map(l => ({
    id: l.id, name: l.name, crs: l.crs, isGroup: l.isGroup, layerType: l.layerType, featureCount: counts.get(l.id) ?? ((!l.isGroup && l.layerType === "vector") ? layerFeatureCollection(l.layerData)?.features.length ?? 0 : 0),
  }));
}

/** Valida o pedido e devolve o plano pronto ou perguntas/erros. */
export async function planRequest(projectId: number, input: unknown) {
  const req: StructuredRequest = structuredRequestSchema.parse(input);
  const layerInfos = await loadProjectLayers(projectId);
  return buildPlan(req, layerInfos);
}

export function runKey(projectId: number, plan: Plan, fingerprint: string) {
  return sha256(JSON.stringify({ projectId, plan, fingerprint, code: ATENA_CODE_VERSION }));
}

/**
 * Cria a execução (ou reaproveita uma idêntica ainda existente) e a dispara em
 * segundo plano. Retorna o id e se foi reaproveitada.
 */
export async function createRun(args: { projectId: number; userId: number; requestText: string | null; plan: Plan }) {
  const db = await getDb();
  if (!db) throw new RunError("Banco de dados indisponível");
  const refIds = args.plan.referenceLayer ? [args.plan.referenceLayer.id] : [];
  const srcIds = args.plan.sourceLayers.map(s => s.id);
  const fingerprint = inputFingerprint(await loadGeometryRows(args.projectId, [...refIds, ...srcIds]));
  const key = runKey(args.projectId, args.plan, fingerprint);

  const created = await withLayerHierarchyLock(args.projectId, async tx => {
    const existing = await tx.select().from(atenaRuns)
      .where(and(eq(atenaRuns.projectId, args.projectId), eq(atenaRuns.idempotencyKey, key))).orderBy(desc(atenaRuns.id)).for("update");
    const reusable = existing.find(r => r.status === "completed" || (ACTIVE as readonly string[]).includes(r.status));
    if (reusable) return { runId: reusable.id, reused: true, status: reusable.status };
    const inserted = await tx.insert(atenaRuns).values({ projectId: args.projectId, userId: args.userId,
      status: "queued", requestText: args.requestText, plan: args.plan, idempotencyKey: key,
      codeVersion: ATENA_CODE_VERSION, skillVersions: skillVersions(), inputs: { fingerprint } }).$returningId();
    if (!inserted[0]?.id) throw new RunError("Falha ao criar execução");
    return { runId: inserted[0].id, reused: false, status: "queued" as const };
  });
  if (!created.reused) startRun(created.runId);
  return created;
}

/** Dispara a execução uma vez por run (trava por execução no processo). */
export function startRun(runId: number) {
  if (inflight.has(String(runId))) return inflight.get(String(runId))!;
  const p = executeRun(runId).catch(() => undefined).finally(() => inflight.delete(String(runId)));
  inflight.set(String(runId), p);
  return p;
}

async function setStatus(runId: number, patch: Partial<typeof atenaRuns.$inferInsert>) {
  const db = await getDb();
  if (!db) return;
  await db.update(atenaRuns).set(patch as any).where(eq(atenaRuns.id, runId));
}

async function readStatus(runId: number) {
  const db = await getDb();
  if (!db) return null;
  const [r] = await db.select({ status: atenaRuns.status }).from(atenaRuns).where(eq(atenaRuns.id, runId));
  return r?.status ?? null;
}

export async function requestCancel(runId: number) {
  const db = await getDb();
  if (!db) throw new RunError("Banco de dados indisponível");
  await db.update(atenaRuns).set({ status: "cancelled", finishedAt: new Date() }).where(and(eq(atenaRuns.id, runId), eq(atenaRuns.status, "queued")));
  await db.update(atenaRuns).set({ status: "cancel_requested" }).where(and(eq(atenaRuns.id, runId), eq(atenaRuns.status, "running")));
  return readStatus(runId);
}

/** Executa o pipeline. Chamado pelo startRun; testes podem aguardar a Promise. */
export async function executeRun(runId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const run = await db.transaction(async tx => {
    const [candidate] = await tx.select().from(atenaRuns).where(eq(atenaRuns.id, runId)).for("update");
    if (!candidate || candidate.status !== "queued") return null;
    await tx.update(atenaRuns).set({ status: "running", startedAt: new Date() }).where(eq(atenaRuns.id, runId));
    return candidate;
  });
  if (!run) return;

  const started = Date.now();
  const steps: Step[] = [];
  const createdIds = { group: null as number | null, layers: [] as number[], geometries: [] as number[] };


  const step = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
    if (steps.length >= MAX_STEPS) throw new RunError("Limite de etapas excedido");
    if (Date.now() - started > RUN_TIMEOUT_MS) throw new RunError("Tempo limite da execução excedido", "TIMEOUT");
    if ((await readStatus(runId)) === "cancel_requested") throw new RunError("Execução cancelada", "CANCELLED");
    const t0 = Date.now(); const s0 = new Date().toISOString();
    try {
      const out = await fn();
      steps.push({ name, status: "done", startedAt: s0, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0 });
      return out;
    } catch (e) {
      steps.push({ name, status: "failed", startedAt: s0, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, message: (e as Error).message });
      throw e;
    }
  };

  try {
    const plan = jsonValue<Plan>(run.plan);
    const refIds = plan.referenceLayer ? [plan.referenceLayer.id] : [];
    const srcIds = plan.sourceLayers.map(s => s.id);

    // 1. Verificação de dados e de integridade
    const rows = await step("Verificar dados de entrada", async () => {
      const r = await loadGeometryRows(run.projectId, [...refIds, ...srcIds]);
      let vertexCount = 0;
      for (const row of r) {
        vertexCount += collectCoordinatePositions(jsonValue(row.coordinates)).length;
        if (vertexCount > 50000) throw new RunError("Entrada excede 50000 vértices. Simplifique explicitamente uma cópia antes da análise.", "LIMIT");
      }
      const { feats, issues } = parseRows(r);
      if (issues.length > 0) throw new RunError(`${issues.length} geometria(s) inválida(s).`, "GEOMETRY_INVALID", issues);
      if (!feats.length) throw new RunError("Sem geometrias para analisar.", "EMPTY");
      if (feats.length > MAX_FEATURES) throw new RunError(`Limite de ${MAX_FEATURES} feições excedido (${feats.length}).`, "LIMIT");
      return r;
    });
    const fingerprint = inputFingerprint(rows);
    const inputsFp = jsonValue<any>(run.inputs)?.fingerprint;
    const alerts: string[] = [];
    if (inputsFp && inputsFp !== fingerprint) throw new RunError("Os dados de entrada mudaram após o pedido. Refaça o pedido.", "STALE_INPUT");

    const byLayer = (lid: number) => rows.filter(r => r.layerId === lid);
    const parsed = parseRows(rows).feats;
    const featsOf = (lid: number) => parsed.filter(f => byLayer(lid).some(r => r.id === f.id));
    const refFeats: Feat[] = refIds.length ? featsOf(refIds[0]) : [];
    const srcFeats: Map<number, Feat[]> = new Map(srcIds.map(id => [id, featsOf(id)]));
    const allFeats = [...refFeats, ...Array.from(srcFeats.values()).flat()];

    // 2. Projeção e extent
    const proj = await step("Conferir sistema de referência e extent", () => {
      const p = localProjection(allFeats);
      const km2 = extentKm2(allFeats, p);
      if (km2 > MAX_EXTENT_KM2) throw new RunError(`Extent de ${km2.toFixed(0)} km² excede o limite de ${MAX_EXTENT_KM2} km².`, "LIMIT");
      return p;
    });

    // 3. Operação
    const result = await step("Executar operação", () => {
      if (plan.skill === "vector.intersect_area") {
        const ref = unionPolygons(refFeats);
        if (!ref) throw new RunError("Área de referência vazia.");
        const bad = Array.from(srcFeats.values()).flat().filter(f => f.type !== "Polygon" && f.type !== "MultiPolygon");
        if (bad.length) throw new RunError("A interseção nesta versão aceita apenas polígonos de origem.", "UNSUPPORTED");
        const table = intersectWithReference(Array.from(srcFeats.values()).flat(), ref as any, proj);
        return { ref, table };
      }
      const d = plan.parameters.distanceM!;
      const zones = Array.from(srcFeats.entries()).map(([lid, fs]) => ({
        lid,
        features: fs.map(f => { const geom = bufferFeature(f, d); if (!geom) throw new RunError(`Buffer vazio para ${f.name}; saída não omitida.`); return { f, geom }; }),
      }));
      return { zones, distanceM: d };
    });

    // 4. Publicação atômica: camadas, FC, geometrias e histórico.
    await withLayerHierarchyLock(run.projectId, async tx => {
    const [lockedRun] = await tx.select().from(atenaRuns).where(eq(atenaRuns.id, runId)).for("update");
    if (lockedRun?.status !== "running") throw new RunError("Execução cancelada", "CANCELLED");
    if (Date.now() - started > RUN_TIMEOUT_MS) throw new RunError("Tempo limite excedido", "TIMEOUT");
    const computed = await (async () => {
      const db2 = tx;
      const groupName = `Atena · ${plan.outputName.slice(0, 60)} · exec ${runId}`;
      const gi: any = await db2.insert(layers).values({
        projectId: run.projectId, createdBy: run.userId, name: groupName, layerType: "vector",
        isGroup: true, parentId: null, sortOrder: 0, isVisible: true,
        metadata: { atenaRunId: runId, role: "group" } as any,
      });
      createdIds.group = Number(gi[0]?.insertId || 0);
      if (!createdIds.group) throw new RunError("Falha ao criar grupo de saída.");

      const geoRows: Array<typeof geometries.$inferInsert> = [];
      const layerDefs: Array<{ name: string; role: string; fc: number; area: number; lid: number }> = [];
      const addLayer = async (name: string, role: string, pieces: Array<{ name: string; polys: string[]; area: number }>) => {
        const li: any = await db2.insert(layers).values({
          projectId: run.projectId, createdBy: run.userId, name, layerType: "vector", isGroup: false,
          parentId: createdIds.group, sortOrder: createdIds.layers.length + 1, isVisible: true,
          metadata: { atenaRunId: runId, role, skill: plan.skill, skillVersion: plan.skillVersion, planVersion: plan.planVersion } as any,
        });
        const lid = Number(li[0]?.insertId || 0);
        if (!lid) throw new RunError("Falha ao criar camada de saída.");
        createdIds.layers.push(lid);
        let fc = 0, area = 0;
        for (const p of pieces) {
          for (const coords of p.polys) {
            geoRows.push({ projectId: run.projectId, userId: run.userId, type: "polygon", name: p.name.slice(0, 250),
              description: `Execução Atena ${runId} · ${plan.skill} v${plan.skillVersion}`, coordinates: coords,
              color: role === "result" ? "#f97316" : "#3b82f6", visible: 1, opacity: 100, layerId: lid });
            fc++;
          }
          area += p.area;
        }
        layerDefs.push({ name, role, fc, area, lid });
      };

      let table: any[] = [];
      let projection: any = { ...proj };
      if (plan.skill === "vector.intersect_area") {
        const r = result as { ref: any; table: ReturnType<typeof intersectWithReference> };
        const pieces = r.table.filter(t => t.pieces).map(t => ({
          name: `${t.sourceName} ∩ ${plan.referenceLayer!.name}`,
          polys: toStoredPolygons(t.pieces!.geometry as any),
          area: t.intersectionAreaM2,
        }));
        await addLayer(`Interseção com ${plan.referenceLayer!.name}`, "result", pieces);
        table = r.table.map(t => ({
          sourceId: t.sourceId, sourceName: t.sourceName, sourceAreaM2: t.sourceAreaM2,
          intersectionAreaM2: t.intersectionAreaM2, percentInside: t.percentInside,
        }));
        table.push({ sourceId: 0, sourceName: "Área de referência", sourceAreaM2: ringAreaM2(r.ref.geometry, proj), intersectionAreaM2: null, percentInside: null });
      } else {
        const r = result as { zones: Array<{ lid: number; features: Array<{ f: Feat; geom: any }> }>; distanceM: number };
        for (const z of r.zones) {
          const srcLayer = plan.sourceLayers.find(s => s.id === z.lid)!;
          const pieces = z.features.map(({ f, geom }) => ({ name: `${f.name} · ${r.distanceM} m`, polys: toStoredPolygons(geom.geometry), area: ringAreaM2(geom.geometry, proj) }));
          await addLayer(`${plan.outputName} · ${srcLayer.name}`, "result", pieces);
          for (const z2 of z.features) table.push({ sourceId: z.lid, sourceName: z2.f.name, sourceAreaM2: ringAreaM2(z2.geom.geometry, proj), intersectionAreaM2: null, percentInside: null });
        }
      }

      if (geoRows.length > 0) {
        try {
          if (geoRows.length > MAX_FEATURES) throw new RunError("Saída excede limite de feições", "LIMIT");
          await tx.insert(geometries).values(geoRows);
        } catch (e) {
          throw new RunError(`Falha ao gravar resultados: ${(e as Error).message}`, "WRITE_FAILED");
        }
      }
      for (const definition of layerDefs) {
        const collection = { type: "FeatureCollection" as const, features: geoRows.filter(row => row.layerId === definition.lid).map(row => featureFromStored(row, { atenaRunId: runId, role: definition.role })) };
        await tx.update(layers).set({ layerData: collection, crs: "EPSG:4326", bounds: collectionBounds(collection), isPublic: false,
          defaultStyle: { color: "#f97316", weight: 2, fillOpacity: 0.25 },
          metadata: { ...resultMetadata({ operation: plan.skill, runId, sourceLayerIds: [...refIds, ...srcIds], parameters: plan.parameters, projection: proj, skillVersion: plan.skillVersion }), atenaRunId: runId, role: definition.role, areaSquareMeters: definition.area },
        }).where(eq(layers.id, definition.lid));
      }
      return { layerDefs, table, projection, groupId: createdIds.group };
    })();

    // 5. Conclusão
    const outputs = {
      groupLayerId: computed.groupId,
      layers: computed.layerDefs.map(l => ({ id: l.lid, name: l.name, role: l.role, featureCount: l.fc, areaM2: l.area })),
      table: computed.table,
      projection: computed.projection,
      referenceArea: plan.referenceLayer ? { name: plan.referenceLayer.name, areaM2: refFeats.length ? unionAreaM2(refFeats, proj) : 0 } : null,
    };
    steps.push({ name: "Publicar resultados transacionalmente", status: "done", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: Date.now() - started });
    await tx.update(atenaRuns).set({
      status: "completed", steps: steps as any, outputs: outputs as any, alerts: alerts as any,
      inputs: { fingerprint, layers: [plan.referenceLayer, ...plan.sourceLayers].filter(Boolean) } as any,
      finishedAt: new Date(),
    }).where(eq(atenaRuns.id, runId));
    });
  } catch (e) {
    const err = e as RunError;
    const cancelled = err.code === "CANCELLED";
    await setStatus(runId, {
      status: cancelled ? "cancelled" : "failed",
      steps: steps as any,
      errorMessage: err.message,
      alerts: (err.issues?.length ? err.issues : null) as any,
      finishedAt: new Date(),
    });
  }
}

function unionAreaM2(feats: Feat[], proj: { code: string }) {
  const u = unionPolygons(feats);
  return u ? ringAreaM2(u.geometry as any, proj) : 0;
}
