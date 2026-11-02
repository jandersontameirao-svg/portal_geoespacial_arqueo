/**
 * Rotas tRPC da Atena. Toda rota valida permissão no servidor, e as camadas
 * usadas precisam pertencer ao projeto informado. A Atena nunca lê dados de um
 * projeto que o usuário não pode acessar diretamente.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, desc } from "drizzle-orm";
import { router, protectedProcedure } from "./_core/trpc";
import { requireProjectAccess } from "./projectAccess";
import { getDb } from "./db";
import { atenaRuns } from "../drizzle/schema";
import { aiStatus, interpretRequest } from "./atena/ai";
import { planRequest, createRun, requestCancel, loadProjectLayers, loadGeometryRows, jsonValue } from "./atena/executor";
import { structuredRequestSchema, SKILLS, ATENA_CODE_VERSION, skillVersions } from "./atena/skills";
import { parseRow, parseRows, localProjection, unionPolygons, type Feat, type SourceRow } from "./atena/geo";
import { renderMapPdf, geometryToMapPolygons, InvalidMapGeometryError, type MapItem, type PageSize, type PolygonRings } from "./atena/composition";
import { getTemplate, checkRequirements, TEMPLATES } from "./atena/templates";
import { selectMunicipalities, deriveAid, checkMalhaVersion, AID_PADRAO, MALHA_IBGE_REFERENCIA, type Municipality } from "./atena/areas";
import booleanIntersects from "@turf/boolean-intersects";
import { storagePut, storageGet } from "./storage";
import { createHash } from "crypto";

const pageSizeSchema = z.enum(["A3", "A4"]);

function polyRings(geometry: unknown, label: string): PolygonRings[] {
  try {
    return geometryToMapPolygons(geometry, label);
  } catch (error) {
    if (error instanceof InvalidMapGeometryError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
}

type ParsedSourceRow = { row: SourceRow; feat: Feat };

function parseRowsForPdf(rows: SourceRow[]): ParsedSourceRow[] {
  return rows.map(row => {
    const parsed = parseRow(row);
    if (!parsed.ok) throw new TRPCError({ code: "BAD_REQUEST", message: parsed.issue.message });
    return { row, feat: parsed.value };
  });
}

function renderPdfOrThrow(input: Parameters<typeof renderMapPdf>[0]): Buffer {
  try {
    return renderMapPdf(input);
  } catch (error) {
    if (error instanceof InvalidMapGeometryError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
}
const orientationSchema = z.enum(["landscape", "portrait"]);

/** Devolve o registro com colunas JSON já decodificadas. */
function normalizeRun<T extends Record<string, any>>(run: T) {
  return {
    ...run,
    plan: jsonValue<any>(run.plan),
    inputs: jsonValue<any>(run.inputs),
    outputs: jsonValue<any>(run.outputs),
    steps: jsonValue<any[]>(run.steps) ?? [],
    alerts: jsonValue<any>(run.alerts),
    skillVersions: jsonValue<any>(run.skillVersions),
  };
}

async function loadRunOrThrow(runId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível" });
  const [run] = await db.select().from(atenaRuns).where(eq(atenaRuns.id, runId));
  if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Execução não encontrada" });
  return run;
}

