/**
 * Conexões de mapa — cadastro de fontes externas (WMS/WFS/ArcGIS/GeoJSON/PostGIS)
 * feito pelo usuário. Apenas metadados: o cadastro NÃO contata o endpoint nem
 * guarda credenciais. Só uma fonte WMS com camada pode ficar "ligada" no mapa.
 *
 * Portado da prévia do Codex (previewConnections) para o banco e a auth reais.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { router, protectedProcedure } from "./_core/trpc";
import { getDb, createAuditLog } from "./db";
import { mapConnections, type MapConnection } from "../drizzle/schema";

const TYPES = ["WMS", "WFS", "ArcGIS REST", "GeoJSON", "PostGIS"] as const;

function withStatus(row: MapConnection) {
  return { ...row, status: row.enabled ? "Ligada no mapa" : "Desligada" };
}

/** Valida endereço e camada conforme o tipo, sem contatar o endpoint. */
function validateAddressAndLayer(type: string, address: string, layerRaw: string) {
  if (type === "PostGIS") {
    if (!/^[a-z\d.-]+(?::\d{1,5})?\/[a-z\d_-]+$/i.test(address)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Informe servidor[:porta]/banco, sem credenciais." });
    }
  } else {
    let endpoint: URL;
    try {
      endpoint = new URL(address);
    } catch {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Informe um endereço HTTP ou HTTPS." });
    }
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Use o endereço base, sem credenciais, parâmetros ou fragmento." });
    }
  }
  const layer = type === "WMS" ? layerRaw.trim() : "";
  if (layer && !/^[\w.:-]{1,150}$/.test(layer)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Informe o identificador da camada WMS." });
  }
  return layer;
}

export const connectionsRouter = router({
  list: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(mapConnections).orderBy(desc(mapConnections.createdAt));
    return rows.map(withStatus);
  }),

  save: protectedProcedure
    .input(z.object({
      id: z.number().optional(),
      name: z.string().trim().min(1).max(100),
      type: z.enum(TYPES),
      address: z.string().trim().min(1).max(500),
      layer: z.string().trim().max(150).optional(),
      enabled: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco indisponível." });

      const layer = validateAddressAndLayer(input.type, input.address, input.layer ?? "");
      const enabled = Boolean(input.enabled);
      if (enabled && (input.type !== "WMS" || !layer)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Para exibir no mapa, informe a camada de uma fonte WMS." });
      }

      const values = { name: input.name, type: input.type, address: input.address, layer, enabled };

      let id = input.id;
      if (id != null) {
        const existing = await db.select({ id: mapConnections.id }).from(mapConnections).where(eq(mapConnections.id, id)).limit(1);
        if (existing.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Fonte não encontrada." });
        await db.update(mapConnections).set(values).where(eq(mapConnections.id, id));
      } else {
        const [result] = await db.insert(mapConnections).values({
          ...values,
          createdById: ctx.user.id,
          createdByName: ctx.user.name || ctx.user.email || null,
        });
        id = (result as any).insertId as number;
      }

      await createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: input.id != null ? "mapConnection.update" : "mapConnection.create",
        entityType: "mapConnection",
        entityId: id,
        details: { type: input.type, enabled },
      });

      const [saved] = await db.select().from(mapConnections).where(eq(mapConnections.id, id)).limit(1);
      return withStatus(saved);
    }),
});
