import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { requireProjectAccess, requireProjectEditor } from "./projectAccess";
import { requireLeafLayer } from "./atena/persistence";
import * as db from "./db";
import { saveDerivedGeometryBatch } from "./atena/persistence";
import type { Feature, Polygon, MultiPolygon, LineString, MultiLineString } from "geojson";
import { loadProjectLayers, loadGeometryRows } from "./atena/executor";
import { parseRow, type SourceRow } from "./atena/geo";
import {
  exportGeoJSON,
  generateProspectionUnits,
  ProspectGridError,
  type ProspectGeneration,
  type ProspectGridParameters,
  type ProspectUnit,
} from "./atena/prospect-grid";
import { validateStoredGeometryCoordinates } from "../shared/geometry-coordinates";

const parametersSchema = z.object({
  spacing: z.number().finite().positive().optional(),
  dx: z.number().finite().positive().optional(),
  dy: z.number().finite().positive().optional(),
  lineOffsetM: z.number().finite().min(0).optional(),
  offsetM: z.number().finite().min(0).optional(),
  zigzag: z.boolean().optional(),
  maxUnits: z.number().int().min(1).max(5000).optional(),
  prefix: z.string().trim().min(1).max(24).optional(),
  startNumber: z.number().int().min(1).optional(),
});

const previewInput = z.object({
  projectId: z.number().int().positive(),
  sourceGeometryId: z.number().int().positive().optional(),
  sourceLayerId: z.number().int().positive().optional(),
  ...parametersSchema.shape,
}).refine(value => value.sourceGeometryId != null || value.sourceLayerId != null, {
  message: "Escolha uma geometria ou uma camada de origem.",
  path: ["sourceGeometryId"],
});

const saveInput = z.object({
  projectId: z.number().int().positive(),
  layerId: z.number().int().positive().nullable().optional(),
  requestId: z.string().uuid(),
  parameters: parametersSchema.optional(),
  sourceGeometryIds: z.array(z.number().int().refine(id => id !== 0)).max(5000).default([]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#f97316"),
  description: z.string().max(1000).optional(),
  units: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    number: z.number().int().positive(),
    name: z.string().trim().min(1).max(255),
    /** Ordem de persistência da Atena: [lat, lng]. */
    coordinates: z.tuple([z.number().finite(), z.number().finite()]),
  })).min(1).max(5000),
});

type SourceOption = {
  id: number;
  name: string;
  type: SourceRow["type"];
  layerId: number | null;
  layerName: string | null;
};

