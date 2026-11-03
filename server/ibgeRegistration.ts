import { TRPCError } from "@trpc/server";
import { inArray, or } from "drizzle-orm";
import {
  auditLogs,
  ogcCatalogVariants,
  ogcServices,
  type OgcCatalogVariant,
  type OgcService,
} from "../drizzle/schema";
import {
  IBGE_ATTRIBUTION,
  IBGE_EDITION,
  IBGE_PRESET_ID,
  IBGE_PRESETS,
  IBGE_REMOTE_LAYER,
} from "../shared/ibge";
import type { getDb } from "./db";
import { fingerprintOgcEndpoint } from "./ogcEndpointIdentity";
import { probeIbgePreset, type IbgeProbeEvidence } from "./ibgeRemote";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type IbgeRegistrationActor = {
  id: number;
  role: string;
  email?: string | null;
  name?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};
export function isIbgeCatalogEntry(
  service: { endpoint: string; publisher?: string },
  variant?: { remoteLayer: string; logicalLayer?: string }
) {
  return (
    IBGE_PRESETS.some(p => p.endpoint === service.endpoint) ||
    (!!variant &&
      (variant.remoteLayer === IBGE_REMOTE_LAYER ||
        IBGE_PRESETS.some(p => p.logicalLayer === variant.logicalLayer)))
  );
}
export function isExactIbgePair(
  service: OgcService,
  variant: OgcCatalogVariant,
  preset: (typeof IBGE_PRESETS)[number]
) {
  return (
    service.endpoint === preset.endpoint &&
    service.endpointHash === fingerprintOgcEndpoint(preset.endpoint) &&
    service.name === preset.name &&
    service.publisher === "IBGE" &&
    service.sourceClass === "official" &&
    service.serviceType === preset.serviceType &&
    service.status === "published" &&
    service.enabled &&
    service.health === "healthy" &&
    service.capabilities?.presetId === IBGE_PRESET_ID &&
    service.capabilities?.edition === IBGE_EDITION &&
    service.capabilities?.healthCheck === "targeted-layer-probe" &&
    variant.serviceId === service.id &&
    variant.logicalLayer === preset.logicalLayer &&
    variant.remoteLayer === IBGE_REMOTE_LAYER &&
    variant.role === "primary" &&
    variant.priority === 1 &&
    variant.displayCrs === preset.displayCrs &&
    variant.attribution === IBGE_ATTRIBUTION &&
    variant.enabled
  );
}
/** O chamador operacional deve resolver o actor de usuário autorizado do DB; nunca fabricar sessão/role.
 * O callback probe é injeção de teste/CLI, não é exposto por tRPC. Não chama getDb nem acessa DB por conta própria.
 */
