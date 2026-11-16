/**
 * Sítios arqueológicos do IPHAN (SICG) como camada consultável no mapa e
 * cruzamento com uma área do projeto (ADA/AID/AII ou qualquer polígono).
 * Porte da prévia do Codex para tRPC autenticado. Ver iphanSitesService.ts.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import bbox from "@turf/bbox";
import booleanIntersects from "@turf/boolean-intersects";
import { featureCollection } from "@turf/helpers";
import type { Feature, Geometry } from "geojson";
import { router, protectedProcedure } from "./_core/trpc";
import * as db from "./db";
import { requireProjectEditor } from "./projectAccess";
import { isPromotableVectorLayer, vectorFeaturesFromLayer } from "./vectorLayerPromotion";
import { iphanSitesInView } from "./iphanSitesService";

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
});
