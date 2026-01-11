import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createMockContext(user: AuthenticatedUser): TrpcContext {
  return {
    user,
    req: {
      protocol: "https",
      headers: {},
      ip: "127.0.0.1",
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

function createAdminUser(): AuthenticatedUser {
  return {
    id: 1,
    openId: "admin-open-id",
    email: "admin@grupoarqueo.com",
    name: "Admin User",
    loginMethod: "manus",
    role: "admin",
    mfaEnabled: false,
    mfaSecret: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

function createEditorUser(): AuthenticatedUser {
  return {
    id: 2,
    openId: "editor-open-id",
    email: "editor@grupoarqueo.com",
    name: "Editor User",
    loginMethod: "manus",
    role: "editor",
    mfaEnabled: false,
    mfaSecret: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

describe("Backup Router", () => {
  describe("backup.status", () => {
    it("deve retornar status do sistema de backup para admin", async () => {
      const ctx = createMockContext(createAdminUser());
      const caller = appRouter.createCaller(ctx);
      
      const result = await caller.backup.status();
      
      expect(result).toBeDefined();
      expect(result).toHaveProperty("healthy");
      expect(result).toHaveProperty("lastBackup");
      expect(result).toHaveProperty("recommendation");
    });

    it("deve rejeitar acesso de não-admin", async () => {
      const ctx = createMockContext(createEditorUser());
      const caller = appRouter.createCaller(ctx);
      
      await expect(caller.backup.status()).rejects.toThrow();
    });
  });

  describe("backup.configure", () => {
    it("deve permitir configurar backup para admin", async () => {
      const ctx = createMockContext(createAdminUser());
      const caller = appRouter.createCaller(ctx);
      
      const result = await caller.backup.configure({
        enabled: true,
        schedule: "daily",
        retentionDays: 30,
      });
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });
  });

  describe("backup.list", () => {
    it("deve listar backups para admin", async () => {
      const ctx = createMockContext(createAdminUser());
      const caller = appRouter.createCaller(ctx);
      
      // A função list retorna array direto, não objeto com backups
      const result = await caller.backup.list({ limit: 10 });
      
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
