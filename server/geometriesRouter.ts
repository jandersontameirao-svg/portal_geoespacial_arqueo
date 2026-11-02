import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { createAuditLog } from "./db";
import { requireProjectAccess, requireProjectEditor } from "./projectAccess";
import { and, eq } from "drizzle-orm";
import { geometries } from "../drizzle/schema";
import { loadLayerNodesForUser, requireLeafLayer } from "./layersRouter";
import { effectiveVisibility } from "./layerTree";
import { accessibleProjectIds, getSafeProjectSelection } from "./projectSelectionRouter";
import {
  storedPolygonToGeoJSON,
  validateStoredGeometryCoordinates,
} from "../shared/geometry-coordinates";

const geometryInput = z.object({
  projectId: z.number(),
  layerId: z.number().int().positive().nullable().optional(),
  type: z.enum(["marker", "polyline", "polygon"]),
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(4000).optional(),
  coordinates: z.string().min(2).refine((value) => {
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }, "Coordenadas devem ser JSON válido"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#3b82f6"),
});

type GeometryType = z.infer<typeof geometryInput>["type"];

type GeoJsonPolygon =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseAndValidateCoordinates(type: GeometryType, serialized: string): unknown {
  try {
    const coordinates = JSON.parse(serialized) as unknown;
    validateStoredGeometryCoordinates(type, coordinates);
    return coordinates;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Coordenadas inválidas.";
    throw new TRPCError({ code: "BAD_REQUEST", message });
  }
}

function asGeoJsonGeometry(type: GeometryType, coordinates: unknown): Record<string, unknown> {
  if (type === "marker") {
    const point = coordinates as number[];
    return { type: "Point", coordinates: [point[1], point[0], ...point.slice(2)] };
  }
  if (type === "polyline") {
    const line = coordinates as number[][];
    return { type: "LineString", coordinates: line.map((point) => [point[1], point[0], ...point.slice(2)]) };
  }
  return storedPolygonToGeoJSON(coordinates) as GeoJsonPolygon;
}

function coordinatesToKml(coordinates: number[][]): string {
  return coordinates.map((position) => `${position[0]},${position[1]},${position[2] ?? 0}`).join(" ");
}

function polygonToKml(geometry: GeoJsonPolygon): string {
  const serializePolygon = (polygon: number[][][]) => {
    const [outer, ...holes] = polygon;
    const outerKml = `<outerBoundaryIs><LinearRing><coordinates>${coordinatesToKml(outer)}</coordinates></LinearRing></outerBoundaryIs>`;
    const holesKml = holes.map((hole) => `<innerBoundaryIs><LinearRing><coordinates>${coordinatesToKml(hole)}</coordinates></LinearRing></innerBoundaryIs>`).join("");
    return `<Polygon>${outerKml}${holesKml}</Polygon>`;
  };
  return geometry.type === "Polygon"
    ? serializePolygon(geometry.coordinates)
    : `<MultiGeometry>${geometry.coordinates.map(serializePolygon).join("")}</MultiGeometry>`;
}

function geometryToKml(type: GeometryType, coordinates: unknown): string {
  const geojson = asGeoJsonGeometry(type, coordinates) as any;
  if (geojson.type === "Point") return `<Point><coordinates>${coordinatesToKml([geojson.coordinates])}</coordinates></Point>`;
  if (geojson.type === "LineString") return `<LineString><coordinates>${coordinatesToKml(geojson.coordinates)}</coordinates></LineString>`;
  return polygonToKml(geojson as GeoJsonPolygon);
}

async function getGeometryOrThrow(id: number) {
  const geometry = await db.getGeometryById(id);
  if (!geometry) throw new TRPCError({ code: "NOT_FOUND", message: "Geometria não encontrada" });
  return geometry;
}

async function getWritableGeometry(id: number, user: { id: number; role: "admin" | "editor" | "client" }) {
  const geometry = await getGeometryOrThrow(id);
  await requireProjectEditor(geometry.projectId, user);
  return geometry;
}

async function listVisibleGeometries(projectId: number, userId: number) {
  const rows = await db.getGeometriesByProject(projectId);
  const visibility = effectiveVisibility(await loadLayerNodesForUser(projectId, userId));
  return rows.map(geometry => ({
    ...geometry,
    // visible remains the stored flag. Legacy detached geometries remain renderable.
    effectiveVisible: geometry.visible === 1 && (geometry.layerId == null || visibility.get(geometry.layerId) === true),
  }));
}

const moveToLayer = protectedProcedure
  .input(z.object({ id: z.number().int().positive(), layerId: z.number().int().positive().nullable() }))
  .mutation(async ({ input, ctx }) => {
    const geometry = await getWritableGeometry(input.id, ctx.user);
    await requireLeafLayer(geometry.projectId, input.layerId);
    const database = await db.getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
    await database.update(geometries).set({ layerId: input.layerId })
      .where(and(eq(geometries.id, geometry.id), eq(geometries.projectId, geometry.projectId)));
    await createAuditLog({ userId: ctx.user.id, action: "geometry.layer.update", entityType: "geometry", entityId: geometry.id, projectId: geometry.projectId, details: { layerId: input.layerId } });
    return { success: true };
  });

export const geometriesRouter = router({
  moveToLayer,
  setLayer: moveToLayer, // PR8 compatibility; same authorization and validation.

  create: protectedProcedure
    .input(geometryInput)
    .mutation(async ({ input, ctx }) => {
      await requireProjectEditor(input.projectId, ctx.user);
      await requireLeafLayer(input.projectId, input.layerId);
      const coordinates = parseAndValidateCoordinates(input.type, input.coordinates);
      await db.createGeometry({
        ...input,
        coordinates: JSON.stringify(coordinates),
        description: input.description || "",
        userId: ctx.user.id,
        visible: 1,
        opacity: 100,
      });
      await createAuditLog({
        userId: ctx.user.id,
        action: "geometry.create",
        entityType: "geometry",
        entityId: input.projectId,
        projectId: input.projectId,
        details: { name: input.name, type: input.type, topologyValidated: input.type === "polygon" },
      });
      return { success: true };
    }),

  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input, ctx }) => {
      await requireProjectAccess(input.projectId, ctx.user);
      return listVisibleGeometries(input.projectId, ctx.user.id);
    }),

  // No input means the caller's saved selection. Explicit [] means no projects.
  listForProjects: protectedProcedure
    .input(z.object({ projectIds: z.array(z.number().int().positive()).max(500).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const allowed = input?.projectIds === undefined
        ? await getSafeProjectSelection(ctx.user)
        : await accessibleProjectIds(ctx.user, input.projectIds);
      const out: Awaited<ReturnType<typeof listVisibleGeometries>> = [];
      for (const projectId of allowed) out.push(...await listVisibleGeometries(projectId, ctx.user.id));
      return out;
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      type: z.enum(["marker", "polyline", "polygon"]).optional(),
      name: z.string().trim().min(1).max(255).optional(),
      description: z.string().trim().max(4000).optional(),
      coordinates: geometryInput.shape.coordinates.optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const geometry = await getWritableGeometry(input.id, ctx.user);
      const { id, ...data } = input;
      if (Object.keys(data).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Nenhum campo foi informado para atualização" });
      }
      const nextType = (data.type ?? geometry.type) as GeometryType;
      const nextCoordinates = data.coordinates ?? geometry.coordinates;
      if (data.coordinates !== undefined || data.type !== undefined) {
        parseAndValidateCoordinates(nextType, nextCoordinates);
      }
      await db.updateGeometry(id, data);
      await createAuditLog({
        userId: ctx.user.id,
        action: "geometry.update",
        entityType: "geometry",
        entityId: id,
        projectId: geometry.projectId,
        details: { fields: Object.keys(data), topologyValidated: nextType === "polygon" },
      });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const geometry = await getWritableGeometry(input.id, ctx.user);
      await db.deleteGeometry(input.id);
      await createAuditLog({
        userId: ctx.user.id,
        action: "geometry.delete",
        entityType: "geometry",
        entityId: input.id,
        projectId: geometry.projectId,
        details: { name: geometry.name },
      });
      return { success: true };
    }),

  updateVisibility: protectedProcedure
    .input(z.object({ id: z.number(), visible: z.number().int().min(0).max(1) }))
    .mutation(async ({ input, ctx }) => {
      const geometry = await getWritableGeometry(input.id, ctx.user);
      await db.updateGeometryVisibility(input.id, input.visible);
      await createAuditLog({ userId: ctx.user.id, action: "geometry.visibility.update", entityType: "geometry", entityId: input.id, projectId: geometry.projectId, details: { visible: input.visible } });
      return { success: true };
    }),

  updateOpacity: protectedProcedure
    .input(z.object({ id: z.number(), opacity: z.number().min(0).max(100) }))
    .mutation(async ({ input, ctx }) => {
      const geometry = await getWritableGeometry(input.id, ctx.user);
      await db.updateGeometryOpacity(input.id, input.opacity);
      await createAuditLog({ userId: ctx.user.id, action: "geometry.opacity.update", entityType: "geometry", entityId: input.id, projectId: geometry.projectId, details: { opacity: input.opacity } });
      return { success: true };
    }),

  export: protectedProcedure
    .input(z.object({ geometryIds: z.array(z.number()).min(1).max(500), format: z.enum(["kml", "geojson"]) }))
    .mutation(async ({ input, ctx }) => {
      const geometries = await Promise.all(input.geometryIds.map((id) => getGeometryOrThrow(id)));
      const projectIds = Array.from(new Set(geometries.map((geometry) => geometry.projectId)));
      if (projectIds.length !== 1) throw new TRPCError({ code: "BAD_REQUEST", message: "Exporte geometrias de um único projeto por vez" });
      await requireProjectAccess(projectIds[0], ctx.user);

      const records = geometries.map((geometry) => {
        const coordinates = parseAndValidateCoordinates(geometry.type as GeometryType, geometry.coordinates);
        return { geometry, coordinates };
      });
      if (input.format === "geojson") {
        const features = records.map(({ geometry, coordinates }) => ({
          type: "Feature",
          properties: { name: geometry.name, description: geometry.description, color: geometry.color },
          geometry: asGeoJsonGeometry(geometry.type as GeometryType, coordinates),
        }));
        return { data: JSON.stringify({ type: "FeatureCollection", features }, null, 2), filename: `geometrias_projeto_${projectIds[0]}_${Date.now()}.geojson` };
      }

      let kml = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n';
      for (const { geometry, coordinates } of records) {
        kml += `  <Placemark>\n    <name>${escapeXml(geometry.name)}</name>\n`;
        if (geometry.description) kml += `    <description>${escapeXml(geometry.description)}</description>\n`;
        kml += `    ${geometryToKml(geometry.type as GeometryType, coordinates)}\n  </Placemark>\n`;
      }
      kml += "</Document>\n</kml>";
      return { data: kml, filename: `geometrias_projeto_${projectIds[0]}_${Date.now()}.kml` };
    }),

  importBatch: protectedProcedure
    .input(z.object({ projectId: z.number(), layerId: geometryInput.shape.layerId, geometries: z.array(geometryInput.omit({ projectId: true })).min(1).max(500) }))
    .mutation(async ({ input, ctx }) => {
      await requireProjectEditor(input.projectId, ctx.user);
      const validated = input.geometries.map((geometry) => ({
        ...geometry,
        layerId: geometry.layerId === undefined ? input.layerId ?? null : geometry.layerId,
        coordinates: JSON.stringify(parseAndValidateCoordinates(geometry.type, geometry.coordinates)),
      }));
      for (const layerId of Array.from(new Set(validated.map(geometry => geometry.layerId)))) {
        await requireLeafLayer(input.projectId, layerId);
      }
      const database = await db.getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      // One INSERT after all topology/layer checks: no partially imported batch.
      await database.insert(geometries).values(validated.map(geometry => ({ ...geometry, projectId: input.projectId, userId: ctx.user.id, visible: 1, opacity: 100, description: geometry.description || "" })));
      await createAuditLog({ userId: ctx.user.id, action: "geometry.import", entityType: "geometry", entityId: input.projectId, projectId: input.projectId, details: { count: input.geometries.length, topologyValidated: true } });
      return { success: true, count: input.geometries.length };
    }),
});
