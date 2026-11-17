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
  // WMS (workspace:camada) e ArcGIS REST (índices numéricos) carregam camada.
  const layer = ["WMS", "ArcGIS REST"].includes(type) ? layerRaw.trim() : "";
  if (layer && !/^[\w.:,-]{1,500}$/.test(layer)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Informe o identificador da camada (WMS: workspace:camada; ArcGIS REST: índices separados por vírgula)." });
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
      layer: z.string().trim().max(500).optional(),
      enabled: z.boolean().optional(),
      groupKey: z.string().trim().max(40).nullish(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco indisponível." });

      const layer = validateAddressAndLayer(input.type, input.address, input.layer ?? "");
      const enabled = Boolean(input.enabled);
      if (enabled && !(["WMS", "ArcGIS REST"].includes(input.type) && layer)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Para exibir no mapa, informe a camada de uma fonte WMS ou ArcGIS REST." });
      }

      // groupKey só é alterado quando enviado (o cadastro admin não o envia,
      // então a organização por grupo é preservada ao ligar/desligar).
      const base = { name: input.name, type: input.type, address: input.address, layer, enabled };
      const values = input.groupKey !== undefined ? { ...base, groupKey: input.groupKey || null } : base;

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

  // Descobre as subcamadas de uma fonte (WMS GetCapabilities / ArcGIS REST),
  // no servidor (sem problema de CORS no navegador). Retorna [{id, label}].
  discover: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const [source] = await db.select().from(mapConnections).where(eq(mapConnections.id, input.id)).limit(1);
      if (!source) throw new TRPCError({ code: "NOT_FOUND", message: "Fonte não encontrada." });
      if (source.type !== "WMS" && source.type !== "ArcGIS REST") return [];

      let endpoint: URL;
      try { endpoint = new URL(source.address); } catch { return []; }
      if (!["http:", "https:"].includes(endpoint.protocol)) return [];

      try {
        if (source.type === "ArcGIS REST") {
          endpoint.searchParams.set("f", "json");
          const response = await fetch(endpoint, { signal: AbortSignal.timeout(15000), redirect: "error" });
          if (!response.ok) return [];
          const body = await response.json();
          const layers: Array<{ id: unknown; name?: unknown }> = Array.isArray(body?.layers) ? body.layers : [];
          return layers
            .filter((l) => Number.isInteger(l.id))
            .slice(0, 200)
            .map((l) => ({ id: String(l.id), label: String(l.name ?? l.id).slice(0, 180) }));
        }
        // WMS GetCapabilities
        endpoint.searchParams.set("SERVICE", "WMS");
        endpoint.searchParams.set("REQUEST", "GetCapabilities");
        endpoint.searchParams.set("VERSION", "1.3.0");
        const response = await fetch(endpoint, { signal: AbortSignal.timeout(15000), redirect: "error" });
        if (!response.ok) return [];
        const xml = await response.text();
        const seen = new Set<string>();
        const result: Array<{ id: string; label: string }> = [];
        // Captura pares <Name>…</Name><Title>…</Title> das camadas folha (ordem do GeoServer).
        const re = /<Name>([^<]+)<\/Name>\s*<Title>([^<]*)<\/Title>/g;
        let match: RegExpExecArray | null;
        while ((match = re.exec(xml)) && result.length < 200) {
          const id = match[1].trim();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          result.push({ id, label: (match[2].trim() || id).slice(0, 180) });
        }
        return result;
      } catch {
        return [];
      }
    }),

  // Desliga todas as conexões ligadas (usado por "Limpar mapa"). Mantém o cadastro.
  disableAll: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco indisponível." });
    await db.update(mapConnections).set({ enabled: false }).where(eq(mapConnections.enabled, true));
    await createAuditLog({
      userId: ctx.user.id,
      userEmail: ctx.user.email || null,
      userName: ctx.user.name || null,
      action: "mapConnection.disableAll",
      entityType: "mapConnection",
      entityId: 0,
    });
    return { success: true };
  }),
});
