/**
 * Estúdio Cartográfico — persistência dos produtos (pranchas/atlas) por projeto.
 * Porte do previewProducts da prévia do Codex, generalizado para qualquer
 * projeto (não mais o 11 fixo) e ligado ao banco/auth reais.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { router, protectedProcedure } from "./_core/trpc";
import { getDb, getLayersByProject } from "./db";
import { studioProducts, studioBrands } from "../drizzle/schema";
import { requireProjectAccess, requireProjectEditor } from "./projectAccess";
import { isPromotableVectorLayer, vectorFeaturesFromLayer } from "./vectorLayerPromotion";
import { renderPrancha, renderAtlas, prepareBaseImages, type RenderLayer } from "./studioPranchaService";
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

const marksInput = z.object({ empresa: z.number().optional(), cliente: z.number().optional() }).optional();

/** Resolve os ids das marcas (empresa/cliente) nas imagens/nomes para a prancha. */
async function resolveMarks(marks?: { empresa?: number; cliente?: number }) {
  const ids = [marks?.empresa, marks?.cliente].filter((id): id is number => typeof id === "number");
  if (!ids.length) return undefined;
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(studioBrands).where(inArray(studioBrands.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const empresa = marks?.empresa != null ? byId.get(marks.empresa) : undefined;
  const cliente = marks?.cliente != null ? byId.get(marks.cliente) : undefined;
  return {
    empresaImage: empresa?.image,
    empresaName: empresa?.name,
    clienteImage: cliente?.image,
    clienteName: cliente?.name,
  };
}

export const studioProductsRouter = router({
  // Identidade visual — marcas de empresa/cliente reutilizáveis nas pranchas.
  brands: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select({ id: studioBrands.id, name: studioBrands.name, kind: studioBrands.kind, image: studioBrands.image })
      .from(studioBrands).orderBy(desc(studioBrands.createdAt));
  }),

  saveBrand: protectedProcedure
    .input(z.object({
      name: z.string().trim().min(1).max(120),
      kind: z.enum(["empresa", "cliente"]),
      image: z.string().max(1_200_000),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!/^data:image\/png;base64,/.test(input.image)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Envie o logotipo em PNG (de preferência com fundo transparente)." });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco indisponível." });
      const [result] = await db.insert(studioBrands).values({
        name: input.name, kind: input.kind, image: input.image,
        createdById: ctx.user.id, createdByName: ctx.user.name || ctx.user.email || null,
      });
      const id = (result as any).insertId as number;
      const [saved] = await db.select({ id: studioBrands.id, name: studioBrands.name, kind: studioBrands.kind, image: studioBrands.image })
        .from(studioBrands).where(eq(studioBrands.id, id)).limit(1);
      return saved;
    }),

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
      background: z.string().optional(),
      marks: marksInput,
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(input.projectId, ctx.user);
      const orientation = readOrientation(input.orientation);
      const marks = await resolveMarks(input.marks);
      const options = {
        paper: readPaper(input.paper),
        orientation,
        title: input.title,
        grid: input.grid,
        scale: readScale(input.scale),
        layout: readLayout(input.layout, orientation),
        background: input.background,
        marks,
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
        const baseImages = await prepareBaseImages(renderLayers, options);
        const result = renderPrancha(renderLayers, input.format === "pdf", { ...options, baseImages });
        if (input.format === "pdf") {
          return { format: "pdf" as const, filename: (input.title || "prancha").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80) + ".pdf", base64: (result as Buffer).toString("base64") };
        }
        return { format: "svg" as const, svg: result as string };
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Não foi possível montar a prancha." });
      }
    }),

  // Atlas multipágina (mapa índice + folhas de detalhe) em PDF.
  renderAtlas: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      layerIds: z.array(z.number()).min(1).max(60),
      columns: z.number().int().min(1).max(8),
      rows: z.number().int().min(1).max(8),
      overlap: z.number().min(0).max(30),
      grid: z.number().int().min(1000).max(50000),
      title: z.string().trim().max(120).optional(),
      paper: z.string().optional(),
      orientation: z.string().optional(),
      marks: marksInput,
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(input.projectId, ctx.user);
      const orientation = readOrientation(input.orientation);
      const marks = await resolveMarks(input.marks);
      const all = await getLayersByProject(input.projectId);
      const chosen = input.layerIds
        .map((id) => all.find((layer) => layer.id === id))
        .filter((layer): layer is NonNullable<typeof layer> => !!layer && layer.layerType === "vector" && isPromotableVectorLayer(layer.layerData));
      if (!chosen.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Selecione ao menos uma camada vetorial do projeto." });
      const renderLayers: RenderLayer[] = chosen.map((layer) => ({
        id: layer.id, name: layer.name,
        layerData: layer.layerData as { features: RenderLayer["layerData"]["features"] },
        defaultStyle: layer.defaultStyle as RenderLayer["defaultStyle"],
      }));
      try {
        const pdf = renderAtlas(renderLayers, input.columns, input.rows, input.overlap, input.grid, {
          paper: readPaper(input.paper), orientation, title: input.title, marks,
        });
        return { filename: (input.title || "atlas").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80) + ".pdf", base64: pdf.toString("base64") };
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Não foi possível montar o atlas." });
      }
    }),
});
