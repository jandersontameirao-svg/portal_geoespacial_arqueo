import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import * as https from "node:https";
import { TRPCError } from "@trpc/server";
import {
  ANEEL_SIGA_ENDPOINT, ANEEL_SIGA_RESOURCE_ID, ANEEL_SIGA_SOURCE_URL,
  ANEEL_SIGA_ATTRIBUTION, ANEEL_SIGA_GEO_NOTICE, ANEEL_SIGA_UFS,
  type AneelSigaInput, type AneelSigaPage, type AneelSigaRecord,
} from "../shared/aneelSiga";
import { canonicalEndpoint, pinnedLookup } from "./indeCatalogService";

const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 10000;
const MAX_CONCURRENT = 4;
export interface SigaHttpResponse { status: number; contentType: string; body: Buffer }
export type SigaTransport = (url: URL) => Promise<SigaHttpResponse>;
const unavailable = (message = "Não foi possível consultar os dados oficiais ANEEL/SIGA.") =>
  new TRPCError({ code: "BAD_GATEWAY", message });

/** A origem literal é fixada pelo servidor; não aceita URL, SQL ou resource_id do cliente. */
export function buildAneelSigaUrl(input: AneelSigaInput): URL {
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 20;
  if (!Number.isInteger(offset) || offset < 0 || offset > 1000000 ||
      !Number.isInteger(limit) || limit < 1 || limit > 50 ||
      (input.uf !== undefined && !ANEEL_SIGA_UFS.includes(input.uf as typeof ANEEL_SIGA_UFS[number]))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Paginação ou UF ANEEL inválida." });
  }
  const url = canonicalEndpoint(ANEEL_SIGA_ENDPOINT);
  url.searchParams.set("resource_id", ANEEL_SIGA_RESOURCE_ID);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort", "_id asc");
  if (input.uf) url.searchParams.set("filters", JSON.stringify({ SigUFPrincipal: input.uf }));
  return url;
}

let socketRequests = 0;
export const requestAneelSiga: SigaTransport = async url => {
  if (url.origin + url.pathname !== ANEEL_SIGA_ENDPOINT ||
      url.searchParams.get("resource_id") !== ANEEL_SIGA_RESOURCE_ID || url.username || url.password || url.hash) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Origem ANEEL não permitida." });
  }
  if (socketRequests >= MAX_CONCURRENT) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Limite de consultas ANEEL atingido." });
  socketRequests++;
  const start = Date.now();
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      lookup(url.hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => { dnsTimer = setTimeout(() => reject(unavailable("Tempo limite na consulta ANEEL.")), TIMEOUT_MS); }),
    ]).finally(() => { if (dnsTimer) clearTimeout(dnsTimer); });
    const pin = pinnedLookup(addresses);
    const remaining = TIMEOUT_MS - (Date.now() - start);
    if (remaining <= 0) throw unavailable("Tempo limite na consulta ANEEL.");
    return await new Promise<SigaHttpResponse>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (error?: Error, response?: SigaHttpResponse) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(response!);
      };
      const request = https.request(url, {
        method: "GET", lookup: pin, agent: false, rejectUnauthorized: true, servername: url.hostname,
        headers: { Accept: "application/json", "Accept-Encoding": "identity" },
      }, response => {
        const status = response.statusCode ?? 0;
        const contentType = String(response.headers["content-type"] ?? "");
        const encoding = response.headers["content-encoding"];
        const length = response.headers["content-length"];
        if (status !== 200 || !/^application\/(?:json|[\w.-]+\+json)(?:;|$)/i.test(contentType) ||
            (encoding && encoding !== "identity") ||
            (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))) {
          finish(unavailable(status !== 200 ? `ANEEL retornou HTTP ${status}; redirecionamentos não são seguidos.` : "Resposta ANEEL fora do formato ou limite permitido."));
          response.destroy(); request.destroy(); return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_BYTES) { finish(unavailable("Resposta ANEEL excedeu 1 MiB.")); response.destroy(); request.destroy(); }
          else chunks.push(Buffer.from(chunk));
        });
        response.on("end", () => finish(undefined, { status, contentType, body: Buffer.concat(chunks, bytes) }));
        response.on("error", () => finish(unavailable()));
        response.on("aborted", () => finish(unavailable()));
      });
      timer = setTimeout(() => { finish(unavailable("Tempo limite na consulta ANEEL.")); request.destroy(); }, remaining);
      request.on("error", () => finish(unavailable("Falha HTTPS/TLS na ANEEL; certificado estrito obrigatório.")));
      request.end();
    });
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw unavailable();
  } finally { socketRequests--; }
};

