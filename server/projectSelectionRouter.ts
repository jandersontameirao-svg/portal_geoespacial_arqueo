import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import booleanIntersects from "@turf/boolean-intersects";
import type { Feature, Geometry } from "geojson";
import { router, protectedProcedure } from "./_core/trpc";
import { getDb, getAllProjects, getProjectsByUser, getLayersByProject } from "./db";
import { projects, projectMembers, userProjectSelection } from "../drizzle/schema";
import { requireProjectAccess, type ProjectActor } from "./projectAccess";
import { vectorFeaturesFromLayer } from "./vectorLayerPromotion";
import { withHierarchyConnectionLock } from "./layersRouter";

/** Feições vetoriais (com geometria) de todas as camadas de um projeto. */
async function projectFeatures(projectId: number): Promise<Feature<Geometry>[]> {
  const layers = await getLayersByProject(projectId);
  return layers.flatMap((layer) =>
    layer.layerType === "vector" ? vectorFeaturesFromLayer(layer.layerData).filter((f) => f.geometry) : []);
}

/** Filters both stale selections and requested ids. Admin still needs an existing project. */
export async function accessibleProjectIds(actor: ProjectActor, requested: number[]): Promise<number[]> {
  const unique = Array.from(new Set(requested));
  if (unique.length === 0) return [];
  const database = await getDb();
  if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  const records = actor.role === "admin"
    ? await database.select({ id: projects.id }).from(projects).where(inArray(projects.id, unique))
    : await database.select({ id: projects.id }).from(projects)
      .innerJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actor.id)))
      .where(inArray(projects.id, unique));
  const candidates = new Set(records.map(row => row.id));
  const allowed: number[] = [];
  for (const projectId of unique.filter(id => candidates.has(id))) {
    try { await requireProjectAccess(projectId, actor); allowed.push(projectId); }
    catch (error) {
      if (error instanceof TRPCError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) continue;
      throw error;
    }
  }
  return allowed;
}

export async function getSafeProjectSelection(actor: ProjectActor): Promise<number[]> {
  const database = await getDb();
  if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  const rows = await database.select({ projectId: userProjectSelection.projectId }).from(userProjectSelection)
    .where(eq(userProjectSelection.userId, actor.id));
  return accessibleProjectIds(actor, rows.map(row => row.projectId));
}

export const projectSelectionRouter = router({
  get: protectedProcedure.query(({ ctx }) => getSafeProjectSelection(ctx.user)),

  // Projetos acessíveis cujas camadas vetoriais cruzam o projeto em foco
  // (interseção geométrica real). Inclui o próprio projeto em foco.
  intersecting: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(input.projectId, ctx.user);
      const focus = await projectFeatures(input.projectId);
      if (!focus.length) return { projectIds: [input.projectId] };

      const accessible = ctx.user.role === "admin" ? await getAllProjects() : await getProjectsByUser(ctx.user.id);
      const candidates = accessible.filter((project) => project.id !== input.projectId).slice(0, 300);
      const matches: number[] = [input.projectId];
      for (const project of candidates) {
        const features = await projectFeatures(project.id);
        const hit = features.some((feature) => focus.some((area) => {
          try { return booleanIntersects(area as never, feature as never); } catch { return false; }
        }));
        if (hit) matches.push(project.id);
      }
      return { projectIds: matches };
    }),
  set: protectedProcedure.input(z.object({ projectIds: z.array(z.number().int().positive()).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const allowed = await accessibleProjectIds(ctx.user, input.projectIds);
      return withHierarchyConnectionLock("selection", ctx.user.id, async database => {
        // Atomically replace only this user's already authorized selection under its row anchor.
        if (allowed.length > 0) {
          await database.insert(userProjectSelection).values(allowed.map(projectId => ({ userId: ctx.user.id, projectId })))
            .onDuplicateKeyUpdate({ set: { userId: ctx.user.id } });
          await database.delete(userProjectSelection).where(and(eq(userProjectSelection.userId, ctx.user.id), notInArray(userProjectSelection.projectId, allowed)));
        } else {
          await database.delete(userProjectSelection).where(eq(userProjectSelection.userId, ctx.user.id));
        }
        return { success: true, count: allowed.length };
      });
    }),
});