export async function registerIbgePreset(input: {
  database: Database;
  actor: IbgeRegistrationActor;
  probe?: () => Promise<IbgeProbeEvidence>;
}) {
  const { database, actor } = input;
  if (
    !Number.isSafeInteger(actor.id) ||
    actor.id <= 0 ||
    actor.role !== "admin"
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Cadastro IBGE restrito a administrador autorizado",
    });
  const evidence = await (input.probe ?? probeIbgePreset)();
  if (
    evidence.healthy !== true ||
    evidence.presetId !== IBGE_PRESET_ID ||
    evidence.healthCheck !== "targeted-layer-probe"
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Probe direcionado IBGE não aprovado",
    });
  try {
    return await database.transaction(async tx => {
      // Isolamento padrão da conexão (compatível com TiDB); nenhuma configuração de sessão é alterada.
      // Todas as leituras precedem escrita. FOR UPDATE + índices únicos + rollback; nunca UPSERT.
      const services = await tx
        .select()
        .from(ogcServices)
        .where(
          or(
            inArray(
              ogcServices.endpointHash,
              IBGE_PRESETS.map(p => fingerprintOgcEndpoint(p.endpoint))
            ),
            inArray(
              ogcServices.endpoint,
              IBGE_PRESETS.map(p => p.endpoint)
            )
          )
        )
        .for("update");
      const variants = await tx
        .select()
        .from(ogcCatalogVariants)
        .where(
          or(
            inArray(
              ogcCatalogVariants.logicalLayer,
              IBGE_PRESETS.map(p => p.logicalLayer)
            ),
            ...(services.length
              ? [
                  inArray(
                    ogcCatalogVariants.serviceId,
                    services.map(s => s.id)
                  ),
                ]
              : [])
          )
        )
        .for("update");
      const exact = IBGE_PRESETS.map(preset => {
        const service = services.find(
          s =>
            s.endpoint === preset.endpoint &&
            s.endpointHash === fingerprintOgcEndpoint(preset.endpoint)
        );
        const variant = variants.find(
          v => v.logicalLayer === preset.logicalLayer
        );
        return service && variant && isExactIbgePair(service, variant, preset)
          ? {
              serviceId: service.id,
              variantId: variant.id,
              serviceType: preset.serviceType,
              logicalLayer: preset.logicalLayer,
              endpoint: preset.endpoint,
            }
          : null;
      });
      if (services.length || variants.length) {
        if (
          services.length === 2 &&
          variants.length === 2 &&
          exact.every(Boolean)
        )
          return {
            success: true as const,
            idempotent: true,
            records: exact.filter(
              (p): p is NonNullable<typeof p> => p !== null
            ),
            attribution: IBGE_ATTRIBUTION,
            edition: IBGE_EDITION,
            evidence,
          };
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Endpoint ou variante IBGE preexistente não corresponde integralmente ao preset. Nada foi alterado; revisão administrativa necessária.",
        });
      }
      const records: Array<{
        serviceId: number;
        variantId: number;
        serviceType: "wms" | "wfs";
        logicalLayer: string;
        endpoint: string;
      }> = [];
      const now = new Date();
      const audit = async (
        action: string,
        entityId: number,
        details: Record<string, unknown>
      ) =>
        tx.insert(auditLogs).values({
          userId: actor.id,
          userEmail: actor.email ?? null,
          userName: actor.name ?? null,
          action,
          entityType: "ogc",
          entityId,
          projectId: null,
          details,
          ipAddress: actor.ipAddress ?? null,
          userAgent: actor.userAgent ?? null,
        });
      for (const preset of IBGE_PRESETS) {
        const serviceResult = await tx.insert(ogcServices).values({
          name: preset.name,
          publisher: "IBGE",
          serviceType: preset.serviceType,
          sourceClass: "official",
          endpoint: preset.endpoint,
          endpointHash: fingerprintOgcEndpoint(preset.endpoint),
          status: "published",
          enabled: true,
          health: "healthy",
          createdBy: actor.id,
          lastValidatedAt: now,
          lastHealthyAt: now,
          lastError: null,
          capabilities: {
            presetId: IBGE_PRESET_ID,
            edition: IBGE_EDITION,
            healthCheck: "targeted-layer-probe",
            remoteLayers: [IBGE_REMOTE_LAYER],
            provenance: evidence,
          },
        });
        const serviceId = Number((serviceResult as any)[0]?.insertId);
        if (!Number.isSafeInteger(serviceId) || serviceId < 1)
          throw new Error("Cadastro IBGE sem ID de serviço");
        const variantResult = await tx.insert(ogcCatalogVariants).values({
          logicalLayer: preset.logicalLayer,
          serviceId,
          remoteLayer: IBGE_REMOTE_LAYER,
          role: "primary",
          priority: 1,
          displayCrs: preset.displayCrs,
          attribution: IBGE_ATTRIBUTION,
          enabled: true,
          createdBy: actor.id,
        });
        const variantId = Number((variantResult as any)[0]?.insertId);
        if (!Number.isSafeInteger(variantId) || variantId < 1)
          throw new Error("Cadastro IBGE sem ID de variante");
        await audit("ogc.ibge.service.register", serviceId, {
          presetId: IBGE_PRESET_ID,
          edition: IBGE_EDITION,
          endpoint: preset.endpoint,
          serviceType: preset.serviceType,
          attribution: IBGE_ATTRIBUTION,
          healthCheck: "targeted-layer-probe",
          evidence,
        });
        await audit("ogc.ibge.variant.register", variantId, {
          presetId: IBGE_PRESET_ID,
          edition: IBGE_EDITION,
          serviceId,
          remoteLayer: IBGE_REMOTE_LAYER,
          logicalLayer: preset.logicalLayer,
          attribution: IBGE_ATTRIBUTION,
        });
        records.push({
          serviceId,
          variantId,
          serviceType: preset.serviceType,
          logicalLayer: preset.logicalLayer,
          endpoint: preset.endpoint,
        });
      }
      return {
        success: true as const,
        idempotent: false,
        records,
        attribution: IBGE_ATTRIBUTION,
        edition: IBGE_EDITION,
        evidence,
      };
    });
  } catch (error) {
    if (
      (error as any)?.code === "ER_DUP_ENTRY" ||
      (error as any)?.cause?.code === "ER_DUP_ENTRY" ||
      (error as any)?.code === "ER_LOCK_DEADLOCK"
    )
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Concorrência no cadastro IBGE; a transação foi revertida. Consulte o catálogo e tente novamente.",
        cause: error,
      });
    throw error;
  }
}
