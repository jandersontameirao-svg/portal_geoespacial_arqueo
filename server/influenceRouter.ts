import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "./_core/trpc";
import { requireProjectAccess, requireProjectEditor } from "./projectAccess";
import { requireLeafLayer } from "./atena/persistence";
import { loadGeometryRows, loadProjectLayers } from "./atena/executor";
import { parseRows, unionPolygons } from "./atena/geo";
import { prepareAdaFeatures, prepareAidFeatures, LIMITS } from "./atena/areas";
import { selectRemoteOfficialAii } from "./atena/remote-aii";
import { saveDerivedGeometryBatch } from "./atena/persistence";
import type { Feature, Polygon, MultiPolygon } from "geojson";

const parameters = z.object({ projectId: z.number().int().positive(), sourceLayerId: z.number().int().positive(),
  halfWidthM: z.number().finite().min(LIMITS.halfWidthMinM).max(LIMITS.halfWidthMaxM).default(35),
  distanceM: z.number().finite().min(LIMITS.distanceMinM).max(LIMITS.distanceMaxM).default(250),
  aidOrigin: z.enum(["ada", "source"]).default("ada"), includeTouchCodes: z.array(z.string().regex(/^\d{7}$/)).max(100).default([]),
});

async function buildInfluence(input: z.infer<typeof parameters>, userId: number) {
  const layers = await loadProjectLayers(input.projectId);
  if (!layers.some(l => l.id === input.sourceLayerId && !l.isGroup)) throw new TRPCError({ code: "FORBIDDEN", message: "Camada de origem não pertence ao projeto." });
  const rows = await loadGeometryRows(input.projectId, [input.sourceLayerId]);
  const parsed = parseRows(rows);
  if (parsed.issues.length) throw new TRPCError({ code: "BAD_REQUEST", message: parsed.issues.map(i => i.message).join(" ") });
  const ada = prepareAdaFeatures(parsed.feats, input.halfWidthM);
  const adaUnion = unionPolygons(ada.feats);
  if (!adaUnion) throw new TRPCError({ code: "BAD_REQUEST", message: "ADA vazia ou inválida." });
  const aid = prepareAidFeatures(ada.feats, parsed.feats, input.distanceM, input.aidOrigin);
  const aidUnion = unionPolygons(aid.feats);
  if (!aidUnion) throw new TRPCError({ code: "BAD_REQUEST", message: "AID vazia ou inválida." });
  const features: Feature<Polygon | MultiPolygon>[] = [
    { ...adaUnion, properties: { role: "ADA", name: "Área diretamente afetada", sourceLayerId: input.sourceLayerId, halfWidthM: input.halfWidthM } },
    { ...aidUnion, properties: { role: "AID", name: "Área de influência direta", distanceM: input.distanceM, origin: input.aidOrigin } },
  ];
  let aii: Awaited<ReturnType<typeof selectRemoteOfficialAii>> | null = null;
  let aiiBlocked: string | null = null;
  try { aii = await selectRemoteOfficialAii(adaUnion, input.includeTouchCodes, { userId, projectId: input.projectId }); features.push(...aii.featureCollection.features); }
  catch (error) { aiiBlocked = error instanceof Error ? error.message : "AII bloqueada"; }
  return { projectId: input.projectId, featureCollection: { type: "FeatureCollection" as const, features }, aii, aiiBlocked, parameters: input, notes: [...ada.notes, ...aid.notes], sourceGeometryIds: rows.map(r => r.id) };
}

function storedPolygon(geometry: Polygon | MultiPolygon) {
  const convertRing = (ring: number[][]) => ring.map(([lng, lat, ...rest]) => [lat, lng, ...rest]);
  return geometry.type === "Polygon" ? geometry.coordinates.map(convertRing) : geometry.coordinates.map(part => part.map(convertRing));
}

export const influenceRouter = router({
  preview: protectedProcedure.input(parameters).mutation(async ({ ctx, input }) => {
    await requireProjectAccess(input.projectId, ctx.user);
    return buildInfluence(input, ctx.user.id);
  }),
  save: protectedProcedure.input(parameters.extend({ targetLayerId: z.number().int().positive(), requestId: z.string().uuid(), includeAii: z.boolean().default(true) })).mutation(async ({ ctx, input }) => {
    await requireProjectEditor(input.projectId, ctx.user);
    if (input.targetLayerId === input.sourceLayerId) throw new TRPCError({ code: "BAD_REQUEST", message: "Escolha uma camada de destino distinta para preservar os insumos." });
    await requireLeafLayer(input.projectId, input.targetLayerId);
    const result = await buildInfluence(input, ctx.user.id);
    if (input.includeAii && result.aiiBlocked) throw new TRPCError({ code: "PRECONDITION_FAILED", message: result.aiiBlocked });
    const selected = result.featureCollection.features.filter(f => input.includeAii || f.properties?.role !== "AII");
    const saved = await saveDerivedGeometryBatch({ projectId: input.projectId, userId: ctx.user.id, requestId: input.requestId, action: "influence.areas.save", metadata: { parameters: result.parameters, sourceGeometryIds: result.sourceGeometryIds, mesh: result.aii ? { year: result.aii.year, sha256: result.aii.sha256, source: result.aii.source, coverage: result.aii.coverage, edition: result.aii.edition, provenance: result.aii.provenance, queriedAt: result.aii.queriedAt } : null }, rows: selected.map(f => ({
      projectId: input.projectId, userId: ctx.user.id, layerId: input.targetLayerId, type: "polygon", name: String(f.properties?.municipalityName ?? f.properties?.name ?? f.properties?.role), coordinates: JSON.stringify(storedPolygon(f.geometry)), color: f.properties?.role === "ADA" ? "#f97316" : f.properties?.role === "AID" ? "#2563eb" : "#16a34a", visible: 1, opacity: 65,
      description: JSON.stringify({ version: input.requestId, parameters: result.parameters, attributes: f.properties, sourceGeometryIds: result.sourceGeometryIds, generatedAt: new Date().toISOString() }),
    })) });
    return { success: true, ...saved, projectId: input.projectId, targetLayerId: input.targetLayerId };
  }),
});
