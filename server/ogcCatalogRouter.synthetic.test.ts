import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

function endpointOfLength(length: number): string {
  const prefix = "https://ogc.invalid/";
  return prefix + "a".repeat(length - prefix.length);
}

describeWithDatabase("OGC Catalog Router — banco sintético", () => {
  const caller = appRouter.createCaller({
    user: {
      id: 1,
      openId: "synthetic-admin",
      email: "synthetic-admin@example.test",
      name: "Synthetic Admin",
      role: "admin",
      loginMethod: "synthetic",
      mfaEnabled: false,
      mfaSecret: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {}, ip: "127.0.0.1" } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  });

  it.each([500, 501, 1000])("persiste endpoint de %i caracteres sem truncamento", async (length) => {
    const endpoint = endpointOfLength(length);
    const result = await caller.ogcCatalog.createDraft({
      name: `Serviço sintético ${length}`,
      publisher: "Grupo Arqueo — fixture",
      serviceType: "wms",
      endpoint,
    });

    expect(result.id).toBeGreaterThan(0);
    expect(result.endpoint).toBe(endpoint);
    expect(result.endpoint).toHaveLength(length);
  });

  it("rejeita endpoint de 1.001 caracteres antes de persistir", async () => {
    await expect(caller.ogcCatalog.createDraft({
      name: "Endpoint acima do limite",
      publisher: "Grupo Arqueo — fixture",
      serviceType: "wms",
      endpoint: endpointOfLength(1001),
    })).rejects.toThrow(/no máximo 1000 caracteres/);
  });

  it("bloqueia duplicidade normalizada sem sobrescrever o serviço existente", async () => {
    const endpoint = endpointOfLength(700);
    await caller.ogcCatalog.createDraft({
      name: "Serviço para deduplicação",
      publisher: "Grupo Arqueo — fixture",
      serviceType: "wfs",
      endpoint,
    });

    await expect(caller.ogcCatalog.createDraft({
      name: "Tentativa duplicada",
      publisher: "Grupo Arqueo — fixture",
      serviceType: "wfs",
      endpoint: ` ${endpoint} `,
    })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/já está cadastrado/) });
  });
});
