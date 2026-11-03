import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { INDE_CATALOG_LIMITS as LIMITS } from "../shared/indeCatalog";
import { protectedProcedure, router } from "./_core/trpc";
import {
  IndeCatalogError,
  indeCatalogService,
  isSafeLayerName,
  type IndeCatalogService,
} from "./indeCatalogService";

const organizationId = z.string().min(1).max(200);
const mapInput = z
  .object({
    organizationId,
    layerName: z
      .string()
      .min(1)
      .max(512)
      .refine(isSafeLayerName, "Nome de camada inválido"),
    bounds: z.tuple([
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
    ]),
    width: z.number().int().min(1).max(LIMITS.maxWidth),
    height: z.number().int().min(1).max(LIMITS.maxHeight),
    crs: z.enum(["EPSG:4326", "EPSG:3857"]),
  })
  .strict();

async function expose<T>(action: () => T | Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof IndeCatalogError)
      throw new TRPCError({ code: error.kind, message: error.message });
    // Nunca expor corpo remoto, URL derivada ou detalhes internos ao cliente.
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: "Não foi possível consultar a origem WMS do catálogo INDE.",
    });
  }
}

/** Somente leitura WMS remota, sem persistência, importação WFS ou análise vetorial. */
export function createIndeCatalogRouter(
  service: IndeCatalogService = indeCatalogService
) {
  return router({
    organizations: protectedProcedure.query(() =>
      expose(() => service.organizations())
    ),
    layers: protectedProcedure
      .input(z.object({ organizationId }).strict())
      .query(({ input }) => expose(() => service.layers(input.organizationId))),
    mapImage: protectedProcedure
      .input(mapInput)
      .query(({ input }) => expose(() => service.mapImage(input))),
  });
}

/** O agente principal registra esta exportação em routers.ts. */
export const indeCatalogRouter = createIndeCatalogRouter();
