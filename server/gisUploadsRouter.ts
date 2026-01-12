import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc.js";
import * as db from "./db.js";
import { storagePut } from "./storage.js";
import { invokeLLM } from "./_core/llm.js";

export const gisUploadsRouter = router({
  // Listar uploads do usuário
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.number().optional(),
        status: z.enum(["pending", "processing", "completed", "failed"]).optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const uploads = await db.listGisUploads(ctx.user.id, input);
      return uploads;
    }),

  // Obter detalhes de um upload
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const upload = await db.getGisUpload(input.id, ctx.user.id);
      if (!upload) {
        throw new Error("Upload not found");
      }
      return upload;
    }),

  // Iniciar upload (retorna informações para upload)
  initiate: protectedProcedure
    .input(
      z.object({
        filename: z.string(),
        fileType: z.enum(["shp", "kml", "kmz", "geojson", "gpx", "gml", "dxf"]),
        fileSize: z.number(),
        mimeType: z.string(),
        projectId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Validar tamanho do arquivo (máximo 100MB)
      if (input.fileSize > 100 * 1024 * 1024) {
        throw new Error("File size exceeds 100MB limit");
      }

      // Gerar nome único para o arquivo
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const filename = `gis-uploads/${ctx.user.id}/${timestamp}-${randomSuffix}-${input.filename}`;

      // Criar registro no banco
      const uploadId = await db.createGisUpload({
        userId: ctx.user.id,
        projectId: input.projectId,
        filename,
        originalName: input.filename,
        fileType: input.fileType,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        s3Key: filename,
        s3Url: "", // Será preenchido após upload
        status: "pending",
      });

      return {
        uploadId,
        s3Key: filename,
      };
    }),

  // Confirmar upload e iniciar processamento
  confirm: protectedProcedure
    .input(
      z.object({
        uploadId: z.number(),
        s3Url: z.string(),
        fileContent: z.string(), // Base64 ou texto do arquivo para validação
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Buscar upload
      const upload = await db.getGisUpload(input.uploadId, ctx.user.id);
      if (!upload) {
        throw new Error("Upload not found");
      }

      // Atualizar URL do S3
      await db.updateGisUploadStatus(input.uploadId, "processing", input.s3Url);

      // Validar arquivo com IA (assíncrono)
      try {
        const validationResult = await validateGisFile(
          upload.fileType,
          input.fileContent
        );

        await db.completeGisUpload(
          input.uploadId,
          validationResult.isValid ? "completed" : "failed",
          validationResult,
          validationResult.errors?.join(", ")
        );

        return {
          success: true,
          validationResult,
        };
      } catch (error: any) {
        await db.updateGisUploadStatus(input.uploadId, "failed", undefined, error.message);
        throw error;
      }
    }),

  // Deletar upload
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const upload = await db.getGisUpload(input.id, ctx.user.id);
      if (!upload) {
        throw new Error("Upload not found");
      }

      await db.deleteGisUpload(input.id);
      return { success: true };
    }),
});

// Função auxiliar para validar arquivo GIS com IA
async function validateGisFile(
  fileType: string,
  fileContent: string
): Promise<{
  isValid: boolean;
  errors?: string[];
  warnings?: string[];
  metadata?: {
    crs?: string;
    bounds?: number[];
    featureCount?: number;
    geometryTypes?: string[];
    attributes?: string[];
  };
}> {
  try {
    // Truncar conteúdo se muito grande (máximo 50KB para análise)
    const maxLength = 50000;
    const truncatedContent =
      fileContent.length > maxLength
        ? fileContent.substring(0, maxLength) + "\n... (truncated)"
        : fileContent;

    const prompt = `Você é um especialista em dados geoespaciais. Analise o seguinte arquivo ${fileType.toUpperCase()} e forneça:

1. Se o arquivo é válido (formato correto, estrutura adequada)
2. Lista de erros encontrados (se houver)
3. Lista de avisos/sugestões (se houver)
4. Metadados extraídos:
   - Sistema de coordenadas (CRS/EPSG)
   - Bounding box (se disponível)
   - Número de features/geometrias
   - Tipos de geometria (Point, LineString, Polygon, etc.)
   - Nomes dos atributos/campos

Conteúdo do arquivo:
\`\`\`
${truncatedContent}
\`\`\`

Responda APENAS com um objeto JSON no seguinte formato:
{
  "isValid": boolean,
  "errors": ["erro1", "erro2"],
  "warnings": ["aviso1", "aviso2"],
  "metadata": {
    "crs": "EPSG:4326",
    "bounds": [minLon, minLat, maxLon, maxLat],
    "featureCount": number,
    "geometryTypes": ["Point", "LineString"],
    "attributes": ["campo1", "campo2"]
  }
}`;

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "Você é um especialista em análise de dados geoespaciais. Responda APENAS com JSON válido, sem texto adicional.",
        },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "gis_validation",
          strict: true,
          schema: {
            type: "object",
            properties: {
              isValid: { type: "boolean" },
              errors: {
                type: "array",
                items: { type: "string" },
              },
              warnings: {
                type: "array",
                items: { type: "string" },
              },
              metadata: {
                type: "object",
                properties: {
                  crs: { type: "string" },
                  bounds: {
                    type: "array",
                    items: { type: "number" },
                  },
                  featureCount: { type: "number" },
                  geometryTypes: {
                    type: "array",
                    items: { type: "string" },
                  },
                  attributes: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
                required: [],
                additionalProperties: false,
              },
            },
            required: ["isValid"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0].message.content;
    const result = JSON.parse(typeof content === "string" ? content : "{}");
    return result;
  } catch (error: any) {
    console.error("Error validating GIS file with AI:", error);
    return {
      isValid: false,
      errors: [`Erro ao validar arquivo: ${error.message}`],
    };
  }
}
