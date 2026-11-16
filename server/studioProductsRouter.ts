/**
 * Estúdio Cartográfico — persistência dos produtos (pranchas/atlas) por projeto.
 * Porte do previewProducts da prévia do Codex, generalizado para qualquer
 * projeto (não mais o 11 fixo) e ligado ao banco/auth reais.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { router, protectedProcedure } from "./_core/trpc";
import { getDb, getLayersByProject } from "./db";
import { studioProducts } from "../drizzle/schema";
import { requireProjectAccess, requireProjectEditor } from "./projectAccess";
import { isPromotableVectorLayer, vectorFeaturesFromLayer } from "./vectorLayerPromotion";
import { renderPrancha, type RenderLayer } from "./studioPranchaService";
import { readPaper, readOrientation, readLayout, readScale } from "../shared/studioLayout";

/** Camadas vetoriais do projeto com flags de geometria (área/linha/ponto). */
async function studioLayers(projectId: number) {
  const layers = await getLayersByProject(projectId);
  return layers
    .filter((layer) => layer.layerType === "vector" && isPromotableVectorLayer(layer.layerData))
    .map((layer) => {
      const types = vectorFeaturesFromLayer(layer.layerData).map((f) => f.geometry?.type ?? "");
      const has = (re: RegExp) => types.some((t) => re.test(t));
      return {
        id: layer.id,
        name: layer.name,
        color: (layer.defaultStyle as { color?: string } | null)?.color ?? null,
        area: has(/Polygon$/),
        line: has(/LineString$/),
        point: has(/Point$/),
      };
    });
}

const productInput = z.object({
  productKey: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(120),
  config: z.record(z.string(), z.unknown()),
});

export const studioProductsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(input.projectId, ctx.user);
      const db = await getDb();
      if (!db) return { products: [], layers: [] };
      const products = await db.select().from(studioProducts).where(eq(studioProducts.projectId, input.projectId));
      return { products, layers: await studioLayers(input.projectId) };
    }),

  save: protectedProcedure
    .input(z.object({ projectId: z.number() }).and(productInput))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco indisponível." });

      const existing = await db.select({ id: studioProducts.id }).from(studioProducts)
        .where(and(eq(studioProducts.projectId, input.projectId), eq(studioProducts.productKey, input.productKey))).limit(1);

      if (existing.length) {
        await db.update(studioProducts).set({ title: input.title, config: input.config })
          .where(eq(studioProducts.id, existing[0].id));
      } else {
        await db.insert(studioProducts).values({
          projectId: input.projectId,
          productKey: input.productKey,
          title: input.title,
          config: input.config,
          createdById: ctx.user.id,
          createdByName: ctx.user.name || ctx.user.email || null,
        });
      }
      const [saved] = await db.select().from(studioProducts)
        .where(and(eq(studioProducts.projectId, input.projectId), eq(studioProducts.productKey, input.productKey))).limit(1);
      return saved;
    }),

  // Renderiza a prancha (SVG para a prévia, PDF para baixar) a partir das
  // camadas escolhidas e dos parâmetros do produto.
  render: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      layerIds: z.array(z.number()).min(1).max(60),
      format: z.enum(["svg", "pdf"]),
      title: z.string().trim().max(120).optional(),
      paper: z.string().optional(),
      orientation: z.string().optional(),
      grid: z.number().int().min(1000).max(50000).optional(),
      scale: z.number().int().optional(),
      layout: z.unknown().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(input.projectId, ctx.user);
      const orientation = readOrientation(input.orientation);
      const options = {
        paper: readPaper(input.paper),
        orientation,
        title: input.title,
        grid: input.grid,
        scale: readScale(input.scale),
        layout: readLayout(input.layout, orientation),
      };
      const all = await getLayersByProject(input.projectId);
      const chosen = input.layerIds
        .map((id) => all.find((layer) => layer.id === id))
        .filter((layer): layer is NonNullable<typeof layer> => !!layer && layer.layerType === "vector" && isPromotableVectorLayer(layer.layerData));
      if (!chosen.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Selecione ao menos uma camada vetorial do projeto." });
      }
      const renderLayers: RenderLayer[] = chosen.map((layer) => ({
        id: layer.id,
        name: layer.name,
        layerData: layer.layerData as { features: RenderLayer["layerData"]["features"] },
        defaultStyle: layer.defaultStyle as RenderLayer["defaultStyle"],
      }));
      try {
        const result = renderPrancha(renderLayers, input.format === "pdf", options);
        if (input.format === "pdf") {
          return { format: "pdf" as const, filename: (input.title || "prancha").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80) + ".pdf", base64: (result as Buffer).toString("base64") };
        }
        return { format: "svg" as const, svg: result as string };
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Não foi possível montar a prancha." });
      }
    }),
});
