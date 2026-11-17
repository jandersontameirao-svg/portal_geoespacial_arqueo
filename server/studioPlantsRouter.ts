/**
 * Estúdio de Plantas — desenhos 2D versionados por projeto, com implantação
 * georreferenciada (UTM/SIRGAS 2000) enviada ao mapa como camada vetorial.
 * Porte de previewPlants da prévia do Codex para tRPC autenticado.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import proj4 from "proj4";
import bbox from "@turf/bbox";
import { router, protectedProcedure } from "./_core/trpc";
import * as db from "./db";
import { studioPlants } from "../drizzle/schema";
import { requireProjectAccess, requireProjectEditor } from "./projectAccess";
import { readPlant, plantGeoJson, metresPerUnit, type Plant, type Point } from "../shared/plant";

type Version = { createdAt: string; plant: unknown };

export const studioPlantsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(input.projectId, ctx.user);
      const database = await db.getDb();
      if (!database) return [];
      const rows = await database.select().from(studioPlants)
        .where(eq(studioPlants.projectId, input.projectId)).orderBy(desc(studioPlants.updatedAt));
      return rows.map((row) => ({ id: row.id, versions: (row.versions as Version[]) ?? [] }));
    }),

  save: protectedProcedure
    .input(z.object({ projectId: z.number(), id: z.number().optional(), baseVersion: z.number().optional(), plant: z.any() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user);
      let plant: Plant;
      try { plant = readPlant(input.plant as Plant); }
      catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Planta inválida." }); }
      const database = await db.getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco indisponível." });
      const entry: Version = { createdAt: new Date().toISOString(), plant };

      if (input.id != null) {
        const [row] = await database.select().from(studioPlants).where(eq(studioPlants.id, input.id)).limit(1);
        if (!row || row.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "Planta não encontrada." });
        const versions = (row.versions as Version[]) ?? [];
        if (input.baseVersion != null && input.baseVersion !== versions.length) {
          throw new TRPCError({ code: "CONFLICT", message: "A planta foi alterada por outra pessoa. Recarregue antes de salvar." });
        }
        const next = [...versions, entry];
        await database.update(studioPlants).set({ versions: next }).where(eq(studioPlants.id, input.id));
        return { id: input.id, versions: next };
      }

      const [result] = await database.insert(studioPlants).values({
        projectId: input.projectId, versions: [entry],
        createdById: ctx.user.id, createdByName: ctx.user.name || ctx.user.email || null,
      });
      const id = (result as any).insertId as number;
      return { id, versions: [entry] };
    }),

  // Envia uma versão georreferenciada ao mapa do projeto como camada vetorial.
  implant: protectedProcedure
    .input(z.object({ projectId: z.number(), id: z.number(), version: z.number().int().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user);
      const database = await db.getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco indisponível." });
      const [row] = await database.select().from(studioPlants).where(eq(studioPlants.id, input.id)).limit(1);
      if (!row || row.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "Planta não encontrada." });
      const versions = (row.versions as Version[]) ?? [];
      const entry = versions[input.version - 1];
      if (!entry) throw new TRPCError({ code: "NOT_FOUND", message: "Versão não encontrada." });

      const plant = readPlant(entry.plant as Plant);
      const o = plant.origin;
      if (!o) throw new TRPCError({ code: "BAD_REQUEST", message: "Defina a implantação UTM/SIRGAS 2000 antes de enviar ao mapa." });

      const utm = proj4("EPSG:4326", `+proj=utm +zone=${o.zone}${o.south ? " +south" : ""} +ellps=GRS80 +units=m +no_defs`);
      const mpu = metresPerUnit(o.unit);
      const rad = o.rotation * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
      const project = (p: Point): Point => {
        const mx = p[0] * mpu, my = p[1] * mpu;
        const east = o.east + mx * cos - my * sin;
        const north = o.north + mx * sin + my * cos;
        const [lon, lat] = utm.inverse([east, north]);
        return [lon, lat];
      };

      const geojson = plantGeoJson(plant, project);
      if (!geojson.features.length) throw new TRPCError({ code: "BAD_REQUEST", message: "A planta não tem elementos de área ou linha para o mapa." });
      const [west, south, east, north] = bbox(geojson as never);

      const name = `Planta · ${plant.title}`.slice(0, 255);
      const layerId = await db.createLayer({
        projectId: input.projectId, fileId: null, name,
        description: `Implantação da planta "${plant.title}" (V${input.version}).`,
        layerType: "vector", layerData: geojson,
        defaultStyle: { color: "#203d37", weight: 1, fillOpacity: 0.2 },
        crs: "EPSG:4326", bounds: { west, south, east, north },
        isVisible: true, isPublic: false,
        metadata: { kind: "studio-plant-implant", plantId: input.id, version: input.version },
        createdBy: ctx.user.id,
      });

      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "studio.plant.implant",
        entityType: "layer",
        entityId: layerId,
        projectId: input.projectId,
        details: { plantId: input.id, version: input.version },
      });
      return { layerId, name };
    }),
});
