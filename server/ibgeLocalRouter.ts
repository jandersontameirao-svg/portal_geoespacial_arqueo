/**
 * Camadas IBGE locais (malhas oficiais em GeoJSON). Porte do endpoint
 * /previa/ibge da prévia para tRPC autenticado. Ver server/ibgeLocalService.ts
 * para a convenção dos arquivos e o diretório de dados.
 */
import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { ibgeDataAvailability, isIbgeLayerId, readIbgeLayer } from "./ibgeLocalService";

export const ibgeLocalRouter = router({
  availability: protectedProcedure.query(() => ibgeDataAvailability()),

  layer: protectedProcedure
    .input(z.object({
      id: z.string().min(1).max(40),
      bbox: z.string().min(1).max(120),
      projeto: z.string().max(120).optional(),
    }))
    .query(({ input }) => {
      if (!isIbgeLayerId(input.id)) return null;
      const data = readIbgeLayer(input.id, input.bbox, input.projeto ?? null);
      return data ?? null;
    }),
});
