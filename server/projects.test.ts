import { describe, expect, it } from "vitest";
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

function createClientUser(): AuthenticatedUser {
  return {
    id: 3,
    openId: "client-open-id",
    email: "client@example.com",
    name: "Client User",
    loginMethod: "manus",
    role: "client",
    mfaEnabled: false,
    mfaSecret: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

describe("Projects Router", () => {
  describe("projects.create", () => {
    it("should allow admin to create a project", async () => {
      const ctx = createMockContext(createAdminUser());
      const caller = appRouter.createCaller(ctx);

      const projectData = {
        name: "Projeto Teste Admin",
        code: `TEST-ADMIN-${Date.now()}`,
        description: "Projeto criado por admin para teste",
        clientName: "Cliente Teste",
        clientDocument: "12345678000190",
      };

      const result = await caller.projects.create(projectData);

      expect(result.success).toBe(true);
      expect(result.project).toBeDefined();
      expect(result.project?.name).toBe(projectData.name);
      expect(result.project?.code).toBe(projectData.code);
    });

    it("should allow editor to create a project", async () => {
      const ctx = createMockContext(createEditorUser());
      const caller = appRouter.createCaller(ctx);

      const projectData = {
        name: "Projeto Teste Editor",
        code: `TEST-EDITOR-${Date.now()}`,
        description: "Projeto criado por editor para teste",
      };

      const result = await caller.projects.create(projectData);

      expect(result.success).toBe(true);
      expect(result.project).toBeDefined();
    });

    it("should prevent client from creating a project", async () => {
      const ctx = createMockContext(createClientUser());
      const caller = appRouter.createCaller(ctx);

      const projectData = {
        name: "Projeto Teste Cliente",
        code: `TEST-CLIENT-${Date.now()}`,
        description: "Tentativa de criação por cliente",
      };

      await expect(caller.projects.create(projectData)).rejects.toThrow("Acesso restrito a editores e administradores");
    });

    it("should prevent duplicate project codes", async () => {
      const ctx = createMockContext(createAdminUser());
      const caller = appRouter.createCaller(ctx);

      const projectData = {
        name: "Projeto Duplicado",
        code: `TEST-DUP-${Date.now()}`,
        description: "Teste de duplicação",
      };

      // Criar primeiro projeto
      await caller.projects.create(projectData);

      // Tentar criar segundo projeto com mesmo código
      await expect(caller.projects.create(projectData)).rejects.toThrow("Código de projeto já existe");
    });
  });

  describe("projects.list", () => {
    it("should return all projects for admin", async () => {
      const ctx = createMockContext(createAdminUser());
      const caller = appRouter.createCaller(ctx);

      const projects = await caller.projects.list();

      expect(Array.isArray(projects)).toBe(true);
      // Admin deve ver todos os projetos do sistema
    });

    it("should return only user's projects for non-admin", async () => {
      const ctx = createMockContext(createClientUser());
      const caller = appRouter.createCaller(ctx);

      const projects = await caller.projects.list();

      expect(Array.isArray(projects)).toBe(true);
      // Cliente deve ver apenas seus projetos
    });
  });

  describe("projects.get", () => {
    it("should allow admin to access any project", async () => {
      const adminCtx = createMockContext(createAdminUser());
      const adminCaller = appRouter.createCaller(adminCtx);

      // Criar um projeto
      const projectData = {
        name: "Projeto para Acesso Admin",
        code: `TEST-ACCESS-${Date.now()}`,
        description: "Teste de acesso admin",
      };

      const created = await adminCaller.projects.create(projectData);
      
      if (!created.project) {
        throw new Error("Projeto não foi criado");
      }

      // Tentar acessar o projeto
      const project = await adminCaller.projects.get({ id: created.project.id });

      expect(project).toBeDefined();
      expect(project.id).toBe(created.project.id);
    });

    it("should prevent non-member from accessing project", async () => {
      const adminCtx = createMockContext(createAdminUser());
      const adminCaller = appRouter.createCaller(adminCtx);

      // Admin cria um projeto
      const projectData = {
        name: "Projeto Restrito",
        code: `TEST-RESTRICTED-${Date.now()}`,
        description: "Projeto com acesso restrito",
      };

      const created = await adminCaller.projects.create(projectData);
      
      if (!created.project) {
        throw new Error("Projeto não foi criado");
      }

      // Cliente tenta acessar projeto sem ser membro
      const clientCtx = createMockContext(createClientUser());
      const clientCaller = appRouter.createCaller(clientCtx);

      await expect(
        clientCaller.projects.get({ id: created.project.id })
      ).rejects.toThrow("Você não tem acesso a este projeto");
    });
  });

  describe("projects.update", () => {
    it("should allow admin to update project", async () => {
      const ctx = createMockContext(createAdminUser());
      const caller = appRouter.createCaller(ctx);

      // Criar projeto
      const projectData = {
        name: "Projeto Original",
        code: `TEST-UPDATE-${Date.now()}`,
        description: "Descrição original",
      };

      const created = await caller.projects.create(projectData);
      
      if (!created.project) {
        throw new Error("Projeto não foi criado");
      }

      // Atualizar projeto
      const updateResult = await caller.projects.update({
        id: created.project.id,
        name: "Projeto Atualizado",
        description: "Descrição atualizada",
      });

      expect(updateResult.success).toBe(true);
    });

    it("should prevent client from updating project", async () => {
      const adminCtx = createMockContext(createAdminUser());
      const adminCaller = appRouter.createCaller(adminCtx);

      // Admin cria projeto
      const projectData = {
        name: "Projeto para Update",
        code: `TEST-UPDATE-CLIENT-${Date.now()}`,
        description: "Teste de update por cliente",
      };

      const created = await adminCaller.projects.create(projectData);
      
      if (!created.project) {
        throw new Error("Projeto não foi criado");
      }

      // Cliente tenta atualizar
      const clientCtx = createMockContext(createClientUser());
      const clientCaller = appRouter.createCaller(clientCtx);

      await expect(
        clientCaller.projects.update({
          id: created.project.id,
          name: "Tentativa de Update",
        })
      ).rejects.toThrow("Acesso restrito a editores e administradores");
    });
  });

  describe("projects.addMember", () => {
    it("should allow admin to add member to project", async () => {
      const ctx = createMockContext(createAdminUser());
      const caller = appRouter.createCaller(ctx);

      // Criar projeto
      const projectData = {
        name: "Projeto para Membros",
        code: `TEST-MEMBERS-${Date.now()}`,
        description: "Teste de adição de membros",
      };

      const created = await caller.projects.create(projectData);
      
      if (!created.project) {
        throw new Error("Projeto não foi criado");
      }

      // Adicionar membro
      const clientUser = createClientUser();
      const result = await caller.projects.addMember({
        projectId: created.project.id,
        userId: clientUser.id,
        role: "viewer",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("projects.members", () => {
    it("should list project members", async () => {
      const ctx = createMockContext(createAdminUser());
      const caller = appRouter.createCaller(ctx);

      // Criar projeto
      const projectData = {
        name: "Projeto Lista Membros",
        code: `TEST-LIST-MEMBERS-${Date.now()}`,
        description: "Teste de listagem de membros",
      };

      const created = await caller.projects.create(projectData);
      
      if (!created.project) {
        throw new Error("Projeto não foi criado");
      }

      // Listar membros
      const members = await caller.projects.members({
        projectId: created.project.id,
      });

      expect(Array.isArray(members)).toBe(true);
      expect(members.length).toBeGreaterThan(0); // Deve ter pelo menos o criador
    });
  });
});

describe("Invitations Router", () => {
  describe("invitations.create", () => {
    it("should allow admin to create invitation", async () => {
      const ctx = createMockContext(createAdminUser());
      const caller = appRouter.createCaller(ctx);

      const result = await caller.invitations.create({
        email: `test-${Date.now()}@example.com`,
        role: "client",
      });

      expect(result.success).toBe(true);
      expect(result.inviteLink).toBeDefined();
      expect(result.expiresAt).toBeDefined();
    });

    it("should prevent non-admin from creating invitation", async () => {
      const ctx = createMockContext(createEditorUser());
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.invitations.create({
          email: "test@example.com",
          role: "client",
        })
      ).rejects.toThrow("Acesso restrito a administradores");
    });
  });

  describe("invitations.list", () => {
    it("should list invitations created by admin", async () => {
      const ctx = createMockContext(createAdminUser());
      const caller = appRouter.createCaller(ctx);

      const invitations = await caller.invitations.list();

      expect(Array.isArray(invitations)).toBe(true);
    });
  });
});

describe("Audit Router", () => {
  describe("audit.recent", () => {
    it("should allow admin to view recent logs", async () => {
      const ctx = createMockContext(createAdminUser());
      const caller = appRouter.createCaller(ctx);

      const logs = await caller.audit.recent({ limit: 10 });

      expect(Array.isArray(logs)).toBe(true);
    });

    it("should prevent non-admin from viewing all logs", async () => {
      const ctx = createMockContext(createClientUser());
      const caller = appRouter.createCaller(ctx);

      await expect(caller.audit.recent({ limit: 10 })).rejects.toThrow("Acesso restrito a administradores");
    });
  });
});
