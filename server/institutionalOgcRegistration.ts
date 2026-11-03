import { TRPCError } from "@trpc/server";
import { inArray, or } from "drizzle-orm";
import {
  auditLogs,
  ogcCatalogVariants,
  ogcServices,
  type OgcService,
  type OgcCatalogVariant,
} from "../drizzle/schema";
import {
  INSTITUTIONAL_SOURCES,
  eligibleInstitutionalProtocols,
  getInstitutionalSource,
  institutionalLogicalLayer,
  type InstitutionalSource,
  type InstitutionalPublisher,
  type InstitutionalProtocol,
} from "../shared/institutionalOgc";
import type { getDb } from "./db";
import { fingerprintOgcEndpoint } from "./ogcEndpointIdentity";
import {
  probeInstitutionalSource,
  type InstitutionalProbeEvidence,
} from "./institutionalOgcRemote";
type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type InstitutionalRegistrationActor = {
  id: number;
  role: string;
  email?: string | null;
  name?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};
export function isInstitutionalCatalogEntry(
  service: {
    endpoint: string;
    publisher?: string;
    capabilities?: Record<string, any> | null;
  },
  variant?: { remoteLayer: string; logicalLayer?: string }
) {
  return INSTITUTIONAL_SOURCES.some(
    source =>
      service.publisher === source.publisher ||
      service.capabilities?.presetId === source.presetId ||
      Object.values(source.protocols).some(
        p => p?.endpoint === service.endpoint
      ) ||
      (!!variant &&
        (variant.remoteLayer === source.remoteLayer ||
          (["wms", "wfs"] as const).some(
            type =>
              variant.logicalLayer === institutionalLogicalLayer(source, type)
          )))
  );
}
export function isExactInstitutionalPair(
  service: OgcService,
  variant: OgcCatalogVariant,
  source: InstitutionalSource,
  type: InstitutionalProtocol = service.serviceType
) {
  const config = source.protocols[type];
  return (
    !!config &&
    eligibleInstitutionalProtocols(source).includes(type) &&
    service.endpoint === config.endpoint &&
    service.endpointHash === fingerprintOgcEndpoint(config.endpoint) &&
    service.name ===
      `${source.label} — ${source.title} (${type.toUpperCase()})` &&
    service.publisher === source.publisher &&
    service.sourceClass === "official" &&
    service.serviceType === type &&
    service.status === "published" &&
    service.enabled &&
    service.health === "healthy" &&
    service.capabilities?.presetId === source.presetId &&
    service.capabilities?.edition === source.edition &&
    service.capabilities?.healthCheck === "targeted-layer-probe" &&
    service.capabilities?.sourceCrs === source.sourceCrs &&
    service.capabilities?.axisOrder === "longitude,latitude" &&
    service.capabilities?.version === config.version &&
    variant.serviceId === service.id &&
    variant.logicalLayer === institutionalLogicalLayer(source, type) &&
    variant.remoteLayer === source.remoteLayer &&
    variant.role === "primary" &&
    variant.priority === 1 &&
    variant.displayCrs === config.displayCrs &&
    variant.attribution === source.attribution &&
    variant.enabled
  );
}
/** DB injetado é Drizzle/mysql2 real. Callback não é exposto no tRPC e serve apenas a testes. */
export async function registerInstitutionalSource(input: {
  database: Database;
  actor: InstitutionalRegistrationActor;
  publisher: InstitutionalPublisher;
  probe?: () => Promise<InstitutionalProbeEvidence>;
}) {
  const { database, actor, publisher } = input;
  if (!Number.isSafeInteger(actor.id) || actor.id < 1 || actor.role !== "admin")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Cadastro institucional restrito a administrador autorizado",
    });
  const source = getInstitutionalSource(publisher);
  const types = eligibleInstitutionalProtocols(source);
  if (!types.length)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: source.blocker || "Fonte bloqueada sem prova positiva",
    });
  const endpoints = types.map(type => source.protocols[type]!.endpoint);
  if (new Set(endpoints.map(fingerprintOgcEndpoint)).size !== types.length)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "WMS e WFS compartilham identidade única de endpoint; requer caminhos oficiais distintos comprovados. Hash não alterado.",
    });
  // Probe real imediatamente antes da transação: nenhum lock durante HTTP.
  const evidence = await (
    input.probe ?? (() => probeInstitutionalSource(publisher))
  )();
  if (
    evidence.healthy !== true ||
    evidence.strictTls !== true ||
    evidence.redirect !== "error" ||
    evidence.publisher !== publisher ||
    evidence.presetId !== source.presetId ||
    evidence.remoteLayer !== source.remoteLayer ||
    evidence.edition !== source.edition ||
    evidence.healthCheck !== "targeted-layer-probe" ||
    types.some(
      type =>
        !evidence.protocols[type] ||
        !Number.isInteger(evidence.protocols[type]!.httpStatus) ||
        Number(evidence.protocols[type]!.httpStatus) < 200 ||
        Number(evidence.protocols[type]!.httpStatus) >= 300 ||
        evidence.protocols[type]!.crs !==
          (type === "wms" ? "EPSG:3857" : source.sourceCrs) ||
        evidence.protocols[type]!.axisOrder !== "longitude,latitude" ||
        evidence.protocols[type]!.version !== source.protocols[type]!.version
    )
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Probe institucional não aprovado",
    });
  try {
    return await database.transaction(async tx => {
      // Isolamento padrão. Nenhum SET, UPSERT ou alteração de serviço preexistente.
      const services = await tx
        .select()
        .from(ogcServices)
        .where(
          or(
            inArray(
              ogcServices.endpointHash,
              endpoints.map(fingerprintOgcEndpoint)
            ),
            inArray(ogcServices.endpoint, endpoints)
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
              types.map(type => institutionalLogicalLayer(source, type))
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
      const exact = types.map(type => {
        const service = services.find(
          s => s.endpoint === source.protocols[type]!.endpoint
        );
        const variant = variants.find(
          v => v.logicalLayer === institutionalLogicalLayer(source, type)
        );
        return service &&
          variant &&
          isExactInstitutionalPair(service, variant, source, type)
          ? {
              serviceId: service.id,
              variantId: variant.id,
              serviceType: type,
              logicalLayer: variant.logicalLayer,
              endpoint: service.endpoint,
            }
          : null;
      });
      if (
        (services.length || variants.length) &&
        !(
          services.length === types.length &&
          variants.length === types.length &&
          exact.every(Boolean)
        )
      )
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Endpoint ou variante institucional preexistente não corresponde integralmente ao preset; nada alterado",
        });
      if (services.length)
        return {
          success: true as const,
          idempotent: true,
          records: exact.filter((r): r is NonNullable<typeof r> => r !== null),
          attribution: source.attribution,
          edition: source.edition,
          evidence,
        };
      const records: NonNullable<(typeof exact)[number]>[] = [];
      const now = new Date();
      const audit = (
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
      for (const type of types) {
        const config = source.protocols[type]!;
        const result = await tx.insert(ogcServices).values({
          name: `${source.label} — ${source.title} (${type.toUpperCase()})`,
          publisher,
          serviceType: type,
          sourceClass: "official",
          endpoint: config.endpoint,
          endpointHash: fingerprintOgcEndpoint(config.endpoint),
          status: "published",
          enabled: true,
          health: "healthy",
          createdBy: actor.id,
          lastValidatedAt: now,
          lastHealthyAt: now,
          lastError: null,
          capabilities: {
            presetId: source.presetId,
            edition: source.edition,
            healthCheck: "targeted-layer-probe",
            sourceCrs: source.sourceCrs,
            axisOrder: config.axisOrder,
            version: config.version,
            remoteLayers: [source.remoteLayer],
            provenance: evidence,
          },
        });
        const serviceId = Number((result as any)[0]?.insertId);
        if (!Number.isSafeInteger(serviceId) || serviceId < 1)
          throw new Error("Cadastro institucional sem ID de serviço");
        const vr = await tx.insert(ogcCatalogVariants).values({
          logicalLayer: institutionalLogicalLayer(source, type),
          serviceId,
          remoteLayer: source.remoteLayer!,
          role: "primary",
          priority: 1,
          displayCrs: config.displayCrs,
          attribution: source.attribution,
          enabled: true,
          createdBy: actor.id,
        });
        const variantId = Number((vr as any)[0]?.insertId);
        if (!Number.isSafeInteger(variantId) || variantId < 1)
          throw new Error("Cadastro institucional sem ID de variante");
        await audit("ogc.institutional.service.register", serviceId, {
          publisher,
          presetId: source.presetId,
          edition: source.edition,
          serviceType: type,
          endpoint: config.endpoint,
          healthCheck: "targeted-layer-probe",
          evidence,
        });
        await audit("ogc.institutional.variant.register", variantId, {
          publisher,
          presetId: source.presetId,
          serviceId,
          remoteLayer: source.remoteLayer,
          logicalLayer: institutionalLogicalLayer(source, type),
          attribution: source.attribution,
        });
        records.push({
          serviceId,
          variantId,
          serviceType: type,
          logicalLayer: institutionalLogicalLayer(source, type),
          endpoint: config.endpoint,
        });
      }
      return {
        success: true as const,
        idempotent: false,
        records,
        attribution: source.attribution,
        edition: source.edition,
        evidence,
      };
    });
  } catch (error) {
    const codes = [(error as any)?.code, (error as any)?.cause?.code];
    if (
      codes.some(c =>
        ["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(c)
      )
    )
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Concorrência no cadastro institucional; transação revertida. Consulte o catálogo e tente novamente.",
        cause: error,
      });
    throw error;
  }
}
