import { createHash } from "node:crypto";
import { z } from "zod";

/** O contrato histórico da API aceita URLs OGC de até 1.000 caracteres. */
export const MAX_OGC_ENDPOINT_LENGTH = 1000;

/**
 * Validação de entrada antes da normalização do endpoint.
 * O limite protege o armazenamento, mas não trunca nem transforma a URL.
 */
export const ogcEndpointInputSchema = z
  .string()
  .trim()
  .url()
  .max(MAX_OGC_ENDPOINT_LENGTH, `Endpoint OGC deve ter no máximo ${MAX_OGC_ENDPOINT_LENGTH} caracteres`);

/**
 * Identidade indexável do endpoint normalizado. A URL integral continua sendo
 * preservada na coluna endpoint; o hash permite unicidade em utf8mb4 sem
 * indexar diretamente até 4.000 bytes de texto.
 */
export function fingerprintOgcEndpoint(normalizedEndpoint: string): string {
  return createHash("sha256").update(normalizedEndpoint, "utf8").digest("hex");
}

/**
 * Uma colisão criptográfica não pode ser tratada como URL duplicada. O
 * chamador deve bloquear a operação e registrar o diagnóstico, sem sobrescrever
 * o serviço já existente.
 */
export function classifyEndpointFingerprintMatch(existingEndpoint: string, requestedEndpoint: string): "duplicate" | "collision" {
  return existingEndpoint === requestedEndpoint ? "duplicate" : "collision";
}
