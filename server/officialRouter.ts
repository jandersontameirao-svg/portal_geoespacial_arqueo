import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { requireProjectAccess } from "./projectAccess";
import { queryRemoteSource } from "./official/remote-client";
import { analyzeRemoteAda } from "./official/remote-analysis";
import { validateStoredGeometryCoordinates } from "../shared/geometry-coordinates";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import {
  getOfficialRecord,
  getPublicOfficialCatalog,
  OFFICIAL_LIMITS,
  OFFICIAL_RECORDS,
  type OfficialRecord,
} from "./official/records";

type Bbox = { west: number; south: number; east: number; north: number };
type GeoJsonFeature = {
  type: "Feature";
  id?: string | number;
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, string | number | boolean | null>;
};
type FeatureCollection = { type: "FeatureCollection"; features: GeoJsonFeature[] };

const bboxSchema = z.object({
  west: z.number().finite(),
  south: z.number().finite(),
  east: z.number().finite(),
  north: z.number().finite(),
}).superRefine((value, ctx) => {
  if (value.west >= value.east) ctx.addIssue({ code: "custom", message: "west deve ser menor que east", path: ["west"] });
  if (value.south >= value.north) ctx.addIssue({ code: "custom", message: "south deve ser menor que north", path: ["south"] });
  if (value.west < -180 || value.east > 180 || value.south < -90 || value.north > 90) {
    ctx.addIssue({ code: "custom", message: "bbox fora dos limites WGS84" });
  }
  if (value.east - value.west > OFFICIAL_LIMITS.maxBboxSpanDegrees || value.north - value.south > OFFICIAL_LIMITS.maxBboxSpanDegrees) {
    ctx.addIssue({ code: "custom", message: "bbox excede o limite de consulta" });
  }
});

const officialQueryInput = z.object({
  institutionId: z.string().trim().min(1).max(100),
  bbox: bboxSchema,
  query: z.string().trim().max(120).optional(),
  limit: z.number().int().min(1).max(OFFICIAL_LIMITS.maxFeatures).default(100),
  projectId: z.number().int().positive().optional(),
});

const cache = new Map<string, { expiresAt: number; value: FeatureCollection }>();

function boundedCacheSet(key: string, value: FeatureCollection) {
  if (cache.size >= OFFICIAL_LIMITS.maxCacheEntries && !cache.has(key)) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { expiresAt: Date.now() + OFFICIAL_LIMITS.cacheTtlMs, value });
}

export function sanitizeText(value: unknown, max = 512): string {
  const raw = typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value);
  return (raw ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, max).trim();
}

function sanitizeProperties(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    const safeKey = sanitizeText(key, 64);
    if (!safeKey) continue;
    if (item === null || typeof item === "number" || typeof item === "boolean") result[safeKey] = item;
    else result[safeKey] = sanitizeText(item);
  }
  return result;
}

function collectCoordinateBounds(value: unknown, result: [number, number, number, number]) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number" && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
    result[0] = Math.min(result[0], value[0]);
    result[1] = Math.min(result[1], value[1]);
    result[2] = Math.max(result[2], value[0]);
    result[3] = Math.max(result[3], value[1]);
    return;
  }
  for (const child of value) collectCoordinateBounds(child, result);
}

export function featureBounds(feature: GeoJsonFeature): Bbox | null {
  if (!feature.geometry) return null;
  const values: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  collectCoordinateBounds(feature.geometry.coordinates, values);
  if (!Number.isFinite(values[0]) || !Number.isFinite(values[1]) || !Number.isFinite(values[2]) || !Number.isFinite(values[3])) return null;
  return { west: values[0], south: values[1], east: values[2], north: values[3] };
}

export function bboxIntersects(a: Bbox, b: Bbox): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

function normaliseFeature(value: unknown): GeoJsonFeature | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== "Feature" || !candidate.geometry || typeof candidate.geometry !== "object") return null;
  const geometry = candidate.geometry as Record<string, unknown>;
  if (typeof geometry.type !== "string" || !("coordinates" in geometry)) return null;
  return {
    type: "Feature",
    id: typeof candidate.id === "string" || typeof candidate.id === "number" ? candidate.id : undefined,
    geometry: { type: geometry.type, coordinates: geometry.coordinates },
    properties: sanitizeProperties(candidate.properties),
  };
}

function normaliseCollection(value: unknown): FeatureCollection {
  if (!value || typeof value !== "object") return { type: "FeatureCollection", features: [] };
  const raw = (value as Record<string, unknown>).features;
  const features = Array.isArray(raw) ? raw.map(normaliseFeature).filter((item): item is GeoJsonFeature => item !== null).slice(0, OFFICIAL_LIMITS.maxFeatures) : [];
  return { type: "FeatureCollection", features };
}

async function readBoundedFile(path: string): Promise<string> {
  const file = await stat(path);
  if (file.size > OFFICIAL_LIMITS.maxResponseBytes) throw new Error("cache local excede o limite de bytes");
  return readFile(path, "utf8");
}

async function resolveLocalPath(record: OfficialRecord): Promise<string> {
  if (!record.localGeoJsonPath) throw new Error("fonte sem cache GeoJSON permitido");
  const modulePath = join(dirname(fileURLToPath(import.meta.url)), "official", record.localGeoJsonPath);
  try {
    await stat(modulePath);
    return modulePath;
  } catch {
    const sourcePath = join(process.cwd(), "server", "official", record.localGeoJsonPath);
    await stat(sourcePath);
    return sourcePath;
  }
}

