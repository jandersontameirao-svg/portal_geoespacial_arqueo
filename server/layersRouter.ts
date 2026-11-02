import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, asc, and, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import type { Pool, RowDataPacket } from "mysql2";
import { router, protectedProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { layers, userLayerVisibility } from "../drizzle/schema";
import { requireProjectAccess, requireProjectEditor } from "./projectAccess";
import { effectiveVisibility, wouldCreateCycle, type LayerNode } from "./layerTree";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type QueryDatabase = Omit<ReturnType<typeof drizzle>, "$client">;
const idInput = z.number().int().positive();
const sortInput = z.number().int().min(-2147483648).max(2147483647);

async function databaseOrThrow(): Promise<Database> {
  const database = await getDb();
  if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  return database;
}

/** Reserved transaction + shared row anchor; no connection-local advisory locks. */
export async function withHierarchyConnectionLock<T>(scope: "tree" | "selection", entityId: number, work: (database: QueryDatabase) => Promise<T>): Promise<T> {
  const database = await databaseOrThrow();
  const pool = database.$client as Pool;
  const connection = await pool.promise().getConnection();
  let begun = false;
  let reusable = true;
  try {
    const [version] = await connection.query<RowDataPacket[]>("SELECT VERSION() AS engine");
    await connection.query(String(version[0]?.engine).toLowerCase().includes("tidb") ? "BEGIN PESSIMISTIC" : "START TRANSACTION");
    begun = true;
    const table = scope === "tree" ? "projects" : "users";
    const [anchor] = await connection.query<RowDataPacket[]>(`SELECT \`id\` FROM \`${table}\` WHERE \`id\`=? FOR UPDATE`, [entityId]);
    if (anchor.length !== 1) throw new TRPCError({ code: "NOT_FOUND", message: "Âncora da operação não encontrada" });
    const result = await work(drizzle(connection));
    await connection.commit();
    begun = false;
    return result;
  } catch (error) {
    if (begun) {
      try { await connection.rollback(); }
      catch { reusable = false; connection.destroy(); }
    }
    throw error;
  } finally {
    if (reusable) connection.release();
  }
}

export function withLayerHierarchyLock<T>(projectId: number, work: (database: QueryDatabase) => Promise<T>): Promise<T> {
  return withHierarchyConnectionLock("tree", projectId, work);
}

async function loadProjectLayers(projectId: number, database?: QueryDatabase) {
  const connection = database ?? await databaseOrThrow();
  const query = connection.select().from(layers).where(eq(layers.projectId, projectId)).orderBy(asc(layers.sortOrder), asc(layers.id));
  // TiDB snapshot reads retain start_ts even after waiting for the anchor.
  // FOR UPDATE is a current read and must see the preceding writer's commit.
  return database ? query.for("update") : query;
}

type LayerRow = Awaited<ReturnType<typeof loadProjectLayers>>[number];

function requireGroupParent(rows: LayerRow[], parentId: number | null | undefined) {
  if (parentId == null) return;
  const parent = rows.find(row => row.id === parentId);
  if (!parent || !parent.isGroup) throw new TRPCError({ code: "BAD_REQUEST", message: "O pai precisa ser um grupo do mesmo projeto" });
}

// Internal trusted helpers: callers must authorize the project before calling.
export async function loadLayerNodesForUser(projectId: number, userId: number): Promise<LayerNode[]> {
  const rows = await loadProjectLayers(projectId);
  return nodesForUser(rows, userId);
}

async function nodesForUser(rows: LayerRow[], userId: number): Promise<LayerNode[]> {
  if (rows.length === 0) return [];
  const database = await databaseOrThrow();
  const overrides = await database.select().from(userLayerVisibility).where(and(
    eq(userLayerVisibility.userId, userId), inArray(userLayerVisibility.layerId, rows.map(row => row.id)),
  ));
  const byId = new Map(overrides.map(row => [row.layerId, row.visible]));
  return rows.map(row => ({ id: row.id, parentId: row.parentId, isVisible: byId.get(row.id) ?? row.isVisible }));
}

export async function requireLeafLayer(projectId: number, layerId: number | null | undefined, database?: QueryDatabase): Promise<void> {
  if (layerId == null) return;
  const rows = await loadProjectLayers(projectId, database);
  const layer = rows.find(row => row.id === layerId);
  if (!layer || layer.isGroup) throw new TRPCError({ code: "BAD_REQUEST", message: "Destino precisa ser uma camada folha do mesmo projeto" });
}

export async function loadLayerNodes(projectId: number): Promise<LayerNode[]> {
  return (await loadProjectLayers(projectId)).map(row => ({ id: row.id, parentId: row.parentId, isVisible: row.isVisible }));
}

const createInput = z.object({
  projectId: idInput,
  name: z.string().trim().min(1).max(255),
  parentId: idInput.nullable().optional(),
  sortOrder: sortInput.default(0),
});

export const layersRouter = router({
  list: protectedProcedure.input(z.object({ projectId: idInput })).query(async ({ ctx, input }) => {
    await requireProjectAccess(input.projectId, ctx.user);
    // Do NOT select only geometries-backed layers: legacy layerData/fileId/metadata survive.
    const rows = await loadProjectLayers(input.projectId);
    const nodes = await nodesForUser(rows, ctx.user.id);
    const byId = new Map(nodes.map(node => [node.id, node.isVisible]));
    const visible = effectiveVisibility(nodes);
    return rows.map(row => ({ ...row, userVisible: byId.get(row.id) ?? row.isVisible, effectiveVisible: visible.get(row.id) ?? false }));
  }),

  createGroup: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    await requireProjectEditor(input.projectId, ctx.user);
    return withLayerHierarchyLock(input.projectId, async database => {
      requireGroupParent(await loadProjectLayers(input.projectId, database), input.parentId);
      const [created] = await database.insert(layers).values({
        projectId: input.projectId, createdBy: ctx.user.id, name: input.name, layerType: "vector",
        isGroup: true, parentId: input.parentId ?? null, sortOrder: input.sortOrder, isVisible: true,
      }).$returningId();
      return { id: created.id, success: true as const };
    });
  }),

  createLayer: protectedProcedure.input(createInput.extend({
    layerType: z.enum(["vector", "raster", "tile", "wms", "wmts"]).default("vector"),
    layerData: z.unknown().optional(),
  })).mutation(async ({ ctx, input }) => {
    await requireProjectEditor(input.projectId, ctx.user);
    return withLayerHierarchyLock(input.projectId, async database => {
      requireGroupParent(await loadProjectLayers(input.projectId, database), input.parentId);
      const [created] = await database.insert(layers).values({
        projectId: input.projectId, createdBy: ctx.user.id, name: input.name, layerType: input.layerType,
        layerData: input.layerData ?? null, isGroup: false, parentId: input.parentId ?? null,
        sortOrder: input.sortOrder, isVisible: true,
      }).$returningId();
      return { id: created.id, success: true as const };
    });
  }),

  // A reader may only alter their OWN override, never layers.isVisible or another user.
  setVisibility: protectedProcedure.input(z.object({ id: idInput, visible: z.boolean() })).mutation(async ({ ctx, input }) => {
    const database = await databaseOrThrow();
    const [row] = await database.select().from(layers).where(eq(layers.id, input.id)).limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Camada não encontrada" });
    await requireProjectAccess(row.projectId, ctx.user);
    await database.insert(userLayerVisibility).values({ userId: ctx.user.id, layerId: row.id, visible: input.visible })
      .onDuplicateKeyUpdate({ set: { visible: input.visible } });
    return { success: true };
  }),

  move: protectedProcedure.input(z.object({ id: idInput, parentId: idInput.nullable(), sortOrder: sortInput })).mutation(async ({ ctx, input }) => {
    const database = await databaseOrThrow();
    const [row] = await database.select().from(layers).where(eq(layers.id, input.id)).limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Camada não encontrada" });
    await requireProjectEditor(row.projectId, ctx.user);
    return withLayerHierarchyLock(row.projectId, async locked => {
      const rows = await loadProjectLayers(row.projectId, locked);
      if (!rows.some(node => node.id === input.id)) throw new TRPCError({ code: "NOT_FOUND", message: "Camada não encontrada" });
      requireGroupParent(rows, input.parentId);
      if (wouldCreateCycle(rows, input.id, input.parentId)) throw new TRPCError({ code: "BAD_REQUEST", message: "Movimento criaria um ciclo na árvore" });
      // Never overwrite layerData, metadata (including presentation.renderOrder), fileId or style.
      await locked.update(layers).set({ parentId: input.parentId, sortOrder: input.sortOrder }).where(and(eq(layers.id, input.id), eq(layers.projectId, row.projectId)));
      return { success: true };
    });
  }),
});
