/**
 * ROUTER TRPC - CAMADAS BASE
 * 
 * Gerencia download e atualização de camadas base de dados oficiais
 */

import { router, protectedProcedure, publicProcedure } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { baseLayers } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import {
  downloadTerrasIndigenas,
  downloadTerrasQuilombolas,
  downloadSitiosArqueologicos,
  downloadRodovias,
  calculateCacheExpiration,
  isCacheExpired,
} from "./geodataService";
import { canRefreshBaseLayer, classifyBaseLayerCache, computeRetryAfter } from "./baseLayerCachePolicy";

function withCacheState<T extends { downloadStatus: "pending" | "downloading" | "completed" | "failed"; dataUrl?: string | null; cacheExpiresAt?: Date | string | null; refreshFailureCount?: number | null; retryAfter?: Date | string | null; lastRefreshAttemptAt?: Date | string | null; errorMessage?: string | null }>(layer: T) {
  return { ...layer, cacheState: classifyBaseLayerCache(layer), isCacheStale: classifyBaseLayerCache(layer) === "stale" };
}

export const baseLayersRouter = router({
  /**
   * Lista todas as camadas base
   */
  list: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database connection failed");
    const layers = await db.select().from(baseLayers).where(eq(baseLayers.isActive, true));
    return layers.map(withCacheState);
  }),

  /**
   * Obtém detalhes de uma camada base
   */
  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database connection failed");
      const [layer] = await db
        .select()
        .from(baseLayers)
        .where(and(eq(baseLayers.id, input.id), eq(baseLayers.isActive, true)));
      
      if (!layer) {
        throw new Error("Camada não encontrada");
      }
      
      return withCacheState(layer);
    }),

  /**
   * Baixa terras indígenas da FUNAI
   */
  downloadFunai: protectedProcedure
    .input(
      z.object({
        uf: z.string().length(2).optional(),
        forceUpdate: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database connection failed");
      const { uf, forceUpdate } = input;

      // Verificar se já existe e se o cache é válido
      const [existing] = await db
        .select()
        .from(baseLayers)
        .where(
          and(
            eq(baseLayers.source, "funai"),
            eq(baseLayers.layerType, "terras_indigenas")
          )
        );

      if (existing && !forceUpdate && !isCacheExpired(existing.cacheExpiresAt)) {
        return {
          success: true,
          message: "Camada já está atualizada (cache válido)",
          layer: withCacheState(existing),
        };
      }

      const refreshGate = canRefreshBaseLayer(existing, Boolean(forceUpdate));
      if (!refreshGate.allowed) {
        return { success: false, blockedByBackoff: true, message: refreshGate.reason, retryAfter: refreshGate.retryAfter, layer: existing ? withCacheState(existing) : null };
      }

      // Atualizar status para "downloading"
      if (existing) {
        await db
          .update(baseLayers)
          .set({
            downloadStatus: "downloading",
            lastRefreshAttemptAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(baseLayers.id, existing.id));
      }

      // Fazer download
      const result = await downloadTerrasIndigenas(uf);

      if (!result.success) {
        // Atualizar status para "failed"
        if (existing) {
          await db
            .update(baseLayers)
            .set({
              downloadStatus: "failed",
              errorMessage: result.errorMessage,
              refreshFailureCount: (existing.refreshFailureCount || 0) + 1,
              retryAfter: computeRetryAfter((existing.refreshFailureCount || 0) + 1),
              updatedAt: new Date(),
            })
            .where(eq(baseLayers.id, existing.id));
        }

        throw new Error(result.errorMessage || "Erro ao baixar dados da FUNAI");
      }

      // Salvar ou atualizar no banco
      const cacheExpiresAt = calculateCacheExpiration("funai");

      if (existing) {
        await db
          .update(baseLayers)
          .set({
            dataUrl: result.s3Url,
            s3Key: result.s3Key,
            featureCount: result.featureCount,
            bounds: result.bounds,
            lastDownloadAt: new Date(),
            lastUpdateAt: new Date(),
            cacheExpiresAt,
            downloadStatus: "completed",
            errorMessage: null,
            refreshFailureCount: 0,
            retryAfter: null,
            updatedAt: new Date(),
          })
          .where(eq(baseLayers.id, existing.id));

        return {
          success: true,
          message: `Camada atualizada com sucesso (${result.featureCount} features)`,
          layer: { ...existing, ...result },
        };
      } else {
        const [newLayer] = await db
          .insert(baseLayers)
          .values({
            name: `Terras Indígenas${uf ? ` - ${uf}` : ""}`,
            description: "Terras indígenas demarcadas pela FUNAI",
            source: "funai",
            layerType: "terras_indigenas",
            dataFormat: "geojson",
            dataUrl: result.s3Url,
            s3Key: result.s3Key,
            featureCount: result.featureCount,
            crs: "EPSG:4674",
            bounds: result.bounds,
            lastDownloadAt: new Date(),
            lastUpdateAt: new Date(),
            cacheExpiresAt,
            downloadStatus: "completed",
            isActive: true,
            createdBy: ctx.user.id,
          })
          .$returningId();

        return {
          success: true,
          message: `Camada criada com sucesso (${result.featureCount} features)`,
          layerId: newLayer.id,
        };
      }
    }),

  /**
   * Baixa terras quilombolas do INCRA
   */
  downloadIncra: protectedProcedure
    .input(
      z.object({
        forceUpdate: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database connection failed");
      const { forceUpdate } = input;

      // Verificar se já existe e se o cache é válido
      const [existing] = await db
        .select()
        .from(baseLayers)
        .where(
          and(
            eq(baseLayers.source, "incra"),
            eq(baseLayers.layerType, "terras_quilombolas")
          )
        );

      if (existing && !forceUpdate && !isCacheExpired(existing.cacheExpiresAt)) {
        return {
          success: true,
          message: "Camada já está atualizada (cache válido)",
          layer: withCacheState(existing),
        };
      }

      const refreshGate = canRefreshBaseLayer(existing, Boolean(forceUpdate));
      if (!refreshGate.allowed) {
        return { success: false, blockedByBackoff: true, message: refreshGate.reason, retryAfter: refreshGate.retryAfter, layer: existing ? withCacheState(existing) : null };
      }

      // Atualizar status para "downloading"
      if (existing) {
        await db
          .update(baseLayers)
          .set({
            downloadStatus: "downloading",
            lastRefreshAttemptAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(baseLayers.id, existing.id));
      }

      // Fazer download
      const result = await downloadTerrasQuilombolas();

      if (!result.success) {
        // Atualizar status para "failed"
        if (existing) {
          await db
            .update(baseLayers)
            .set({
              downloadStatus: "failed",
              errorMessage: result.errorMessage,
              refreshFailureCount: (existing.refreshFailureCount || 0) + 1,
              retryAfter: computeRetryAfter((existing.refreshFailureCount || 0) + 1),
              updatedAt: new Date(),
            })
            .where(eq(baseLayers.id, existing.id));
        }

        throw new Error(result.errorMessage || "Erro ao baixar dados do INCRA");
      }

      // Salvar ou atualizar no banco
      const cacheExpiresAt = calculateCacheExpiration("incra");

      if (existing) {
        await db
          .update(baseLayers)
          .set({
            dataUrl: result.s3Url,
            s3Key: result.s3Key,
            featureCount: result.featureCount,
            bounds: result.bounds,
            lastDownloadAt: new Date(),
            lastUpdateAt: new Date(),
            cacheExpiresAt,
            downloadStatus: "completed",
            errorMessage: null,
            refreshFailureCount: 0,
            retryAfter: null,
            updatedAt: new Date(),
          })
          .where(eq(baseLayers.id, existing.id));

        return {
          success: true,
          message: `Camada atualizada com sucesso (${result.featureCount} features)`,
          layer: { ...existing, ...result },
        };
      } else {
        const [newLayer] = await db
          .insert(baseLayers)
          .values({
            name: "Terras Quilombolas",
            description: "Territórios quilombolas titulados pelo INCRA",
            source: "incra",
            layerType: "terras_quilombolas",
            dataFormat: "geojson",
            dataUrl: result.s3Url,
            s3Key: result.s3Key,
            featureCount: result.featureCount,
            crs: "EPSG:4326", // Será reprojetado para EPSG:4674
            bounds: result.bounds,
            lastDownloadAt: new Date(),
            lastUpdateAt: new Date(),
            cacheExpiresAt,
            downloadStatus: "completed",
            isActive: true,
            createdBy: ctx.user.id,
          })
          .$returningId();

        return {
          success: true,
          message: `Camada criada com sucesso (${result.featureCount} features)`,
          layerId: newLayer.id,
        };
      }
    }),

  /**
   * Baixa sítios arqueológicos do IPHAN
   */
  downloadIphan: protectedProcedure
    .input(
      z.object({
        maxFeatures: z.number().optional(),
        forceUpdate: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database connection failed");
      const { maxFeatures, forceUpdate } = input;

      // Verificar se já existe e se o cache é válido
      const [existing] = await db
        .select()
        .from(baseLayers)
        .where(
          and(
            eq(baseLayers.source, "iphan"),
            eq(baseLayers.layerType, "sitios_arqueologicos")
          )
        );

      if (existing && !forceUpdate && !isCacheExpired(existing.cacheExpiresAt)) {
        return {
          success: true,
          message: "Camada já está atualizada (cache válido)",
          layer: withCacheState(existing),
        };
      }

      const refreshGate = canRefreshBaseLayer(existing, Boolean(forceUpdate));
      if (!refreshGate.allowed) {
        return { success: false, blockedByBackoff: true, message: refreshGate.reason, retryAfter: refreshGate.retryAfter, layer: existing ? withCacheState(existing) : null };
      }

      // Atualizar status para "downloading"
      if (existing) {
        await db
          .update(baseLayers)
          .set({
            downloadStatus: "downloading",
            lastRefreshAttemptAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(baseLayers.id, existing.id));
      }

      // Fazer download
      const result = await downloadSitiosArqueologicos(maxFeatures);

      if (!result.success) {
        // Atualizar status para "failed"
        if (existing) {
          await db
            .update(baseLayers)
            .set({
              downloadStatus: "failed",
              errorMessage: result.errorMessage,
              refreshFailureCount: (existing.refreshFailureCount || 0) + 1,
              retryAfter: computeRetryAfter((existing.refreshFailureCount || 0) + 1),
              updatedAt: new Date(),
            })
            .where(eq(baseLayers.id, existing.id));
        }

        throw new Error(result.errorMessage || "Erro ao baixar dados do IPHAN");
      }

      // Salvar ou atualizar no banco
      const cacheExpiresAt = calculateCacheExpiration("iphan");

      if (existing) {
        await db
          .update(baseLayers)
          .set({
            dataUrl: result.s3Url,
            s3Key: result.s3Key,
            featureCount: result.featureCount,
            bounds: result.bounds,
            lastDownloadAt: new Date(),
            lastUpdateAt: new Date(),
            cacheExpiresAt,
            downloadStatus: "completed",
            errorMessage: null,
            refreshFailureCount: 0,
            retryAfter: null,
            updatedAt: new Date(),
          })
          .where(eq(baseLayers.id, existing.id));

        return {
          success: true,
          message: `Camada atualizada com sucesso (${result.featureCount} features)`,
          layer: { ...existing, ...result },
        };
      } else {
        const [newLayer] = await db
          .insert(baseLayers)
          .values({
            name: "Sítios Arqueológicos",
            description: "Sítios arqueológicos cadastrados no SICG/IPHAN",
            source: "iphan",
            layerType: "sitios_arqueologicos",
            dataFormat: "geojson",
            dataUrl: result.s3Url,
            s3Key: result.s3Key,
            featureCount: result.featureCount,
            crs: "EPSG:4674",
            bounds: result.bounds,
            lastDownloadAt: new Date(),
            lastUpdateAt: new Date(),
            cacheExpiresAt,
            downloadStatus: "completed",
            isActive: true,
            createdBy: ctx.user.id,
          })
          .$returningId();

        return {
          success: true,
          message: `Camada criada com sucesso (${result.featureCount} features)`,
          layerId: newLayer.id,
        };
      }
    }),

  /**
   * Baixa rodovias federais do OpenStreetMap
   */
  downloadRodovias: protectedProcedure
    .input(
      z.object({
        state: z.string().length(2).optional(),
        forceUpdate: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database connection failed");
      const { state, forceUpdate } = input;

      // Verificar se já existe e se o cache é válido
      const [existing] = await db
        .select()
        .from(baseLayers)
        .where(
          and(
            eq(baseLayers.source, "osm"),
            eq(baseLayers.layerType, "rodovias")
          )
        );

      if (existing && !forceUpdate && !isCacheExpired(existing.cacheExpiresAt)) {
        return {
          success: true,
          message: "Camada já está atualizada (cache válido)",
          layer: withCacheState(existing),
        };
      }

      const refreshGate = canRefreshBaseLayer(existing, Boolean(forceUpdate));
      if (!refreshGate.allowed) {
        return { success: false, blockedByBackoff: true, message: refreshGate.reason, retryAfter: refreshGate.retryAfter, layer: existing ? withCacheState(existing) : null };
      }

      // Atualizar status para "downloading"
      if (existing) {
        await db
          .update(baseLayers)
          .set({
            downloadStatus: "downloading",
            lastRefreshAttemptAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(baseLayers.id, existing.id));
      }

      // Fazer download
      const result = await downloadRodovias(state);

      if (!result.success) {
        // Atualizar status para "failed"
        if (existing) {
          await db
            .update(baseLayers)
            .set({
              downloadStatus: "failed",
              errorMessage: result.errorMessage,
              refreshFailureCount: (existing.refreshFailureCount || 0) + 1,
              retryAfter: computeRetryAfter((existing.refreshFailureCount || 0) + 1),
              updatedAt: new Date(),
            })
            .where(eq(baseLayers.id, existing.id));
        }

        throw new Error(result.errorMessage || "Erro ao baixar dados do OpenStreetMap");
      }

      // Salvar ou atualizar no banco
      const cacheExpiresAt = calculateCacheExpiration("osm");

      if (existing) {
        await db
          .update(baseLayers)
          .set({
            dataUrl: result.s3Url,
            s3Key: result.s3Key,
            featureCount: result.featureCount,
            bounds: result.bounds,
            lastDownloadAt: new Date(),
            lastUpdateAt: new Date(),
            cacheExpiresAt,
            downloadStatus: "completed",
            errorMessage: null,
            refreshFailureCount: 0,
            retryAfter: null,
            updatedAt: new Date(),
          })
          .where(eq(baseLayers.id, existing.id));

        return {
          success: true,
          message: `Camada atualizada com sucesso (${result.featureCount} features)`,
          layer: { ...existing, ...result },
        };
      } else {
        const [newLayer] = await db
          .insert(baseLayers)
          .values({
            name: `Rodovias Federais${state ? ` - ${state}` : ""}`,
            description: "Rodovias federais do Brasil (OpenStreetMap)",
            source: "osm",
            layerType: "rodovias",
            dataFormat: "geojson",
            dataUrl: result.s3Url,
            s3Key: result.s3Key,
            featureCount: result.featureCount,
            crs: "EPSG:4674",
            bounds: result.bounds,
            lastDownloadAt: new Date(),
            lastUpdateAt: new Date(),
            cacheExpiresAt,
            downloadStatus: "completed",
            isActive: true,
            createdBy: ctx.user.id,
          })
          .$returningId();

        return {
          success: true,
          message: `Camada criada com sucesso (${result.featureCount} features)`,
          layerId: newLayer.id,
        };
      }
    }),

  /**
   * Deleta uma camada base
   */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database connection failed");
      await db
        .update(baseLayers)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(baseLayers.id, input.id));

      return { success: true };
    }),
});
