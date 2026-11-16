/**
 * Sítios arqueológicos do IPHAN (SICG) como camada consultável no mapa.
 * Porte da prévia do Codex para tRPC autenticado. Ver iphanSitesService.ts.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "./_core/trpc";
import { iphanSitesInView } from "./iphanSitesService";

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
});
