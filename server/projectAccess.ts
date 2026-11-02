import { TRPCError } from "@trpc/server";
import * as db from "./db";

export interface ProjectActor {
  id: number;
  role: "admin" | "editor" | "client";
}

/** Exige que o usuário seja administrador ou membro do projeto solicitado. */
export async function requireProjectAccess(projectId: number, actor: ProjectActor): Promise<void> {
  const project = await db.getProjectById(projectId);
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Projeto não encontrado" });
  }
  if (actor.role === "admin") return;

  const isMember = await db.isUserProjectMember(projectId, actor.id);
  if (!isMember) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Você não tem acesso a este projeto" });
  }
}

/** Exige editor/admin global e vínculo ao projeto para escrita de dados GIS. */
export async function requireProjectEditor(projectId: number, actor: ProjectActor): Promise<void> {
  if (actor.role !== "admin" && actor.role !== "editor") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Acesso restrito a editores e administradores",
    });
  }
  await requireProjectAccess(projectId, actor);
}