export const atenaRouter = router({
  status: protectedProcedure.query(() => ({
    ai: aiStatus(),
    codeVersion: ATENA_CODE_VERSION,
    skillVersions: skillVersions(),
    skills: Object.entries(SKILLS).map(([id, s]) => ({
      id, title: s.title, purpose: s.purpose, parameters: s.parameters, validations: s.validations, sideEffects: s.sideEffects,
    })),
  })),

  templates: protectedProcedure.query(() => TEMPLATES.map(t => ({
    id: t.id, version: t.version, title: t.title, purpose: t.purpose, status: t.status, blockedReason: t.blockedReason ?? null,
    roles: t.roles.map(r => ({ role: r.role, label: r.label, optional: r.optional, description: r.description })),
    defaultPageSize: t.layout.defaultPageSize, defaultOrientation: t.layout.defaultOrientation,
  }))),

  layers: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx.user, input.projectId, "read");
      return (await loadProjectLayers(input.projectId)).filter(l => !l.isGroup);
    }),

  interpret: protectedProcedure
    .input(z.object({ projectId: z.number(), text: z.string().trim().min(3).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx.user, input.projectId, "read");
      const layers = (await loadProjectLayers(input.projectId)).filter(l => !l.isGroup);
      return interpretRequest({ text: input.text, layers: layers.map(l => ({ id: l.id, name: l.name, crs: l.crs, featureCount: l.featureCount })) });
    }),

  plan: protectedProcedure
    .input(z.object({ projectId: z.number(), request: structuredRequestSchema }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx.user, input.projectId, "read");
      return planRequest(input.projectId, input.request);
    }),

  run: protectedProcedure
    .input(z.object({ projectId: z.number(), request: structuredRequestSchema, requestText: z.string().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx.user, input.projectId, "write");
      const planned = await planRequest(input.projectId, input.request);
      if (planned.status !== "ready") return { outcome: "not_started" as const, planned };
      const created = await createRun({ projectId: input.projectId, userId: ctx.user.id, requestText: input.requestText ?? null, plan: planned.plan });
      return { ...created, outcome: "started" as const };
    }),

  get: protectedProcedure
    .input(z.object({ runId: z.number() }))
    .query(async ({ ctx, input }) => {
      const run = await loadRunOrThrow(input.runId);
      await requireProjectAccess(ctx.user, run.projectId, "read");
      return normalizeRun(run);
    }),

  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx.user, input.projectId, "read");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível" });
      return db.select({
        id: atenaRuns.id, status: atenaRuns.status, requestText: atenaRuns.requestText, createdAt: atenaRuns.createdAt,
        finishedAt: atenaRuns.finishedAt, errorMessage: atenaRuns.errorMessage, plan: atenaRuns.plan,
      }).from(atenaRuns).where(eq(atenaRuns.projectId, input.projectId)).orderBy(desc(atenaRuns.id)).limit(50)
        .then(rows => rows.map(r => ({ ...r, plan: jsonValue<any>(r.plan) })));
    }),

  cancel: protectedProcedure
    .input(z.object({ runId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const run = await loadRunOrThrow(input.runId);
      await requireProjectAccess(ctx.user, run.projectId, "write");
      return { status: await requestCancel(input.runId) };
    }),

  renderTemplate: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      templateId: z.enum(["areas_influencia", "sitios_arqueologicos", "unidades_prospeccao", "relevo_curvas_nivel", "pocos_teste_preditivo", "coerencia_arqueologica"]),
      roles: z.object({
        ADA: z.number().int().positive().optional(),
        AID: z.number().int().positive().optional(),
        AII: z.number().int().positive().optional(),
        sitios: z.number().int().positive().optional(),
        unidades: z.number().int().positive().optional(),
        munis: z.number().int().positive().optional(),
      }),
      /** Ano da malha municipal informada; deve ser a versão mais recente do IBGE. */
      mallaAno: z.number().int().optional(),
      pageSize: pageSizeSchema.optional(),
      orientation: orientationSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx.user, input.projectId, "read");
      const t = getTemplate(input.templateId);
      if (t.status === "blocked") return { status: "blocked" as const, reason: t.blockedReason! };

      const roleEntries = Object.entries(input.roles).filter(([, v]) => v != null) as Array<[string, number]>;
      const ids = roleEntries.map(([, id]) => id);
      const projectLayers = await loadProjectLayers(input.projectId);
      for (const id of ids) {
        const l = projectLayers.find(x => x.id === id);
        if (!l) throw new TRPCError({ code: "FORBIDDEN", message: "Camada não pertence a este projeto" });
        if (l.isGroup) throw new TRPCError({ code: "BAD_REQUEST", message: `"${l.name}" é grupo, não camada de dados` });
      }
      const req = checkRequirements(t, roleEntries.map(([r]) => r).filter(r => r !== "munis"));
      if (!req.ready) return { status: "needs_input" as const, missing: req.missing };

      const byRole = new Map<string, { id: number; name: string; feats: Feat[] }>();
      for (const [role, id] of roleEntries) {
        const rows = await loadGeometryRows([id]);
        const { feats, issues } = parseRows(rows);
        if (issues.length) throw new TRPCError({ code: "BAD_REQUEST", message: `Camada ${role}: ${issues.map(i => i.message).join(" ")}` });
        const name = projectLayers.find(l => l.id === id)!.name;
        byRole.set(role, { id, name, feats });
      }

      const notes: string[] = [];
      const items: MapItem[] = [];
      const adaRole = byRole.get("ADA");
      const adaFeats = adaRole?.feats ?? [];
      const adaUnion = adaFeats.length ? unionPolygons(adaFeats) : null;
      if (adaUnion) items.push({ kind: "ref", name: adaRole!.name, polygons: polyRings(adaUnion.geometry, `ADA ${adaRole!.name}`), legendLabel: `Área diretamente afetada (ADA): ${adaRole!.name}` });

      const allFeats: Feat[] = [...adaFeats];
      if (input.templateId === "areas_influencia") {
        // AID: polígono informado, ou padrão aprovado de 250 m no entorno da ADA (não persistido).
        let aidFeats: Feat[] | null = byRole.get("AID")?.feats ?? null;
        if (aidFeats) {
          notes.push(`AID: polígono informado (${byRole.get("AID")!.name}).`);
        } else if (adaUnion && adaFeats.length) {
          const adaAsFeat: Feat = { ...adaFeats[0], feature: adaUnion as any };
          const d = deriveAid({ kind: "ada", feat: adaAsFeat }, AID_PADRAO.distanciaM, adaAsFeat);
          if (d.ok) {
            aidFeats = [{ id: 0, name: `AID ${AID_PADRAO.distanciaM} m`, type: "Polygon", feature: { type: "Feature", properties: {}, geometry: d.geometry } as any }];
            notes.push(`AID: ${AID_PADRAO.distanciaM} m no entorno da ADA (padrão aprovado).`);
            notes.push(...d.warnings);
          }
        }
        if (aidFeats) {
          const u = unionPolygons(aidFeats);
          if (u) items.push({ kind: "aid", name: "AID", polygons: polyRings(u.geometry, "AID") });
          allFeats.push(...aidFeats);
        }

        // AII: municípios integrais pela ADA, somente com a malha mais recente do IBGE.
        const munis = byRole.get("munis");
        let aiiFeats: Feat[] | null = byRole.get("AII")?.feats ?? null;
        if (munis && !aiiFeats) {
          const v = checkMalhaVersion(input.mallaAno);
          if (!v.ok) {
            notes.push(`AII bloqueada: ${v.reason}`);
          } else if (adaUnion && adaFeats.length) {
            const list: Municipality[] = munis.feats.map(f => ({ code: String(f.id), name: f.name, feat: f }));
            allFeats.push(...munis.feats);
            items.push({ kind: "mun", name: munis.name, polygons: munis.feats.flatMap(f => polyRings(f.feature.geometry, `Município ${f.name}`)) });
            const sel = selectMunicipalities({ ...adaFeats[0], feature: adaUnion as any }, list);
            if (sel.selected.length) aiiFeats = sel.selected.map(x => list.find(m => m.code === x.code)!.feat);
            if (sel.review.length) notes.push(`Revisar município(s) que só tocam a ADA: ${sel.review.map(r => r.name).join(", ")}.`);
            notes.push(`Malha municipal: ${MALHA_IBGE_REFERENCIA.fonte} (divulgada em ${MALHA_IBGE_REFERENCIA.divulgacao}).`);
          }
        }
        if (aiiFeats) {
          const u = unionPolygons(aiiFeats);
          if (u) items.push({ kind: "aii", name: "AII", polygons: polyRings(u.geometry, "AII") });
          allFeats.push(...aiiFeats);
        } else if (!munis) {
          notes.push("AII bloqueada: Malha municipal necessária para delimitar AII.");
        }
      }
      if (input.templateId === "sitios_arqueologicos") {
        const st = byRole.get("sitios")!;
        allFeats.push(...st.feats);
        const pts = st.feats.filter(f => f.type === "Point");
        const pol = st.feats.filter(f => f.type === "Polygon" || f.type === "MultiPolygon");
        if (pts.length) items.push({ kind: "point", name: st.name, points: pts.map(f => (f.feature.geometry as any).coordinates), legendLabel: "Ocorrência de sítio" });
        if (pol.length) items.push({ kind: "sitio", name: st.name, polygons: pol.flatMap(f => polyRings(f.feature.geometry, `Sítio ${f.name}`)), legendLabel: "Perímetro de sítio" });
        const inside = adaUnion ? st.feats.filter(f => booleanIntersects(f.feature as any, adaUnion as any)).length : 0;
        notes.push(`${st.feats.length} sítio(s); ${inside} dentro da ADA.`);
      }
      if (input.templateId === "unidades_prospeccao") {
        const un = byRole.get("unidades")!;
        allFeats.push(...un.feats);
        const pts = un.feats.filter(f => f.type === "Point");
        const lns = un.feats.filter(f => f.type === "LineString");
        const pol = un.feats.filter(f => f.type === "Polygon" || f.type === "MultiPolygon");
        if (pts.length) items.push({ kind: "point", name: un.name, points: pts.map(f => (f.feature.geometry as any).coordinates), legendLabel: "Unidade pontual" });
        if (lns.length) items.push({ kind: "line", name: un.name, lines: lns.map(f => (f.feature.geometry as any).coordinates), legendLabel: "Unidade linear" });
        if (pol.length) items.push({ kind: "source", name: un.name, polygons: pol.flatMap(f => polyRings(f.feature.geometry, `Unidade ${f.name}`)), legendLabel: "Unidade poligonal" });
      }

      if (allFeats.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Sem geometrias para desenhar" });
      const proj = localProjection(allFeats);
      const pageSize = (input.pageSize ?? t.layout.defaultPageSize) as PageSize;
      const orientation = input.orientation ?? t.layout.defaultOrientation;
      const pdf = renderPdfOrThrow({
        run: { id: 0, projectId: input.projectId, finishedAt: null, codeVersion: ATENA_CODE_VERSION, skillVersions: { [t.id]: t.version }, plan: {}, outputs: {}, inputs: {} } as any,
        headerLine: `${t.title} · modelo ${t.id} v${t.version} · projeto ${input.projectId}`,
        title: t.title,
        pageSize,
        orientation,
        items,
        proj: { code: proj.code, def: proj.def, epsgUtm: proj.epsgUtm, utmZone: proj.utmZone, lat0: proj.lat0, lng0: proj.lng0 },
        table: [],
        sources: roleEntries.map(([r, id]) => `${r}: ${projectLayers.find(l => l.id === id)!.name}`),
        referenceName: adaRole?.name ?? null,
        generatedAt: new Date(),
        notes,
      });
      const digest = createHash("sha256").update(pdf).digest("hex").slice(0, 16);
      const key = `atena/${input.projectId}/modelos/${t.id}-${pageSize}-${orientation}-${digest}.pdf`;
      await storagePut(key, pdf, "application/pdf");
      const { url } = await storageGet(key);
      return { status: "ready" as const, key, url, notes, pageSize, orientation };
    }),

  renderMap: protectedProcedure
    .input(z.object({
      runId: z.number(),
      pageSize: pageSizeSchema.default("A3"),
      orientation: orientationSchema.default("landscape"),
      title: z.string().trim().min(1).max(120).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const run = await loadRunOrThrow(input.runId);
      await requireProjectAccess(ctx.user, run.projectId, "read");
      if (run.status !== "completed") throw new TRPCError({ code: "BAD_REQUEST", message: "A execução não está concluída" });

      const plan = jsonValue<any>(run.plan);
      const outputs = jsonValue<any>(run.outputs);
      const refId = plan.referenceLayer?.id as number | undefined;
      const srcIds: number[] = plan.sourceLayers.map((s: any) => s.id);
      const resultIds: number[] = outputs.layers.map((l: any) => l.id);

      const dbLayers = await loadProjectLayers(run.projectId);
      const nameOf = (id: number) => dbLayers.find(l => l.id === id)?.name ?? `Camada ${id}`;
      const toItems = (rows: SourceRow[], kind: MapItem["kind"]): MapItem[] => {
        const parsedRows = parseRowsForPdf(rows);
        const byLayer = new Map<number, MapItem>();
        for (const { row, feat } of parsedRows) {
          const r = row;
          const f = feat;
          const lid = r.layerId as number;
          if (!byLayer.has(lid)) byLayer.set(lid, { kind, name: nameOf(lid), polygons: [], lines: [], points: [] });
          const item = byLayer.get(lid)!;
          const geom: any = f.feature.geometry;
          if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
            item.polygons!.push(...polyRings(geom, `Geometria ${r.id} (${r.name})`));
          }
          else if (geom.type === "LineString") item.lines!.push(geom.coordinates);
          else if (geom.type === "Point") item.points!.push(geom.coordinates);
        }
        return Array.from(byLayer.values());
      };

      const refRows = refId ? await loadGeometryRows([refId]) : [];
      const srcRows = await loadGeometryRows(srcIds);
      const resRows = await loadGeometryRows(resultIds);
      const items: MapItem[] = [
        ...toItems(refRows, "ref"),
        ...toItems(srcRows, "source"),
        ...toItems(resRows, "result"),
      ];
      if (items.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Sem geometrias para desenhar" });

      const allFeats: Feat[] = [...refRows, ...srcRows, ...resRows].map(r => parseRow(r)).filter(x => x.ok).map((x: any) => x.value);
      const proj = localProjection(allFeats);
      const sources = [
        ...(refId ? [`${nameOf(refId)} (referência)`] : []),
        ...srcIds.map(id => nameOf(id)),
      ];

      const pdf = renderPdfOrThrow({
        run: { ...run, skillVersions: jsonValue<any>(run.skillVersions), plan, outputs } as any,
        title: input.title ?? (outputs.layers[0]?.name ?? "Mapa de análise Atena"),
        pageSize: input.pageSize as PageSize,
        orientation: input.orientation,
        items,
        proj: { code: proj.code, def: proj.def, epsgUtm: proj.epsgUtm, utmZone: proj.utmZone, lat0: proj.lat0, lng0: proj.lng0 },
        table: outputs.table ?? [],
        sources,
        referenceName: plan.referenceLayer?.name ?? null,
        generatedAt: new Date(),
      });

      const digest = createHash("sha256").update(pdf).digest("hex").slice(0, 16);
      const key = `atena/${run.projectId}/${run.id}/mapa-${input.pageSize}-${input.orientation}-${digest}.pdf`;
      await storagePut(key, pdf, "application/pdf");
      const { url } = await storageGet(key);
      const db = await getDb();
      if (db) await db.update(atenaRuns).set({ artifactKey: key, artifactCreatedAt: new Date() }).where(eq(atenaRuns.id, run.id));
      return { key, url, bytes: pdf.length, sha256_16: digest };
    }),
});
