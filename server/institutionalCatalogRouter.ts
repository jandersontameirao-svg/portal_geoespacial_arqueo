import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { ogcCatalogVariants, ogcServices } from "../drizzle/schema";
import {
  INSTITUTIONAL_PUBLISHERS,
  INSTITUTIONAL_SOURCES,
  eligibleInstitutionalProtocols,
} from "../shared/institutionalOgc";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import {
  isExactInstitutionalPair,
  registerInstitutionalSource,
} from "./institutionalOgcRegistration";
import { queryInstitutionalRemote } from "./institutionalOgcRemote";
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Acesso restrito a administradores",
    });
  return next({ ctx });
});
export const institutionalCatalogRouter = router({
  listSources: protectedProcedure.query(async () => {
    const database = await getDb();
    const rows = database
      ? await database
          .select({ service: ogcServices, variant: ogcCatalogVariants })
          .from(ogcCatalogVariants)
          .innerJoin(
            ogcServices,
            eq(ogcCatalogVariants.serviceId, ogcServices.id)
          )
          .where(inArray(ogcServices.publisher, [...INSTITUTIONAL_PUBLISHERS]))
      : [];
    return INSTITUTIONAL_SOURCES.map(source => {
      const eligible = eligibleInstitutionalProtocols(source);
      return {
        publisher: source.publisher,
        label: source.label,
        title: source.title,
        edition: source.edition,
        sourceCrs: source.sourceCrs,
        status: eligible.length ? ("validated" as const) : ("blocked" as const),
        blocker: eligible.length
          ? null
          : (source.blocker ?? "Sem prova positiva"),
        presetId: source.presetId,
        supportsWms: eligible.includes("wms"),
        supportsWfs: eligible.includes("wfs"),
        registeredTypes: eligible.filter(type =>
          rows.some(row =>
            isExactInstitutionalPair(row.service, row.variant, source, type)
          )
        ),
        wmsVersion: "1.1.1" as const,
      };
    });
  }),
  registerSource: adminProcedure
    .input(z.object({ publisher: z.enum(INSTITUTIONAL_PUBLISHERS) }).strict())
    .mutation(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Banco indisponível",
        });
      try {
        return await registerInstitutionalSource({
          database,
          publisher: input.publisher,
          actor: {
            id: ctx.user.id,
            role: ctx.user.role,
            email: ctx.user.email,
            name: ctx.user.name,
            ipAddress: ctx.req.ip,
            userAgent: ctx.req.headers["user-agent"],
          },
        });
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Probe institucional indisponível; nada cadastrado",
        });
      }
    }),
  queryViewport: protectedProcedure
    .input(
      z
        .object({
          variantId: z.number().int().positive(),
          bbox: z
            .object({
              west: z.number().min(-180).max(180),
              south: z.number().min(-90).max(90),
              east: z.number().min(-180).max(180),
              north: z.number().min(-90).max(90),
            })
            .strict()
            .refine(
              b =>
                b.west < b.east &&
                b.south < b.north &&
                b.east - b.west <= 2 &&
                b.north - b.south <= 2,
              "Viewport inválido ou superior a 2°"
            ),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .strict()
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Banco indisponível",
        });
      const [row] = await database
        .select({ service: ogcServices, variant: ogcCatalogVariants })
        .from(ogcCatalogVariants)
        .innerJoin(
          ogcServices,
          eq(ogcCatalogVariants.serviceId, ogcServices.id)
        )
        .where(
          and(
            eq(ogcCatalogVariants.id, input.variantId),
            eq(ogcCatalogVariants.enabled, true),
            eq(ogcServices.enabled, true),
            eq(ogcServices.status, "published"),
            eq(ogcServices.health, "healthy"),
            eq(ogcServices.serviceType, "wfs")
          )
        )
        .limit(1);
      const source =
        row &&
        INSTITUTIONAL_SOURCES.find(s =>
          isExactInstitutionalPair(row.service, row.variant, s, "wfs")
        );
      if (!source)
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Variante WFS institucional comprovada, publicada e saudável não encontrada",
        });
      try {
        const result = await queryInstitutionalRemote({
          publisher: source.publisher,
          bounds: input.bbox,
          limit: input.limit,
        });
        return {
          ...result,
          metadata: {
            ...result.metadata,
            serviceId: row.service.id,
            variantId: row.variant.id,
          },
        };
      } catch (error) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Consulta institucional indisponível",
        });
      }
    }),
});