function helperError(error: unknown): never {
  if (error instanceof ProspectGridError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw error;
}

async function sourceRowsFor(
  projectId: number,
  sourceGeometryId: number | undefined,
  sourceLayerId: number | undefined,
): Promise<SourceRow[]> {
  const rows = await db.getGeometriesByProject(projectId);
  if (sourceGeometryId != null) {
    const row = rows.find(candidate => candidate.id === sourceGeometryId);
    if (!row) throw new TRPCError({ code: "FORBIDDEN", message: "Geometria não pertence ao projeto selecionado." });
    return [{ id: row.id, name: row.name, type: row.type, coordinates: row.coordinates, layerId: row.layerId }];
  }
  const selected = await loadGeometryRows(projectId, [sourceLayerId!]);
  if (!selected.length) throw new TRPCError({ code: "BAD_REQUEST", message: "A camada selecionada não possui geometrias utilizáveis." });
  return selected;
}

function generationForRows(rows: SourceRow[], parameters: ProspectGridParameters) {
  const generations: ProspectGeneration[] = [];
  let nextNumber = parameters.startNumber ?? 1;
  for (const row of rows) {
    const parsed = parseRow(row);
    if (!parsed.ok) throw new TRPCError({ code: "BAD_REQUEST", message: parsed.issue.message });
    if (!["Polygon", "MultiPolygon", "LineString", "MultiLineString"].includes(parsed.value.feature.geometry.type)) throw new TRPCError({ code: "BAD_REQUEST", message: "Use polígono ou eixo linear para gerar unidades." });
    try {
      const remaining = (parameters.maxUnits ?? 5000) - generations.reduce((sum, current) => sum + current.count, 0);
      if (remaining <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Limite global de unidades atingido; reduza os insumos." });
      const generation = generateProspectionUnits(parsed.value.feature as Feature<Polygon | MultiPolygon | LineString | MultiLineString>, {
        ...parameters,
        maxUnits: remaining,
        startNumber: nextNumber,
      });
      generations.push(generation);
      nextNumber += generation.count;
    } catch (error) {
      return helperError(error);
    }
  }
  const units: ProspectUnit[] = generations.flatMap(generation => generation.units);
  const modes = Array.from(new Set(generations.map(generation => generation.mode)));
  return {
    mode: modes.length === 1 ? modes[0] : "mixed",
    units,
    count: units.length,
    parameters: generations[0]?.parameters ?? {
      spacing: parameters.spacing ?? 30,
      dx: parameters.dx ?? parameters.spacing ?? 30,
      dy: parameters.dy ?? parameters.spacing ?? 30,
      lineOffsetM: parameters.lineOffsetM ?? parameters.offsetM ?? 15,
      zigzag: parameters.zigzag ?? true,
      maxUnits: parameters.maxUnits ?? 5000,
      prefix: parameters.prefix ?? "UP",
      startNumber: parameters.startNumber ?? 1,
    },
    geojson: exportGeoJSON(units),
    sourceGeometryIds: rows.map(row => row.id),
  };
}

export const prospectRouter = router({
  /** Lista as fontes do projeto sem revelar geometrias de outros projetos. */
  sources: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(input.projectId, ctx.user);
      const [rows, projectLayers] = await Promise.all([
        db.getGeometriesByProject(input.projectId),
        loadProjectLayers(input.projectId),
      ]);
      let canWrite = true;
      try {
        await requireProjectEditor(input.projectId, ctx.user);
      } catch (error) {
        if (error instanceof TRPCError && error.code === "FORBIDDEN") canWrite = false;
        else throw error;
      }
      const layerNames = new Map(projectLayers.map(layer => [layer.id, layer.name]));
      const geometries: SourceOption[] = rows.map(row => ({
        id: row.id,
        name: row.name,
        type: row.type,
        layerId: row.layerId,
        layerName: row.layerId == null ? null : layerNames.get(row.layerId) ?? null,
      }));
      return {
        canWrite,
        layers: projectLayers.filter(layer => !layer.isGroup && layer.featureCount > 0).map(layer => ({
          id: layer.id,
          name: layer.name,
          featureCount: layer.featureCount,
        })),
        geometries,
      };
    }),

  /** Prévia pura: nada é persistido nesta chamada. */
  preview: protectedProcedure
    .input(previewInput)
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(input.projectId, ctx.user);
      const rows = await sourceRowsFor(input.projectId, input.sourceGeometryId, input.sourceLayerId);
      const { projectId: _projectId, sourceGeometryId: _geometryId, sourceLayerId: _layerId, ...parameters } = input;
      const generation = generationForRows(rows, parameters);
      return {
        ...generation,
        sourceGeometryIds: rows.map(row => row.id),
        sourceNames: rows.map(row => row.name),
        manualAdjustmentWarning: "A prévia é editável. Coordenadas ajustadas manualmente serão as coordenadas solicitadas para gravação.",
      };
    }),

  /**
   * Confirmação explícita: cada unidade é validada e gravada individualmente,
   * como faria geometries.create, sem aceitar referências fora do projeto.
   */
  save: protectedProcedure
    .input(saveInput)
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user);
      await requireLeafLayer(input.projectId, input.layerId);
      const sourceRows: SourceRow[] = await db.getGeometriesByProject(input.projectId);
      if (input.sourceGeometryIds.some(id => id < 0)) {
        const projectLayers = (await loadProjectLayers(input.projectId)).filter(layer => !layer.isGroup && layer.layerType === "vector" && layer.featureCount > 0);
        for (const layer of projectLayers) {
          const remaining = input.sourceGeometryIds.filter(id => id < 0 && !sourceRows.some(row => row.id === id));
          if (!remaining.length) break;
          sourceRows.push(...await loadGeometryRows(input.projectId, [layer.id]));
        }
      }
      if (input.sourceGeometryIds.some(id => !sourceRows.some(row => row.id === id))) throw new TRPCError({ code: "FORBIDDEN", message: "Origem não pertence ao projeto." });
      for (const unit of input.units) {
        try {
          validateStoredGeometryCoordinates("marker", unit.coordinates, {
            coordinateOrder: "stored-lat-lng",
            requireClosed: false,
          });
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${unit.name}: ${error instanceof Error ? error.message : "coordenada inválida."}`,
          });
        }
      }
      const saved = await saveDerivedGeometryBatch({
        projectId: input.projectId, userId: ctx.user.id, requestId: input.requestId, action: "prospection.units.create",
        metadata: { parameters: input.parameters ?? {}, sourceGeometryIds: input.sourceGeometryIds, sourceLayerIds: Array.from(new Set(sourceRows.filter(row => input.sourceGeometryIds.includes(row.id)).map(row => row.layerId).filter(id => id != null))), ids: input.units.map(unit => unit.id) },
        rows: input.units.map(unit => ({
          projectId: input.projectId,
          userId: ctx.user.id,
          type: "marker",
          name: unit.name,
          description: JSON.stringify({ text: input.description ?? `Unidade de prospecção ${unit.id}`, unitId: unit.id, number: unit.number, parameters: input.parameters ?? {}, sourceGeometryIds: input.sourceGeometryIds, version: input.requestId }),
          coordinates: JSON.stringify(unit.coordinates),
          color: input.color,
          layerId: input.layerId ?? null,
          visible: 1,
          opacity: 100,
        })),
      });
      return { success: true, ...saved };
    }),
});
