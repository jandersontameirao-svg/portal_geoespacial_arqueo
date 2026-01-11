import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { createAuditLog } from "./db";

export const geometriesRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        type: z.enum(["marker", "polyline", "polygon"]),
        name: z.string().min(1),
        description: z.string().optional(),
        coordinates: z.string(), // JSON string
        color: z.string().default("#3b82f6"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await db.createGeometry({
        ...input,
        userId: ctx.user.id,
        visible: 1,
        opacity: 100,
      });

      await createAuditLog({
        userId: ctx.user.id,
        action: "geometry.create",
        entityType: "geometry",
        entityId: input.projectId,
        details: { name: input.name, type: input.type },
      });

      return { success: true };
    }),

  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      return await db.getGeometriesByProject(input.projectId);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await db.deleteGeometry(input.id);

      await createAuditLog({
        userId: ctx.user.id,
        action: "geometry.delete",
        entityType: "geometry",
        entityId: input.id,
        details: null,
      });

      return { success: true };
    }),

  updateVisibility: protectedProcedure
    .input(z.object({ id: z.number(), visible: z.number().min(0).max(1) }))
    .mutation(async ({ input }) => {
      await db.updateGeometryVisibility(input.id, input.visible);
      return { success: true };
    }),

  updateOpacity: protectedProcedure
    .input(z.object({ id: z.number(), opacity: z.number().min(0).max(100) }))
    .mutation(async ({ input }) => {
      await db.updateGeometryOpacity(input.id, input.opacity);
      return { success: true };
    }),
});
