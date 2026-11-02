import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  getProjectById: vi.fn(),
  isUserProjectMember: vi.fn(),
}));

vi.mock("./db", () => dbMock);

import { requireProjectAccess, requireProjectEditor } from "./projectAccess";

describe("autorização por projeto", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    dbMock.getProjectById.mockResolvedValue({ id: 10, name: "Projeto isolado" });
  });

  it("permite administrador sem consulta de membro", async () => {
    await expect(requireProjectAccess(10, { id: 1, role: "admin" })).resolves.toBeUndefined();
    expect(dbMock.isUserProjectMember).not.toHaveBeenCalled();
  });

  it("permite membro do projeto para leitura", async () => {
    dbMock.isUserProjectMember.mockResolvedValue(true);
    await expect(requireProjectAccess(10, { id: 2, role: "client" })).resolves.toBeUndefined();
  });

  it("nega não membro e perfil cliente em escrita", async () => {
    dbMock.isUserProjectMember.mockResolvedValue(false);
    await expect(requireProjectAccess(10, { id: 3, role: "client" })).rejects.toThrow("Você não tem acesso");
    await expect(requireProjectEditor(10, { id: 3, role: "client" })).rejects.toThrow("editores e administradores");
  });

  it("permite editor que também é membro do projeto", async () => {
    dbMock.isUserProjectMember.mockResolvedValue(true);
    await expect(requireProjectEditor(10, { id: 2, role: "editor" })).resolves.toBeUndefined();
  });
});
