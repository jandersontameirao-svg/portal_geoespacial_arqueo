import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { ANEEL_SIGA_UFS } from "../shared/aneelSiga";
import { aneelSigaService } from "./aneelSigaService";

export function createAneelSigaRouter(service: Pick<typeof aneelSigaService, "query"> = aneelSigaService) {
  return router({
    query: protectedProcedure
      .input(z.object({
        offset: z.number().int().min(0).max(1000000).default(0),
        limit: z.number().int().min(1).max(50).default(20),
        uf: z.enum(ANEEL_SIGA_UFS).optional(),
      }).strict())
      .query(({ input }) => service.query(input)),
  });
}
export const aneelSigaRouter = createAneelSigaRouter();
