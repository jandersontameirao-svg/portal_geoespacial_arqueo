import { router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { projects, projectMembers, files, layers } from "../drizzle/schema";
import { eq, or, like, and, sql, desc } from "drizzle-orm";

/**
 * Router de Busca Global
 * Permite buscar em projetos, arquivos e geometrias
 * Respeita permissões do usuário
 */

export const searchRouter = router({
  /**
   * Busca global em todos os recursos
   */
  global: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(100),
      types: z.array(z.enum(["projects", "files", "layers"])).optional(),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        return { projects: [], files: [], layers: [], total: 0 };
      }

      const { query, types, limit } = input;
      const searchPattern = `%${query}%`;
      const userId = ctx.user.id;
      const isAdmin = ctx.user.role === "admin";

      const results: {
        projects: any[];
        files: any[];
        layers: any[];
        total: number;
      } = {
        projects: [],
        files: [],
        layers: [],
        total: 0,
      };

      // Buscar projetos autorizados do usuário
      let authorizedProjectIds: number[] = [];
      
      if (isAdmin) {
        // Admin vê todos os projetos
        const allProjects = await db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.status, "active"));
        authorizedProjectIds = allProjects.map(p => p.id);
      } else {
        // Usuário normal vê apenas projetos onde é membro
        const memberProjects = await db
          .select({ projectId: projectMembers.projectId })
          .from(projectMembers)
          .where(eq(projectMembers.userId, userId));
        authorizedProjectIds = memberProjects.map(p => p.projectId);
      }

      // Se não tem projetos autorizados, retornar vazio
      if (authorizedProjectIds.length === 0) {
        return results;
      }

      // 1. Buscar Projetos
      if (!types || types.includes("projects")) {
        const projectResults = await db
          .select({
            id: projects.id,
            name: projects.name,
            description: projects.description,
            clientName: projects.clientName,
            createdAt: projects.createdAt,
          })
          .from(projects)
          .where(
            and(
              eq(projects.status, "active"),
              sql`${projects.id} IN (${sql.join(authorizedProjectIds.map(id => sql`${id}`), sql`, `)})`,
              or(
                like(projects.name, searchPattern),
                like(projects.description, searchPattern),
                like(projects.clientName, searchPattern),
                like(projects.code, searchPattern)
              )
            )
          )
          .orderBy(desc(projects.updatedAt))
          .limit(limit);

        results.projects = projectResults.map(p => ({
          ...p,
          type: "project" as const,
        }));
      }

      // 2. Buscar Arquivos
      if (!types || types.includes("files")) {
        const fileResults = await db
          .select({
            id: files.id,
            name: files.name,
            fileType: files.fileType,
            projectId: files.projectId,
            createdAt: files.uploadedAt,
            projectName: projects.name,
          })
          .from(files)
          .innerJoin(projects, eq(files.projectId, projects.id))
          .where(
            and(
              sql`${files.deletedAt} IS NULL`,
              sql`${files.projectId} IN (${sql.join(authorizedProjectIds.map(id => sql`${id}`), sql`, `)})`,
              or(
                like(files.name, searchPattern),
                like(files.originalName, searchPattern)
              )
            )
          )
          .orderBy(desc(files.uploadedAt))
          .limit(limit);

        results.files = fileResults.map(f => ({
          ...f,
          type: "file" as const,
        }));
      }

      // 3. Buscar Camadas/Geometrias
      if (!types || types.includes("layers")) {
        const layerResults = await db
          .select({
            id: layers.id,
            name: layers.name,
            layerType: layers.layerType,
            projectId: layers.projectId,
            createdAt: layers.createdAt,
            projectName: projects.name,
          })
          .from(layers)
          .innerJoin(projects, eq(layers.projectId, projects.id))
          .where(
            and(
              eq(layers.isVisible, true),
              sql`${layers.projectId} IN (${sql.join(authorizedProjectIds.map(id => sql`${id}`), sql`, `)})`,
              or(
                like(layers.name, searchPattern),
                like(layers.description, searchPattern)
              )
            )
          )
          .orderBy(desc(layers.createdAt))
          .limit(limit);

        results.layers = layerResults.map(l => ({
          ...l,
          type: "layer" as const,
        }));
      }

      results.total = results.projects.length + results.files.length + results.layers.length;

      return results;
    }),

  /**
   * Sugestões de busca (autocomplete)
   */
  suggestions: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(50),
      limit: z.number().min(1).max(10).default(5),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        return [];
      }

      const { query, limit } = input;
      const searchPattern = `${query}%`; // Começa com
      const userId = ctx.user.id;
      const isAdmin = ctx.user.role === "admin";

      // Buscar projetos autorizados
      let authorizedProjectIds: number[] = [];
      
      if (isAdmin) {
        const allProjects = await db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.status, "active"));
        authorizedProjectIds = allProjects.map(p => p.id);
      } else {
        const memberProjects = await db
          .select({ projectId: projectMembers.projectId })
          .from(projectMembers)
          .where(eq(projectMembers.userId, userId));
        authorizedProjectIds = memberProjects.map(p => p.projectId);
      }

      if (authorizedProjectIds.length === 0) {
        return [];
      }

      // Buscar nomes de projetos
      const projectSuggestions = await db
        .select({ name: projects.name, type: sql<string>`'project'` })
        .from(projects)
        .where(
          and(
            eq(projects.status, "active"),
            sql`${projects.id} IN (${sql.join(authorizedProjectIds.map(id => sql`${id}`), sql`, `)})`,
            like(projects.name, searchPattern)
          )
        )
        .limit(limit);

      // Buscar nomes de arquivos
      const fileSuggestions = await db
        .select({ name: files.name, type: sql<string>`'file'` })
        .from(files)
        .where(
          and(
            sql`${files.deletedAt} IS NULL`,
            sql`${files.projectId} IN (${sql.join(authorizedProjectIds.map(id => sql`${id}`), sql`, `)})`,
            like(files.name, searchPattern)
          )
        )
        .limit(limit);

      // Combinar e retornar
      const suggestions = [
        ...projectSuggestions.map(s => ({ name: s.name, type: "project" })),
        ...fileSuggestions.map(s => ({ name: s.name, type: "file" })),
      ].slice(0, limit);

      return suggestions;
    }),
});
