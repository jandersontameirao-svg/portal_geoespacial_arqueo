import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { withLayerHierarchyLock } from "../layersRouter";
import { layers, geometries, auditLogs, type InsertGeometry } from "../../drizzle/schema";
import { decodeJson, featureFromStored, collectionBounds, resultMetadata } from "./workspace";

export async function requireLeafLayer(projectId: number, layerId?: number | null) {
  if (layerId == null) return null;
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível" });
  const [layer] = await db.select().from(layers).where(and(eq(layers.id, layerId), eq(layers.projectId, projectId)));
  if (!layer) throw new TRPCError({ code: "FORBIDDEN", message: "Camada não pertence ao projeto." });
  if (layer.isGroup || layer.layerType !== "vector") throw new TRPCError({ code: "BAD_REQUEST", message: "Escolha uma camada vetorial folha." });
  return layer;
}

/** Cria uma nova camada/versão. Nunca apaga, substitui ou anexa dados ao destino existente. */
export async function saveDerivedGeometryBatch(input: {
  projectId: number; userId: number; requestId: string; action: string;
  rows: InsertGeometry[]; metadata: Record<string, unknown>;
}): Promise<{ count: number; geometryIds: number[]; replayed: boolean; layerId: number }> {
  if (!input.rows.length || input.rows.length > 5000 || input.rows.some(row => row.projectId !== input.projectId || row.userId !== input.userId)) throw new Error("INVALID_DERIVED_BATCH");
  const targets = Array.from(new Set(input.rows.map(row => row.layerId ?? null)));
  if (targets.length !== 1) throw new Error("Uma versão derivada exige um único destino.");
  const targetId = targets[0];
  const fc = { type: "FeatureCollection" as const, features: input.rows.map(row => {
    let attributes: Record<string, unknown> = {};
    const description = decodeJson<any>(row.description);
    if (description && typeof description === "object") attributes = description.attributes ?? description;
    return featureFromStored(row, attributes);
  }) };
  const payloadHash = createHash("sha256").update(JSON.stringify({ action: input.action, parameters: input.metadata.parameters, sourceGeometryIds: input.metadata.sourceGeometryIds, sourceLayerIds: input.metadata.sourceLayerIds, ids: input.metadata.ids, rows: input.rows.map(row => [row.layerId, row.type, row.name, row.coordinates]) })).digest("hex");
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível");
  return withLayerHierarchyLock(input.projectId, async tx => {
    const existing = await tx.select({ details: auditLogs.details }).from(auditLogs).where(and(
      eq(auditLogs.projectId, input.projectId), eq(auditLogs.userId, input.userId), eq(auditLogs.action, input.action),
      sql`JSON_UNQUOTE(JSON_EXTRACT(${auditLogs.details}, '$.requestId')) = ${input.requestId}`,
    )).limit(1).for("update");
    if (existing.length) {
      const details = decodeJson<any>(existing[0].details);
      if (details.payloadHash !== payloadHash) throw new TRPCError({ code: "CONFLICT", message: "requestId já utilizado com conteúdo diferente; gere nova confirmação." });
      return { count: details.count, geometryIds: details.geometryIds, replayed: true, layerId: details.layerId };
    }
    let target: typeof layers.$inferSelect | undefined;
    if (targetId != null) {
      [target] = await tx.select().from(layers).where(and(eq(layers.id, targetId), eq(layers.projectId, input.projectId))).for("update");
      if (!target || target.isGroup || target.layerType !== "vector") throw new Error("Destino indisponível ou incompatível.");
    }
    const name = `${target?.name ?? (input.action.startsWith("influence") ? "Áreas de influência" : "Unidades de prospecção")} · Atena ${input.requestId.slice(0, 8)}`.slice(0, 255);
    const created = await tx.insert(layers).values({ projectId: input.projectId, createdBy: input.userId, name, layerType: "vector", isGroup: false,
      parentId: target?.parentId ?? null, sortOrder: (target?.sortOrder ?? 0) + 1, crs: "EPSG:4326", layerData: fc,
      bounds: collectionBounds(fc), isVisible: true, isPublic: false, defaultStyle: { color: input.rows[0].color ?? "#f97316", weight: 2, fillOpacity: 0.25 },
      description: "Nova versão Atena; dados da camada de destino e insumos originais preservados.",
      metadata: { ...resultMetadata({ operation: input.action, requestId: input.requestId, destinationLayerId: targetId, ...input.metadata }), atenaRequestId: input.requestId },
    }).$returningId();
    const layerId = created[0]?.id;
    if (!layerId) throw new Error("Falha ao criar camada de saída");
    const inserted = await tx.insert(geometries).values(input.rows.map(row => ({ ...row, layerId }))).$returningId();
    const geometryIds = inserted.map(row => row.id);
    await tx.insert(auditLogs).values({ userId: input.userId, projectId: input.projectId, action: input.action, entityType: "geometry_batch", entityId: input.projectId,
      details: { ...input.metadata, requestId: input.requestId, payloadHash, count: input.rows.length, geometryIds, layerId, destinationLayerId: targetId, codeVersion: "atena-workspace-bridge-v1" } });
    return { count: input.rows.length, geometryIds, replayed: false, layerId };
  });
}
