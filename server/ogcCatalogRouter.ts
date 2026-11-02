import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { ogcCatalogVariants, ogcServices } from "../drizzle/schema";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb, createAuditLog } from "./db";
import { normalizeOgcEndpoint, probeOgcCapabilities, selectOgcVariant } from "./ogcCatalogService";
import { classifyEndpointFingerprintMatch, fingerprintOgcEndpoint, ogcEndpointInputSchema } from "./ogcEndpointIdentity";
import { requireProjectEditor } from "./projectAccess";
import { fetchWfsGeoJsonPages } from "./wfsImportService";
import * as db from "./db";

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Acesso restrito a administradores" });
  return next({ ctx });
});

function policy() {
  const configured = (process.env.OGC_ALLOWED_HOSTS || "geoservicos.inde.gov.br").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  return { allowedHosts: configured };
}

async function audit(ctx: any, action: string, entityId: number, details: Record<string, unknown>) {
  await createAuditLog({
    userId: ctx.user.id, userEmail: ctx.user.email || null, userName: ctx.user.name || null,
    action, entityType: "ogc", entityId, projectId: null, details,
    ipAddress: ctx.req.ip || null, userAgent: ctx.req.headers?.["user-agent"] || null,
  });
}

export const ogcCatalogRouter = router({
  listServices: adminProcedure.query(async () => {
    const database = await getDb();
    if (!database) return [];
    return database.select().from(ogcServices).orderBy(asc(ogcServices.name));
  }),

  createDraft: adminProcedure.input(z.object({
    name: z.string().trim().min(3).max(255),
    publisher: z.string().trim().min(2).max(255),
    serviceType: z.enum(["wms", "wfs"]),
    sourceClass: z.enum(["official", "approved_custom"]).default("official"),
    endpoint: ogcEndpointInputSchema,
  })).mutation(async ({ ctx, input }) => {
    const database = await getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco indisponível" });
    let endpoint: string;
    try { endpoint = normalizeOgcEndpoint(input.endpoint, policy()).toString(); }
    catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Endpoint inválido" }); }
    const endpointHash = fingerprintOgcEndpoint(endpoint);
    const [existing] = await database.select().from(ogcServices).where(eq(ogcServices.endpointHash, endpointHash)).limit(1);
    if (existing) {
      const classification = classifyEndpointFingerprintMatch(existing.endpoint, endpoint);
      throw new TRPCError({
        code: "CONFLICT",
        message: classification === "duplicate"
          ? "Este endpoint OGC normalizado já está cadastrado"
          : "Colisão de fingerprint do endpoint OGC detectada; o cadastro foi bloqueado sem sobrescrever o serviço existente",
      });
    }
    const result = await database.insert(ogcServices).values({ ...input, endpoint, endpointHash, createdBy: ctx.user.id, enabled: false, status: "draft", health: "blocked" });
    const id = Number((result as any)[0]?.insertId || 0);
    await audit(ctx, "ogc.service.create", id, { serviceType: input.serviceType, publisher: input.publisher, endpoint });
    return { id, endpoint, status: "draft" as const };
  }),

  validate: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const database = await getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco indisponível" });
    const [service] = await database.select().from(ogcServices).where(eq(ogcServices.id, input.id));
    if (!service) throw new TRPCError({ code: "NOT_FOUND", message: "Serviço OGC não encontrado" });
    const check = await probeOgcCapabilities(service.endpoint, service.serviceType, policy());
    const healthy = check.health === "healthy";
    await database.update(ogcServices).set({
      health: check.health,
      status: healthy ? "validated" : check.health === "tls_error" ? "unhealthy" : "degraded",
      lastValidatedAt: new Date(),
      lastHealthyAt: healthy ? new Date() : service.lastHealthyAt,
      lastError: healthy ? null : check.details || check.health,
      capabilities: healthy ? check.capabilities : service.capabilities,
      revision: service.revision + 1,
    }).where(eq(ogcServices.id, service.id));
    await audit(ctx, "ogc.service.validate", service.id, { health: check.health, httpStatus: check.httpStatus, latencyMs: check.latencyMs, capabilityHash: check.capabilities?.capabilitySha256 || null });
    return check;
  }),

  configureVariant: adminProcedure.input(z.object({
    logicalLayer: z.string().trim().min(3).max(255),
    serviceId: z.number().int().positive(),
    remoteLayer: z.string().trim().min(1).max(500),
    role: z.enum(["primary", "fallback"]),
    priority: z.number().int().min(1).max(100),
    displayCrs: z.string().regex(/^EPSG:\d{4,6}$/).default("EPSG:4674"),
    attribution: z.string().trim().max(2000).optional(),
    enabled: z.boolean().default(false),
  })).mutation(async ({ ctx, input }) => {
    const database = await getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco indisponível" });
    const [service] = await database.select().from(ogcServices).where(eq(ogcServices.id, input.serviceId));
    if (!service) throw new TRPCError({ code: "NOT_FOUND", message: "Serviço OGC não encontrado" });
    if (input.enabled && service.health !== "healthy") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A variante só pode ser habilitada após health check saudável" });
    const result = await database.insert(ogcCatalogVariants).values({ ...input, attribution: input.attribution || null, createdBy: ctx.user.id });
    const id = Number((result as any)[0]?.insertId || 0);
    await audit(ctx, "ogc.variant.configure", id, { logicalLayer: input.logicalLayer, serviceId: input.serviceId, role: input.role, priority: input.priority, enabled: input.enabled });
    return { id, success: true };
  }),

  listPublished: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return [];
    const rows = await database.select({
      id: ogcCatalogVariants.id, logicalLayer: ogcCatalogVariants.logicalLayer, role: ogcCatalogVariants.role, priority: ogcCatalogVariants.priority,
      remoteLayer: ogcCatalogVariants.remoteLayer, displayCrs: ogcCatalogVariants.displayCrs, attribution: ogcCatalogVariants.attribution,
      serviceType: ogcServices.serviceType, endpoint: ogcServices.endpoint, health: ogcServices.health, serviceEnabled: ogcServices.enabled,
    }).from(ogcCatalogVariants).innerJoin(ogcServices, eq(ogcCatalogVariants.serviceId, ogcServices.id))
      .where(and(eq(ogcCatalogVariants.enabled, true), eq(ogcServices.enabled, true))).orderBy(asc(ogcCatalogVariants.logicalLayer), asc(ogcCatalogVariants.priority));
    const layers = new Map<string, typeof rows>();
    for (const row of rows) layers.set(row.logicalLayer, [...(layers.get(row.logicalLayer) || []), { ...row, logicalLayerId: 0, enabled: true } as any]);
    return Array.from(layers.entries()).map(([logicalLayer, variants]) => ({ logicalLayer, ...selectOgcVariant(variants as any) }));
  }),

  importWfsToProject: protectedProcedure.input(z.object({
    projectId: z.number().int().positive(),
    variantId: z.number().int().positive(),
    name: z.string().trim().min(3).max(255).optional(),
  })).mutation(async ({ ctx, input }) => {
    await requireProjectEditor(input.projectId, ctx.user);
    const database = await getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco indisponível" });
    const project = await db.getProjectById(input.projectId);
    const bounds = project?.aoiBounds as { north: number; south: number; east: number; west: number } | null;
    if (!bounds) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Defina a AOI do projeto antes de importar uma base WFS" });
    const rows = await database.select({ variant: ogcCatalogVariants, service: ogcServices })
      .from(ogcCatalogVariants).innerJoin(ogcServices, eq(ogcCatalogVariants.serviceId, ogcServices.id))
      .where(and(eq(ogcCatalogVariants.id, input.variantId), eq(ogcCatalogVariants.enabled, true), eq(ogcServices.enabled, true), eq(ogcServices.serviceType, "wfs"), eq(ogcServices.health, "healthy")))
      .limit(1);
    const row = rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Variante WFS publicada e saudável não encontrada. WMS é somente visual e não pode ser importado." });
    let imported;
    try {
      imported = await fetchWfsGeoJsonPages({ endpoint: row.service.endpoint, remoteLayer: row.variant.remoteLayer, bounds, policy: policy() });
    } catch (error) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: error instanceof Error ? error.message : "Falha ao importar WFS" });
    }
    const layerId = await db.createLayer({
      projectId: input.projectId,
      name: input.name || `${row.variant.logicalLayer} — WFS`,
      description: `Importação WFS paginada de ${row.service.publisher}; recortada pela AOI do projeto`,
      layerType: "vector",
      layerData: imported.collection as any,
      defaultStyle: { color: "#0f766e", weight: 2, fillOpacity: 0.18 },
      crs: row.variant.displayCrs,
      bounds,
      isVisible: false,
      isPublic: false,
      metadata: {
        kind: "wfs-import",
        source: "ogc-wfs",
        serviceId: row.service.id,
        variantId: row.variant.id,
        logicalLayer: row.variant.logicalLayer,
        remoteLayer: row.variant.remoteLayer,
        endpoint: row.service.endpoint,
        featureCount: imported.collection.features.length,
        pagesFetched: imported.pagesFetched,
        bytesFetched: imported.bytesFetched,
        matchedFeatures: imported.matchedFeatures,
        truncated: imported.truncated,
        importedAt: new Date().toISOString(),
        aoiBounds: bounds,
      },
      createdBy: ctx.user.id,
    } as any);
    await audit(ctx, "ogc.wfs.import", layerId, { projectId: input.projectId, serviceId: row.service.id, variantId: row.variant.id, remoteLayer: row.variant.remoteLayer, featureCount: imported.collection.features.length, pagesFetched: imported.pagesFetched, bytesFetched: imported.bytesFetched, truncated: imported.truncated });
    return { success: true, layerId, featureCount: imported.collection.features.length, pagesFetched: imported.pagesFetched, truncated: imported.truncated };
  }),
});
