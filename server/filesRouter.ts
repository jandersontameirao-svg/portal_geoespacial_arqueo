import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";

// ============================================================================
// HELPER: Verificar acesso ao projeto
// ============================================================================

async function checkProjectAccess(projectId: number, userId: number, userRole: string) {
  if (userRole === "admin") {
    return true; // Admin tem acesso a tudo
  }

  const isMember = await db.isUserProjectMember(projectId, userId);
  if (!isMember) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Você não tem acesso a este projeto",
    });
  }

  return true;
}

// ============================================================================
// HELPER: Editor ou Admin Procedure
// ============================================================================

const editorProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin" && ctx.user.role !== "editor") {
    throw new TRPCError({ 
      code: "FORBIDDEN", 
      message: "Acesso restrito a editores e administradores" 
    });
  }
  return next({ ctx });
});

// ============================================================================
// FILES ROUTER
// ============================================================================

export const filesRouter = router({
  // Upload de arquivo
  upload: editorProcedure
    .input(z.object({
      projectId: z.number(),
      filename: z.string(),
      mimeType: z.string(),
      size: z.number(),
      fileData: z.string(), // Base64 encoded
      category: z.enum(["geospatial", "document", "image", "other"]),
      description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verificar acesso ao projeto
      await checkProjectAccess(input.projectId, ctx.user.id, ctx.user.role);

      // Validar tamanho (100MB max)
      const MAX_SIZE = 100 * 1024 * 1024; // 100MB
      if (input.size > MAX_SIZE) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Arquivo muito grande. Tamanho máximo: 100MB",
        });
      }

      // Validar tipo MIME
      const allowedMimeTypes = [
        // Geoespacial
        "application/vnd.google-earth.kml+xml",
        "application/vnd.google-earth.kmz",
        "application/zip", // Para shapefiles
        "application/x-zip-compressed",
        // Documentos
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        // Imagens
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/tiff",
      ];

      if (!allowedMimeTypes.includes(input.mimeType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Tipo de arquivo não permitido",
        });
      }

      // Gerar chave única para o arquivo
      const fileKey = `projects/${input.projectId}/files/${nanoid()}-${input.filename}`;

      // Converter base64 para buffer
      const fileBuffer = Buffer.from(input.fileData, "base64");

      // Upload para S3
      const { url } = await storagePut(fileKey, fileBuffer, input.mimeType);

      // Determinar fileType baseado no mimeType
      let fileType: "kml" | "kmz" | "shp" | "pdf" | "docx" | "xlsx" | "image" | "other" = "other";
      if (input.mimeType === "application/vnd.google-earth.kml+xml") fileType = "kml";
      else if (input.mimeType === "application/vnd.google-earth.kmz") fileType = "kmz";
      else if (input.mimeType === "application/zip" || input.mimeType === "application/x-zip-compressed") fileType = "shp";
      else if (input.mimeType === "application/pdf") fileType = "pdf";
      else if (input.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") fileType = "docx";
      else if (input.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") fileType = "xlsx";
      else if (input.mimeType.startsWith("image/")) fileType = "image";

      // Salvar metadados no banco
      await db.createFile({
        projectId: input.projectId,
        name: input.filename,
        originalName: input.filename,
        fileType,
        mimeType: input.mimeType,
        fileSize: input.size,
        s3Key: fileKey,
        s3Url: url,
        isGeospatial: input.category === "geospatial",
        metadata: input.description ? { description: input.description } : null,
        uploadedBy: ctx.user.id,
      });

      // Buscar o arquivo criado
      const files = await db.getFilesByProject(input.projectId);
      const file = files.find(f => f.s3Key === fileKey);

      if (!file) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Erro ao criar arquivo",
        });
      }

      // Log de auditoria
      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "file.upload",
        entityType: "file",
        entityId: file.id,
        projectId: input.projectId,
        details: {
          filename: input.filename,
          size: input.size,
          fileType,
        },
        ipAddress: ctx.req.ip || null,
        userAgent: ctx.req.headers?.["user-agent"] || null,
      });

      return {
        success: true,
        file,
      };
    }),

  // Listar arquivos do projeto
  list: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      category: z.enum(["geospatial", "document", "image", "other", "all"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      // Verificar acesso ao projeto
      await checkProjectAccess(input.projectId, ctx.user.id, ctx.user.role);

      let files = await db.getFilesByProject(input.projectId);

      // Filtrar por categoria se especificado
      if (input.category && input.category !== "all") {
        const categoryMap: Record<string, string[]> = {
          geospatial: ["kml", "kmz", "shp"],
          document: ["pdf", "docx", "xlsx"],
          image: ["image"],
          other: ["other"],
        };
        const types = categoryMap[input.category] || [];
        files = files.filter(f => types.includes(f.fileType));
      }

      return files;
    }),

  // Obter detalhes de um arquivo
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const file = await db.getFileById(input.id);

      if (!file) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Arquivo não encontrado",
        });
      }

      // Verificar acesso ao projeto
      await checkProjectAccess(file.projectId, ctx.user.id, ctx.user.role);

      // Log de auditoria
      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "file.view",
        entityType: "file",
        entityId: file.id,
        projectId: file.projectId,
        details: { filename: file.name },
        ipAddress: ctx.req.ip || null,
        userAgent: ctx.req.headers?.["user-agent"] || null,
      });

      return file;
    }),

  // Download de arquivo (retorna URL pré-assinada)
  download: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const file = await db.getFileById(input.id);

      if (!file) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Arquivo não encontrado",
        });
      }

      // Verificar acesso ao projeto
      await checkProjectAccess(file.projectId, ctx.user.id, ctx.user.role);

      // Log de auditoria
      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "file.download",
        entityType: "file",
        entityId: file.id,
        projectId: file.projectId,
        details: { filename: file.name },
        ipAddress: ctx.req.ip || null,
        userAgent: ctx.req.headers?.["user-agent"] || null,
      });

      // Retornar URL do arquivo (já é pública no S3)
      return {
        url: file.s3Url,
        filename: file.name,
        mimeType: file.mimeType,
      };
    }),

  // Excluir arquivo (soft delete)
  delete: editorProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const file = await db.getFileById(input.id);

      if (!file) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Arquivo não encontrado",
        });
      }

      // Verificar acesso ao projeto
      await checkProjectAccess(file.projectId, ctx.user.id, ctx.user.role);

      // Soft delete
      await db.deleteFile(input.id);

      // Log de auditoria
      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "file.delete",
        entityType: "file",
        entityId: file.id,
        projectId: file.projectId,
        details: { filename: file.name },
        ipAddress: ctx.req.ip || null,
        userAgent: ctx.req.headers?.["user-agent"] || null,
      });

      return { success: true };
    }),

  // Atualizar metadados do arquivo
  update: editorProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, name, description } = input;

      const file = await db.getFileById(id);

      if (!file) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Arquivo não encontrado",
        });
      }

      // Verificar acesso ao projeto
      await checkProjectAccess(file.projectId, ctx.user.id, ctx.user.role);

      // Atualizar
      const updateData: any = {};
      if (name) updateData.name = name;
      if (description) {
        updateData.metadata = { ...file.metadata, description };
      }

      await db.updateFile(id, updateData);

      // Log de auditoria
      await db.createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "file.update",
        entityType: "file",
        entityId: file.id,
        projectId: file.projectId,
        details: updateData,
        ipAddress: ctx.req.ip || null,
        userAgent: ctx.req.headers?.["user-agent"] || null,
      });

      return { success: true };
    }),
});
