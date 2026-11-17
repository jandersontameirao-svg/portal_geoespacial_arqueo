/**
 * Sítios arqueológicos do IPHAN (SICG) como camada consultável no mapa e
 * cruzamento com uma área do projeto (ADA/AID/AII ou qualquer polígono).
 * Porte da prévia do Codex para tRPC autenticado. Ver iphanSitesService.ts.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import bbox from "@turf/bbox";
import booleanIntersects from "@turf/boolean-intersects";
import { featureCollection } from "@turf/helpers";
import type { Feature, Geometry } from "geojson";
import { router, protectedProcedure } from "./_core/trpc";
import * as db from "./db";
import { requireProjectAccess, requireProjectEditor } from "./projectAccess";
import { isPromotableVectorLayer, vectorFeaturesFromLayer } from "./vectorLayerPromotion";
import { iphanSitesInView } from "./iphanSitesService";
import { iphanKnowledge } from "../drizzle/schema";

// Dados de um sítio do IPHAN para guardar no acervo ("Guardar com a Atena").
const siteInput = z.object({
  id: z.number().int(),
  codigo: z.string().max(100).optional(),
  nome: z.string().max(300).optional(),
  classificacao: z.string().max(150).optional(),
  tipoBem: z.string().max(150).optional(),
  sintese: z.string().max(12000).optional(),
  fonte: z.string().max(150).optional(),
  camada: z.string().max(100).optional(),
});

function polygonAreas(features: Feature<Geometry>[]): Feature<Geometry>[] {
  return features.filter((feature) => feature.geometry && /Polygon$/.test(feature.geometry.type));
}

export const iphanSitesRouter = router({
  inView: protectedProcedure
    .input(z.object({ bbox: z.string().min(1).max(120) }))
    .query(async ({ input }) => {
      try {
        return await iphanSitesInView(input.bbox);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: error instanceof Error ? error.message : "Não foi possível consultar os sítios do IPHAN.",
        });
      }
    }),

  // Cruza os sítios do IPHAN com o polígono de uma camada do projeto (ADA/AID/
  // AII etc.) e salva os sítios que caem dentro como nova camada vetorial.
  crossLayer: protectedProcedure
    .input(z.object({ projectId: z.number(), layerId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user);
      const layer = await db.getLayerById(input.layerId);
      if (!layer || layer.projectId !== input.projectId || layer.layerType !== "vector" || !isPromotableVectorLayer(layer.layerData)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Camada vetorial do projeto não encontrada" });
      }
      const areas = polygonAreas(vectorFeaturesFromLayer(layer.layerData));
      if (!areas.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A camada selecionada não tem polígonos para cruzar." });
      }
      const [west, south, east, north] = bbox(featureCollection(areas as never));

      let sites;
      try {
        sites = await iphanSitesInView([west, south, east, north].join(","));
      } catch (error) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: error instanceof Error ? error.message : "IPHAN indisponível." });
      }

      const inside = sites.features.filter((site) =>
        site.geometry && areas.some((area) => booleanIntersects(area as never, site as never)));
      if (!inside.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Nenhum sítio do IPHAN cai dentro da área selecionada." });
      }

      const output = { type: "FeatureCollection" as const, features: inside };
      const name = `Sítios IPHAN · ${layer.name}`.slice(0, 255);
      const layerId = await db.createLayer({
        projectId: input.projectId,
        fileId: null,
        name,
        description: `Sítios do IPHAN (SICG) que intersectam ${layer.name}.`,
        layerType: "vector",
        layerData: output,
        defaultStyle: { color: "#b84c1b", weight: 1, fillOpacity: 0.15 },
        crs: "EPSG:4326",
        bounds: { west, south, east, north },
        isVisible: true,
        isPublic: false,
        metadata: { kind: "iphan-sites-crossing", source: "GeoServer IPHAN / SICG", areaLayerId: input.layerId, siteCount: inside.length },
        createdBy: ctx.user.id,
      });

      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "iphan.sites.crossLayer",
        entityType: "layer",
        entityId: layerId,
        projectId: input.projectId,
        details: { areaLayerId: input.layerId, siteCount: inside.length },
        ipAddress: ctx.req.ip || null,
        userAgent: ctx.req.headers?.["user-agent"] || null,
      });

      return { success: true, layerId, name, count: inside.length };
    }),

  // Acervo de sítios do IPHAN — guarda o sítio consultado ("Guardar com a
  // Atena"). projectId nulo = acervo global (mapa sem projeto).
  saveKnowledge: protectedProcedure
    .input(z.object({ projectId: z.number().optional(), site: siteInput }))
    .mutation(async ({ ctx, input }) => {
      if (input.projectId != null) await requireProjectEditor(input.projectId, ctx.user);
      const database = await db.getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco indisponível." });
      const projectId = input.projectId ?? null;
      const projectMatch = projectId == null ? isNull(iphanKnowledge.projectId) : eq(iphanKnowledge.projectId, projectId);

      const existing = await database.select({ id: iphanKnowledge.id }).from(iphanKnowledge)
        .where(and(projectMatch, eq(iphanKnowledge.siteId, input.site.id))).limit(1);
      const values = {
        projectId, siteId: input.site.id,
        codigo: input.site.codigo ?? null,
        nome: input.site.nome ?? null,
        classificacao: input.site.classificacao ?? null,
        tipoBem: input.site.tipoBem ?? null,
        sintese: input.site.sintese ?? null,
        fonte: input.site.fonte ?? "IPHAN / SICG",
        camada: input.site.camada ?? null,
      };
      if (existing.length) {
        await database.update(iphanKnowledge).set(values).where(eq(iphanKnowledge.id, existing[0].id));
      } else {
        await database.insert(iphanKnowledge).values({
          ...values,
          savedById: ctx.user.id,
          savedByName: ctx.user.name || ctx.user.email || null,
        });
      }
      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "iphan.knowledge.save",
        entityType: "iphanKnowledge",
        entityId: input.site.id,
        projectId: input.projectId ?? null,
        details: { nome: input.site.nome ?? null, codigo: input.site.codigo ?? null },
      });
      return { success: true, updated: existing.length > 0 };
    }),

  // Lista o acervo de sítios guardados (do projeto ou global).
  knowledge: protectedProcedure
    .input(z.object({ projectId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      if (input.projectId != null) await requireProjectAccess(input.projectId, ctx.user);
      const database = await db.getDb();
      if (!database) return [];
      const projectId = input.projectId ?? null;
      const projectMatch = projectId == null ? isNull(iphanKnowledge.projectId) : eq(iphanKnowledge.projectId, projectId);
      return database.select().from(iphanKnowledge).where(projectMatch).orderBy(desc(iphanKnowledge.createdAt));
    }),
});
