import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;
function createMockContext(user: AuthenticatedUser): TrpcContext {
  return { user, req: { protocol: "https", headers: {}, ip: "127.0.0.1" } as TrpcContext["req"], res: { clearCookie: () => {} } as TrpcContext["res"] };
}
function user(role: AuthenticatedUser["role"]): AuthenticatedUser {
  return { id: role === "admin" ? 1 : 2, openId: `${role}-open-id`, email: `${role}@grupoarqueo.com`, name: role, loginMethod: "manus", role, mfaEnabled: false, mfaSecret: null, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
}

describe("Backup Router", () => {
  it("informa o bloqueio da recuperação remota para administrador", async () => {
    const result = await appRouter.createCaller(createMockContext(user("admin"))).backup.status();
    expect(result).toHaveProperty("recoverable", false);
    expect(result).toHaveProperty("availability.available", false);
  });

  it("bloqueia criação remota antes de banco/storage", async () => {
    const caller = appRouter.createCaller(createMockContext(user("admin")));
    await expect(caller.backup.create({ description: "não tocar storage remoto" })).rejects.toThrow("Backup recuperável indisponível");
  });

  it("bloqueia agendamento remoto e rejeita não-admin", async () => {
    const admin = appRouter.createCaller(createMockContext(user("admin")));
    await expect(admin.backup.configure({ enabled: true, intervalHours: 24, retentionDays: 30 })).rejects.toThrow("Backup recuperável indisponível");
    const editor = appRouter.createCaller(createMockContext(user("editor")));
    await expect(editor.backup.status()).rejects.toThrow();
  });
});