function queryTextMatches(feature: GeoJsonFeature, query?: string): boolean {
  const needle = query?.trim().toLocaleLowerCase("pt-BR");
  if (!needle) return true;
  const haystack = [String(feature.id ?? ""), ...Object.values(feature.properties).map(value => String(value))].join(" ").toLocaleLowerCase("pt-BR");
  return haystack.includes(needle);
}

export async function queryLocalOfficialGeoJson(record: OfficialRecord, bbox: Bbox, query: string | undefined, limit: number): Promise<FeatureCollection> {
  const key = `${record.id}|${bbox.west},${bbox.south},${bbox.east},${bbox.north}|${query ?? ""}|${limit}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) cache.delete(key);

  const source = await resolveLocalPath(record);
  const parsed = JSON.parse(await readBoundedFile(source)) as unknown;
  const collection = normaliseCollection(parsed);
  const filtered = collection.features.filter(feature => {
    const bounds = featureBounds(feature);
    return bounds ? bboxIntersects(bounds, bbox) && queryTextMatches(feature, query) : false;
  }).slice(0, limit);
  const value = { type: "FeatureCollection" as const, features: filtered };
  boundedCacheSet(key, value);
  return value;
}

/** Rejects arbitrary URLs; useful for future validated sources and unit checks. */
export function assertAllowlistedEndpoint(institutionId: string, candidateUrl: string): URL {
  const record = getOfficialRecord(institutionId);
  if (!record?.serviceUrl) throw new Error("instituição sem endpoint confirmado");
  const candidate = new URL(candidateUrl);
  const fixed = new URL(record.serviceUrl.replace("{left},{bottom},{right},{top}", "0,0,0.0001,0.0001"));
  if (candidate.protocol !== "https:" || candidate.origin !== fixed.origin || candidate.username || candidate.password || candidate.hash || candidate.pathname !== fixed.pathname) {
    throw new Error("endpoint fora da allowlist oficial");
  }
  return candidate;
}

export async function fetchAllowlistedJson(institutionId: string, candidateUrl: string): Promise<unknown> {
  assertAllowlistedEndpoint(institutionId, candidateUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OFFICIAL_LIMITS.requestTimeoutMs);
  try {
    const response = await fetch(candidateUrl, { signal: controller.signal, redirect: "manual", headers: { Accept: "application/geo+json, application/json" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("redirect sem destino");
      assertAllowlistedEndpoint(institutionId, new URL(location, candidateUrl).toString());
      throw new Error("redirect requer nova requisição validada");
    }
    if (!response.ok) throw new Error(`fonte retornou HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > OFFICIAL_LIMITS.maxResponseBytes) throw new Error("resposta excede o limite de bytes");
    if (!response.body) return response.json();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > OFFICIAL_LIMITS.maxResponseBytes) {
        await reader.cancel();
        throw new Error("resposta excede o limite de bytes");
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

export const officialRouter = router({
  catalog: publicProcedure.query(() => getPublicOfficialCatalog()),
  analyze: protectedProcedure.input(z.object({
    projectId: z.number().int().positive(), institutionId: z.string().trim().min(1).max(100),
    ada: z.object({type:z.literal("Feature"),properties:z.record(z.string(),z.unknown()).nullable(),geometry:z.object({type:z.enum(["Polygon","MultiPolygon"]),coordinates:z.unknown()})}),
  })).mutation(async ({ctx,input}) => {
    await requireProjectAccess(input.projectId, ctx.user);
    const swap=(value:unknown,depth=0):unknown=>{
      if(depth>5)throw new TRPCError({code:"BAD_REQUEST",message:"Estrutura ADA inválida"});
      if(!Array.isArray(value))return value;
      if(typeof value[0]==="number")return [value[1],value[0],...value.slice(2)];
      return value.map(child=>swap(child,depth+1));
    };
    try { validateStoredGeometryCoordinates("polygon",swap(input.ada.geometry.coordinates)); }
    catch(error){throw new TRPCError({code:"BAD_REQUEST",message:error instanceof Error?error.message:"ADA inválida"});}
    return analyzeRemoteAda(input.institutionId,input.ada as Feature<Polygon|MultiPolygon>,{userId:ctx.user.id,projectId:input.projectId});
  }),
  query: protectedProcedure.input(officialQueryInput).query(async ({ ctx, input }) => {
    if (input.projectId !== undefined) {
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Projeto exige autenticação" });
      await requireProjectAccess(input.projectId, ctx.user);
    }
    const record = getOfficialRecord(input.institutionId);
    if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Base oficial não encontrada no catálogo" });
    if (!record.queryable) {
      return { status: "not_queryable" as const, institution: getPublicOfficialCatalog().find(item => item.id === record.id), geojson: null, error: record.restriction };
    }
    try {
      const result = await queryRemoteSource(record.id, input, { userId: ctx.user.id, projectId: input.projectId });
      return {
        status: "ok" as const,
        institution: getPublicOfficialCatalog().find(item => item.id === record.id),
        ...result,
        rows: result.rows ?? [],
        truncated: !result.complete,
        limits: OFFICIAL_LIMITS,
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "falha ao consultar fonte oficial remota; sem fallback local";
      return { status: "error" as const, institution: getPublicOfficialCatalog().find(item => item.id === record.id), geojson: null, error: message };
    }
  }),
});

export type OfficialRouter = typeof officialRouter;
export { OFFICIAL_RECORDS };
