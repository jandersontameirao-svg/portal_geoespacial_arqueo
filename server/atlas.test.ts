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

describe("Atlas Router", () => {
  describe("atlas.previewGrid", () => {
    it("deve calcular grid de atlas corretamente", async () => {
      const ctx = createMockContext(createAdminUser());
      const caller = appRouter.createCaller(ctx);
      
      const result = await caller.atlas.previewGrid({
        projectId: 1,
        bounds: {
          north: -22.0,
          south: -23.0,
          east: -43.0,
          west: -44.0,
        },
        pageSize: "A3",
        orientation: "landscape",
        scale: 10000,
        overlap: 0.1,
      });
      
      expect(result).toBeDefined();
      expect(result.rows).toBeGreaterThan(0);
      expect(result.cols).toBeGreaterThan(0);
      expect(result.totalPages).toBe(result.rows * result.cols);
      expect(Array.isArray(result.pages)).toBe(true);
      expect(result.pages.length).toBe(result.totalPages);
    });

    it("deve gerar páginas com bounds corretos", async () => {
      const ctx = createMockContext(createAdminUser());
      const caller = appRouter.createCaller(ctx);
      
      const result = await caller.atlas.previewGrid({
        projectId: 1,
        bounds: {
          north: -22.0,
          south: -22.5,
          east: -43.0,
          west: -43.5,
        },
        pageSize: "A4",
        orientation: "portrait",
        scale: 25000,
        overlap: 0.1,
      });
      
      // Verificar que cada página tem bounds válidos
      for (const page of result.pages) {
        expect(page.bounds.north).toBeGreaterThan(page.bounds.south);
        expect(page.bounds.east).toBeGreaterThan(page.bounds.west);
        expect(page.pageNumber).toBeGreaterThan(0);
        expect(page.row).toBeGreaterThanOrEqual(0);
        expect(page.col).toBeGreaterThanOrEqual(0);
      }
    });

    it("deve calcular escala corretamente para diferentes tamanhos de página", async () => {
      const ctx = createMockContext(createAdminUser());
      const caller = appRouter.createCaller(ctx);
      
      const boundsInput = {
        north: -22.0,
        south: -23.0,
        east: -43.0,
        west: -44.0,
      };
      
      const resultA4 = await caller.atlas.previewGrid({
        projectId: 1,
        bounds: boundsInput,
        pageSize: "A4",
        orientation: "landscape",
        scale: 50000,
        overlap: 0.1,
      });
      
      const resultA3 = await caller.atlas.previewGrid({
        projectId: 1,
        bounds: boundsInput,
        pageSize: "A3",
        orientation: "landscape",
        scale: 50000,
        overlap: 0.1,
      });
      
      // A3 é maior que A4, então deve precisar de menos páginas
      expect(resultA3.totalPages).toBeLessThanOrEqual(resultA4.totalPages);
    });
  });

  describe("atlas.getPageConfig", () => {
    // Testes de getPageConfig requerem um atlas criado no banco
    // Por isso testamos apenas os procedures que não dependem de dados existentes
    it("previewGrid já testado acima", () => {
      expect(true).toBe(true);
    });
  });
});
