import { describe, it, expect, beforeAll } from "vitest";
import { appRouter } from "./routers";

describe("Notifications Router", () => {
  const mockUser = {
    id: "test-user-notifications",
    email: "notifications@test.com",
    name: "Test User Notifications",
    role: "admin" as const,
    openId: "test-open-id-notifications",
  };

  const caller = appRouter.createCaller({
    user: mockUser,
  });

  const unauthenticatedCaller = appRouter.createCaller({
    user: null,
  });

  describe("list", () => {
    it("should return notifications list for authenticated user", async () => {
      const result = await caller.notifications.list({ limit: 10 });
      expect(Array.isArray(result)).toBe(true);
    });

    it("should throw error for unauthenticated user", async () => {
      await expect(
        unauthenticatedCaller.notifications.list({ limit: 10 })
      ).rejects.toThrow();
    });
  });

  describe("unreadCount", () => {
    it("should return unread count for authenticated user", async () => {
      const result = await caller.notifications.unreadCount();
      expect(result).toHaveProperty("count");
      expect(typeof result.count).toBe("number");
    });
  });

  describe("markAllAsRead", () => {
    it("should mark all notifications as read", async () => {
      const result = await caller.notifications.markAllAsRead();
      expect(result).toHaveProperty("success");
      expect(result.success).toBe(true);
    });
  });

  describe("clearRead", () => {
    it("should clear read notifications", async () => {
      const result = await caller.notifications.clearRead();
      expect(result).toHaveProperty("success");
      expect(result.success).toBe(true);
    });
  });
});
