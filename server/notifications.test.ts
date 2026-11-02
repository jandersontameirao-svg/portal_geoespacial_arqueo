import { describe, it, expect, beforeAll } from "vitest";
import { appRouter } from "./routers";

describe("Notifications Router", () => {
  const mockUser = {
    id: 1,
    email: "synthetic-admin@example.test",
    name: "Synthetic Admin",
    role: "admin" as const,
    openId: "synthetic-admin",
  };

  const caller = appRouter.createCaller({ user: mockUser });
  const unauthenticatedCaller = appRouter.createCaller({ user: null });

  beforeAll(async () => {
    await caller.notifications.create({
      userId: mockUser.id,
      type: "info",
      category: "system",
      title: "Sintética não lida",
      message: "Fixture local descartável para validação de notificações.",
    });
    await caller.notifications.create({
      userId: mockUser.id,
      type: "success",
      category: "project",
      title: "Sintética lida",
      message: "Fixture local descartável para validar limpeza de notificações.",
    });
    const seeded = await caller.notifications.list({ limit: 10 });
    const readSeed = seeded.find((notification) => notification.title === "Sintética lida");
    if (readSeed) await caller.notifications.markAsRead({ id: readSeed.id });
  });

  describe("list", () => {
    it("returns persisted notifications for the authenticated user", async () => {
      const result = await caller.notifications.list({ limit: 10 });
      expect(result).toHaveLength(2);
      expect(result.every((notification) => notification.userId === mockUser.id)).toBe(true);
    });

    it("throws for unauthenticated users", async () => {
      await expect(unauthenticatedCaller.notifications.list({ limit: 10 })).rejects.toThrow();
    });
  });

  describe("unreadCount", () => {
    it("counts the unread persisted notification", async () => {
      await expect(caller.notifications.unreadCount()).resolves.toEqual({ count: 1 });
    });
  });

  describe("markAllAsRead", () => {
    it("persists the read state for every own notification", async () => {
      await expect(caller.notifications.markAllAsRead()).resolves.toEqual({ success: true });
      await expect(caller.notifications.unreadCount()).resolves.toEqual({ count: 0 });
    });
  });

  describe("clearRead", () => {
    it("deletes only the authenticated user's read notifications", async () => {
      await expect(caller.notifications.clearRead()).resolves.toEqual({ success: true });
      await expect(caller.notifications.list({ limit: 10 })).resolves.toEqual([]);
    });
  });
});
