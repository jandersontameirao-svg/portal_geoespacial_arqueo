import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { notifications } from "../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

export const notificationsRouter = router({
  // Listar notificações do usuário
  list: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(50).default(20),
      unreadOnly: z.boolean().default(false),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const limit = input?.limit ?? 20;
      const unreadOnly = input?.unreadOnly ?? false;

      const conditions = [eq(notifications.userId, ctx.user.id)];
      if (unreadOnly) {
        conditions.push(eq(notifications.read, false));
      }

      const results = await db
        .select()
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt))
        .limit(limit);

      return results;
    }),

  // Contar notificações não lidas
  unreadCount: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      const results = await db
        .select()
        .from(notifications)
        .where(and(
          eq(notifications.userId, ctx.user.id),
          eq(notifications.read, false)
        ));

      return { count: results.length };
    }),

  // Marcar notificação como lida
  markAsRead: protectedProcedure
    .input(z.object({
      id: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db
        .update(notifications)
        .set({ read: true })
        .where(and(
          eq(notifications.id, input.id),
          eq(notifications.userId, ctx.user.id)
        ));

      return { success: true };
    }),

  // Marcar todas como lidas
  markAllAsRead: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db
        .update(notifications)
        .set({ read: true })
        .where(eq(notifications.userId, ctx.user.id));

      return { success: true };
    }),

  // Criar notificação (admin ou sistema)
  create: adminProcedure
    .input(z.object({
      userId: z.number(),
      type: z.enum(["info", "success", "warning", "error"]).default("info"),
      category: z.enum(["invite", "upload", "project", "system", "security"]).default("system"),
      title: z.string().min(1).max(255),
      message: z.string().min(1),
      link: z.string().max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const result = await db.insert(notifications).values({
        userId: input.userId,
        type: input.type,
        category: input.category,
        title: input.title,
        message: input.message,
        link: input.link,
        read: false,
      });

      return { 
        success: true, 
        id: Number((result as any)[0]?.insertId || 0) 
      };
    }),

  // Deletar notificação
  delete: protectedProcedure
    .input(z.object({
      id: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db
        .delete(notifications)
        .where(and(
          eq(notifications.id, input.id),
          eq(notifications.userId, ctx.user.id)
        ));

      return { success: true };
    }),

  // Limpar todas as notificações lidas
  clearRead: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db
        .delete(notifications)
        .where(and(
          eq(notifications.userId, ctx.user.id),
          eq(notifications.read, true)
        ));

      return { success: true };
    }),
});