/** Mantém vírgula decimal; rejeita expressão parcial, separador ambíguo e infinito. */
export function parseSigaDecimal(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^[+-]?\d+(?:[.,]\d+)?$/.test(text)) return null;
  const number = Number(text.replace(",", "."));
  return Number.isFinite(number) ? number : null;
}
function text(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 1024) throw unavailable("Campo ANEEL inválido ou excessivo.");
  return value.trim() || null;
}
const REQUIRED_FIELDS = ["_id", "NomEmpreendimento", "CodCEG", "SigUFPrincipal", "DscFaseUsina", "DatGeracaoConjuntoDados", "NumCoordNEmpreendimento", "NumCoordEEmpreendimento"];
export function parseSigaResponse(body: Buffer, input: AneelSigaInput, now = new Date()): AneelSigaPage {
  if (body.length > MAX_BYTES) throw unavailable("Resposta ANEEL excedeu 1 MiB.");
  let data: any;
  try { data = JSON.parse(body.toString("utf8")); } catch { throw unavailable("ANEEL não retornou JSON válido."); }
  const result = data?.result;
  if (data?.success !== true || !result || result.resource_id !== ANEEL_SIGA_RESOURCE_ID ||
      !Number.isSafeInteger(result.total) || result.total < 0 ||
      !Array.isArray(result.fields) || !Array.isArray(result.records) ||
      result.records.length > (input.limit ?? 20) || result.total < result.records.length) throw unavailable("Contrato JSON ANEEL inválido.");
  const ids = new Set(result.fields.map((field: any) => field?.id));
  if (!REQUIRED_FIELDS.every(field => ids.has(field))) throw unavailable("Esquema ANEEL incompatível com a consulta validada.");
  const seen = new Set<number>();
  const rows: AneelSigaRecord[] = result.records.map((record: unknown) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) throw unavailable("Registro ANEEL inválido.");
    const r = record as Record<string, unknown>;
    const recordId = r._id;
    if (!Number.isSafeInteger(recordId) || Number(recordId) < 1 || seen.has(Number(recordId))) throw unavailable("Identificador ANEEL inválido ou repetido.");
    seen.add(Number(recordId));
    const latitude = parseSigaDecimal(r.NumCoordNEmpreendimento);
    const longitude = parseSigaDecimal(r.NumCoordEEmpreendimento);
    const validPair = latitude !== null && longitude !== null && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 && !(latitude === 0 && longitude === 0);
    const generated = text(r, "DatGeracaoConjuntoDados");
    const authorized = parseSigaDecimal(r.MdaPotenciaOutorgadaKw);
    const monitored = parseSigaDecimal(r.MdaPotenciaFiscalizadaKw);
    return {
      recordId: Number(recordId), name: text(r, "NomEmpreendimento") ?? "Nome não informado", ceg: text(r, "CodCEG"),
      uf: text(r, "SigUFPrincipal"), generationType: text(r, "SigTipoGeracao"), phase: text(r, "DscFaseUsina"),
      awardType: text(r, "DscTipoOutorga"), generatedAt: generated && /^\d{4}-\d{2}-\d{2}$/.test(generated) ? generated : null,
      authorizedPowerKw: authorized !== null && authorized >= 0 ? authorized : null,
      monitoredPowerKw: monitored !== null && monitored >= 0 ? monitored : null,
      centroid: { latitude: validPair ? latitude : null, longitude: validPair ? longitude : null, crs: null, approximate: true },
    };
  });
  const offset = input.offset ?? 0, limit = input.limit ?? 20;
  return {
    source: "ANEEL", dataset: "SIGA diário", attribution: ANEEL_SIGA_ATTRIBUTION, license: "ODbL",
    sourceUrl: ANEEL_SIGA_SOURCE_URL, resourceId: ANEEL_SIGA_RESOURCE_ID, queriedAt: now.toISOString(),
    totalRecords: result.total, offset, limit, hasNext: offset + rows.length < result.total && rows.length > 0,
    rows, geoNotice: ANEEL_SIGA_GEO_NOTICE, preciseMapAvailable: false,
  };
}
export function createAneelSigaService(transport: SigaTransport = requestAneelSiga, now: () => Date = () => new Date()) {
  let inFlight = 0;
  return { async query(input: AneelSigaInput = {}): Promise<AneelSigaPage> {
    const url = buildAneelSigaUrl(input);
    if (inFlight >= MAX_CONCURRENT) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Limite de consultas ANEEL atingido." });
    inFlight++;
    try {
      const response = await transport(url);
      if (response.status !== 200 || !/^application\/(?:json|[\w.-]+\+json)(?:;|$)/i.test(response.contentType)) throw unavailable("Resposta ANEEL não é JSON HTTP 200.");
      return parseSigaResponse(response.body, input, now());
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      // Nunca expõe corpo externo, URLs derivadas ou detalhes internos.
      throw unavailable();
    } finally { inFlight--; }
  } };
}
export const aneelSigaService = createAneelSigaService();
export const aneelSigaResponseHash = (body: Buffer) => createHash("sha256").update(body).digest("hex");
