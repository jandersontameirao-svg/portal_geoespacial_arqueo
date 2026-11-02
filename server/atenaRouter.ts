/**
 * Rotas tRPC da Atena. Toda rota valida permissão no servidor, e as camadas
 * usadas precisam pertencer ao projeto informado. A Atena nunca lê dados de um
 * projeto que o usuário não pode acessar diretamente.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, desc } from "drizzle-orm";
import { router, protectedProcedure } from "./_core/trpc";
import { requireProjectAccess, requireProjectEditor } from "./projectAccess";
import { getDb } from "./db";
import { atenaRuns } from "../drizzle/schema";
import { aiStatus, interpretRequest } from "./atena/ai";
import { planRequest, createRun, requestCancel, loadProjectLayers, loadGeometryRows, jsonValue } from "./atena/executor";
import { structuredRequestSchema, SKILLS, ATENA_CODE_VERSION, skillVersions } from "./atena/skills";
import { parseRow, parseRows, localProjection, unionPolygons, type Feat, type SourceRow } from "./atena/geo";
import { renderMapPdf, geometryToMapPolygons, InvalidMapGeometryError, type MapItem, type PageSize } from "./atena/composition";
import { getTemplate, checkRequirements, TEMPLATES } from "./atena/templates";
import { selectMunicipalities, prepareAdaFeatures, prepareAidFeatures, LIMITS, checkMalhaVersion, AID_PADRAO, MALHA_IBGE_REFERENCIA, MALHA_IBGE_2025_VERIFICADA_NO_STAGE, type Municipality } from "./atena/areas";
import booleanIntersects from "./atena/predicates";
import { storagePut, storageGet } from "./storage";
import { createHash } from "crypto";
import { selectRemoteOfficialAii } from "./atena/remote-aii";

const pageSizeSchema = z.enum(["A3", "A4"]);

function polyRings(geometry: unknown, label: string) {
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
      await requireProjectAccess(input.projectId, ctx.user);
      return (await loadProjectLayers(input.projectId)).filter(l => !l.isGroup);
    }),

  interpret: protectedProcedure
    .input(z.object({ projectId: z.number(), text: z.string().trim().min(3).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(input.projectId, ctx.user);
      const layers = (await loadProjectLayers(input.projectId)).filter(l => !l.isGroup);
      return interpretRequest({ text: input.text, layers: layers.map(l => ({ id: l.id, name: l.name, crs: l.crs, featureCount: l.featureCount })) });
    }),

  plan: protectedProcedure
    .input(z.object({ projectId: z.number(), request: structuredRequestSchema }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(input.projectId, ctx.user);
      return planRequest(input.projectId, input.request);
    }),

  run: protectedProcedure
    .input(z.object({ projectId: z.number(), request: structuredRequestSchema, requestText: z.string().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user);
      const planned = await planRequest(input.projectId, input.request);
      if (planned.status !== "ready") return { outcome: "not_started" as const, planned };
      const created = await createRun({ projectId: input.projectId, userId: ctx.user.id, requestText: input.requestText ?? null, plan: planned.plan });
      return { ...created, outcome: "started" as const };
    }),

  get: protectedProcedure
    .input(z.object({ runId: z.number() }))
    .query(async ({ ctx, input }) => {
      const run = await loadRunOrThrow(input.runId);
      await requireProjectAccess(run.projectId, ctx.user);
      return normalizeRun(run);
    }),

  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(input.projectId, ctx.user);
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
      await requireProjectEditor(run.projectId, ctx.user);
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
      /** Ano declarado; não comprova presença nem proveniência da malha. */
      mallaAno: z.number().int().optional(),
      pageSize: pageSizeSchema.optional(),
      orientation: orientationSchema.optional(),
      adaHalfWidthM: z.number().finite().min(LIMITS.halfWidthMinM).max(LIMITS.halfWidthMaxM).default(35),
      aidDistanceM: z.number().finite().min(LIMITS.distanceMinM).max(LIMITS.distanceMaxM).default(AID_PADRAO.distanciaM),
      aidOrigin: z.enum(["ada", "source"]).default("ada"),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user);
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
        if (role === "munis" && !MALHA_IBGE_2025_VERIFICADA_NO_STAGE) continue;
        const rows = await loadGeometryRows(input.projectId, [id]);
        const { feats, issues } = parseRows(rows);
        if (issues.length) throw new TRPCError({ code: "BAD_REQUEST", message: `Camada ${role}: ${issues.map(i => i.message).join(" ")}` });
        const spec = t.roles.find(r => r.role === role);
        if (spec && feats.some(f => !spec.geometryTypes.includes(f.type === "MultiPolygon" ? "Polygon" : f.type))) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Camada ${role}: tipo incompatível com o papel selecionado (${spec.geometryTypes.join(", ")}).` });
        }
        const name = projectLayers.find(l => l.id === id)!.name;
        byRole.set(role, { id, name, feats });
      }

      const notes: string[] = [];
      const items: MapItem[] = [];
      const adaRole = byRole.get("ADA");
      const adaSources = adaRole?.feats ?? [];
      let adaFeats: Feat[];
      try {
        const prepared = prepareAdaFeatures(adaSources, input.adaHalfWidthM);
        adaFeats = prepared.feats;
        notes.push(...prepared.notes);
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "ADA inválida" });
      }
      const adaUnion = adaFeats.length ? unionPolygons(adaFeats) : null;
      if (adaUnion) items.push({ kind: "ref", name: adaRole!.name, polygons: polyRings(adaUnion.geometry, `ADA ${adaRole!.name}`), legendLabel: `Área diretamente afetada (ADA): ${adaRole!.name}` });

      const allFeats: Feat[] = [...adaFeats];
      if (input.templateId === "areas_influencia") {
        // AID: polígono informado, ou padrão aprovado de 250 m no entorno da ADA (não persistido).
        let aidFeats: Feat[] | null = byRole.get("AID")?.feats ?? null;
        if (aidFeats) {
          notes.push(`AID: polígono informado (${byRole.get("AID")!.name}).`);
        } else if (adaUnion && adaFeats.length) {
          try {
            const prepared = prepareAidFeatures(adaFeats, adaSources, input.aidDistanceM, input.aidOrigin);
            aidFeats = prepared.feats;
            notes.push(...prepared.notes);
          } catch (error) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "AID inválida" });
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
        if (aiiFeats) notes.push(`AII própria informada pelo usuário (${byRole.get("AII")!.name}). Não foi consultada nem certificada como malha municipal oficial IBGE 2025; procedência e metodologia dessa camada dependem de revisão.`);
        if (munis && !aiiFeats) {
          const v = checkMalhaVersion(input.mallaAno, MALHA_IBGE_2025_VERIFICADA_NO_STAGE);
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
          try {
            if (!adaUnion) throw new Error("ADA indisponível para determinar AII.");
            const official = await selectRemoteOfficialAii(adaUnion, [], { userId: ctx.user.id, projectId: input.projectId });
            const municipalFeats: Feat[] = official.featureCollection.features.map(f => ({ id: Number(f.properties?.municipalityCode), name: String(f.properties?.municipalityName), type: f.geometry.type, feature: f }));
            items.push({ kind: "aii", name: "AII IBGE 2025", polygons: municipalFeats.flatMap(f => polyRings(f.feature.geometry, `Município ${f.name}`)) });
            allFeats.push(...municipalFeats);
            notes.push(`AII: municípios inteiros IBGE ${official.year}, edição ${official.edition}, cobertura ${official.coverage}: ${official.municipalities.map(m => `${m.code} ${m.name}`).join("; ")}. Sem recorte ou buffer. SHA256 ${official.sha256}. Fonte: ${official.source}. Consulta: ${official.queriedAt}. Proveniência: ${official.provenance.endpoint}`);
            if (official.review.length) notes.push(`Revisar contatos somente de fronteira, não incluídos: ${official.review.map(m => `${m.code} ${m.name}`).join("; ")}.`);
          } catch (error) { notes.push(`AII bloqueada: ${error instanceof Error ? error.message : "malha indisponível"}`); }
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
        sources: [...allFeats.map(f => f.name)],
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
      await requireProjectEditor(run.projectId, ctx.user);
      if (run.status !== "completed") throw new TRPCError({ code: "BAD_REQUEST", message: "A execução não está concluída" });

      const plan = jsonValue<any>(run.plan);
      const outputs = jsonValue<any>(run.outputs);
      const refId = plan.referenceLayer?.id as number | undefined;
      const srcIds: number[] = plan.sourceLayers.map((s: any) => s.id);
      const resultIds: number[] = outputs.layers.map((l: any) => l.id);

      const dbLayers = await loadProjectLayers(run.projectId);
      const nameOf = (id: number) => dbLayers.find(l => l.id === id)?.name ?? `Camada ${id}`;
      const refRows = refId ? await loadGeometryRows(run.projectId, [refId]) : [];
      const srcRows = await loadGeometryRows(run.projectId, srcIds);
      const resRows = await loadGeometryRows(run.projectId, resultIds);
      const refParsed = parseRowsForPdf(refRows);
      const srcParsed = parseRowsForPdf(srcRows);
      const resParsed = parseRowsForPdf(resRows);
      const toItems = (rows: ParsedSourceRow[], kind: MapItem["kind"]): MapItem[] => {
        const byLayer = new Map<number, MapItem>();
        for (const { row, feat } of rows) {
          const lid = row.layerId as number;
          if (!byLayer.has(lid)) byLayer.set(lid, { kind, name: nameOf(lid), polygons: [], lines: [], points: [] });
          const item = byLayer.get(lid)!;
          const geom = feat.feature.geometry;
          if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
            item.polygons!.push(...polyRings(geom, `Geometria ${row.id} (${row.name})`));
          }
          else if (geom.type === "LineString") item.lines!.push(geom.coordinates);
          else if (geom.type === "Point") item.points!.push(geom.coordinates);
          else throw new TRPCError({ code: "BAD_REQUEST", message: `Geometria ${row.id} (${row.name}): tipo ${geom.type} não suportado para PDF.` });
        }
        return Array.from(byLayer.values());
      };

      const items: MapItem[] = [
        ...toItems(refParsed, "ref"),
        ...toItems(srcParsed, "source"),
        ...toItems(resParsed, "result"),
      ];
      if (items.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Sem geometrias para desenhar" });

      const allFeats: Feat[] = [...refParsed, ...srcParsed, ...resParsed].map(parsed => parsed.feat);
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
