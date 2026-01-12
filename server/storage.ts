/**
 * Storage helper using Manus built-in storage service
 * Uses REST API instead of S3-compatible interface
 */

import { ENV } from "./_core/env";
import { randomBytes } from "crypto";

/**
 * Upload de arquivo para Manus Storage
 * @param key - Chave do arquivo no storage (path completo)
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
    const buffer = typeof data === "string" ? Buffer.from(data) : data;

    console.log(`[Storage] Uploading file: ${key}`);
    console.log(`[Storage] Size: ${buffer.length} bytes`);
    console.log(`[Storage] Content-Type: ${contentType || "application/octet-stream"}`);

    // Usar o utilitário manus-upload-file para fazer upload
    // Este é um helper interno do Manus que já tem as credenciais configuradas
    const { execSync } = await import("child_process");
    const fs = await import("fs");
    const path = await import("path");
    const os = await import("os");

    // Criar arquivo temporário
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `upload-${randomBytes(8).toString("hex")}`);
    
    fs.writeFileSync(tmpFile, buffer);

    try {
      // Usar o comando manus-upload-file
      const result = execSync(`manus-upload-file "${tmpFile}"`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      // O comando retorna a URL do arquivo
      const url = result.trim();
      
      console.log(`[Storage] ✓ Upload successful: ${url}`);

      // Limpar arquivo temporário
      fs.unlinkSync(tmpFile);

      return { key, url };
    } catch (uploadError: any) {
      // Limpar arquivo temporário em caso de erro
      try {
        fs.unlinkSync(tmpFile);
      } catch {}
      
      throw uploadError;
    }
  } catch (error: any) {
    console.error("[Storage] Erro ao fazer upload:", error);
    console.error("[Storage] Detalhes do erro:", {
      message: error.message,
      stderr: error.stderr?.toString(),
      stdout: error.stdout?.toString(),
    });
    throw new Error(`Falha ao fazer upload do arquivo: ${error.message}`);
  }
}

/**
 * Obter URL pública para download
 * Nota: Como usamos manus-upload-file, a URL já é retornada no upload
 */
export async function storageGet(
  key: string,
  expiresIn?: number
): Promise<{ key: string; url: string }> {
  // Como não temos um mapeamento direto de key para URL,
  // esta função assume que a URL já foi armazenada no banco de dados
  // quando o arquivo foi feito upload
  throw new Error("storageGet não é suportado com manus-upload-file. Use a URL retornada por storagePut.");
}
