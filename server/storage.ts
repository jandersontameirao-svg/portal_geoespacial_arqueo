/**
 * Storage helper for S3-compatible object storage
 * Uses Manus built-in storage service
 */

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ENV } from "./_core/env";

// Configurar cliente S3
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  } : undefined,
  forcePathStyle: true,
});

const BUCKET_NAME = process.env.S3_BUCKET || "portal-geoespacial";

/**
 * Upload de arquivo para S3
 * @param key - Chave do arquivo no S3 (path completo)
 * @param data - Dados do arquivo (Buffer, Uint8Array ou string)
 * @param contentType - Tipo MIME do arquivo
 * @returns Objeto com key e url do arquivo
 */
export async function storagePut(
  key: string,
  data: Buffer | Uint8Array | string,
  contentType?: string
): Promise<{ key: string; url: string }> {
  try {
    // Converter string para Buffer se necessário
    const body = typeof data === "string" ? Buffer.from(data) : data;

    // Upload para S3
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );

    // Construir URL pública
    const url = process.env.S3_PUBLIC_URL
      ? `${process.env.S3_PUBLIC_URL}/${key}`
      : `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`;

    return { key, url };
  } catch (error) {
    console.error("Erro ao fazer upload para S3:", error);
    throw new Error("Falha ao fazer upload do arquivo");
  }
}

/**
 * Obter URL pré-assinada para download (se necessário)
 * Por enquanto retorna URL pública diretamente
 */
export async function storageGet(
  key: string,
  expiresIn?: number
): Promise<{ key: string; url: string }> {
  const url = process.env.S3_PUBLIC_URL
    ? `${process.env.S3_PUBLIC_URL}/${key}`
    : `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`;

  return { key, url };
}
