/**
 * Enriquecimento geográfico server-side (evita CORS, fixa User-Agent).
 * `municipiosCruzados`: dado o conjunto de pontos de uma geometria, retorna os
 * municípios/UF que ela cruza, por point-in-polygon sobre as malhas oficiais do
 * IBGE (sem geocoder, sem rate limit, sem chave). Malhas são cacheadas em
 * memória sem expiração (dados estáticos).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "./_core/trpc";

type LngLat = [number, number];

const IBGE = "https://servicodados.ibge.gov.br";
const UA = "GeoportalArqueo/1.0 (+https://geoportal.sigpa.com.br)";

// Cache simples por URL. TTL longo; malhas são estáticas.
const cache = new Map<string, { exp: number; data: unknown }>();
const DAY = 24 * 60 * 60 * 1000;

async function fetchJson<T>(url: string, ttlMs = DAY): Promise<T> {
  const hit = cache.get(url);
  if (hit && hit.exp > Date.now()) return hit.data as T;
  if (cache.size > 500) cache.clear();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: controller.signal,
    });
  } catch {
    throw new TRPCError({ code: "BAD_GATEWAY", message: "Falha ao consultar o IBGE." });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: `IBGE respondeu ${res.status}.` });
  const data = (await res.json()) as T;
  cache.set(url, { exp: Date.now() + ttlMs, data });
  return data;
}

// Point-in-polygon even-odd sobre um anel.
function pointInRing(pt: LngLat, ring: number[][]): boolean {
  let inside = false;
  const [x, y] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Polígono = [anelExterno, buraco1, ...]; dentro do externo e fora dos buracos.
function pointInPolygon(pt: LngLat, polygon: number[][][]): boolean {
  if (polygon.length === 0 || !pointInRing(pt, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(pt, polygon[i])) return false;
  }
  return true;
}

function pointInFeature(pt: LngLat, geometry: any): boolean {
  if (!geometry) return false;
  if (geometry.type === "Polygon") return pointInPolygon(pt, geometry.coordinates);
  if (geometry.type === "MultiPolygon") return geometry.coordinates.some((poly: number[][][]) => pointInPolygon(pt, poly));
  return false;
}

type FeatureCollection = { features: Array<{ properties?: Record<string, any>; geometry: any }> };

async function ufFeatures(): Promise<FeatureCollection> {
  return fetchJson<FeatureCollection>(
    `${IBGE}/api/v3/malhas/paises/BR?formato=application/vnd.geo+json&intrarregiao=UF&qualidade=minima`,
    30 * DAY,
  );
}

async function ufNames(): Promise<Map<string, { sigla: string; nome: string }>> {
  const list = await fetchJson<Array<{ id: number; sigla: string; nome: string }>>(
    `${IBGE}/api/v1/localidades/estados?orderBy=nome`,
    30 * DAY,
  );
  return new Map(list.map((e) => [String(e.id), { sigla: e.sigla, nome: e.nome }]));
}

async function municipioFeatures(ufCode: string): Promise<FeatureCollection> {
  return fetchJson<FeatureCollection>(
    `${IBGE}/api/v3/malhas/estados/${ufCode}?formato=application/vnd.geo+json&intrarregiao=municipio&qualidade=minima`,
    30 * DAY,
  );
}

async function municipioNames(ufCode: string): Promise<Map<string, string>> {
  const list = await fetchJson<Array<{ id: number; nome: string }>>(
    `${IBGE}/api/v1/localidades/estados/${ufCode}/municipios`,
    30 * DAY,
  );
  return new Map(list.map((m) => [String(m.id), m.nome]));
}

export const geoRouter = router({
  municipiosCruzados: protectedProcedure
    .input(
      z.object({
        // pontos no padrão GeoJSON [lng, lat]
        pontos: z.array(z.tuple([z.number(), z.number()])).min(1).max(20000),
      }),
    )
    .query(async ({ input }) => {
      // Dedup por célula ~150 m (0.0014°) e limite defensivo de processamento.
      const seen = new Set<string>();
      const pontos: LngLat[] = [];
      for (const [lng, lat] of input.pontos) {
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        const key = `${Math.round(lat / 0.0014)}:${Math.round(lng / 0.0014)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pontos.push([lng, lat]);
        if (pontos.length >= 3000) break;
      }
      if (pontos.length === 0) return { municipios: [], ufs: [] };

      // 1) UF de cada ponto.
      const [ufFc, ufMap] = await Promise.all([ufFeatures(), ufNames()]);
      const ufPorPonto = new Map<number, string>(); // idx -> ufCode
      const ufsEnvolvidas = new Set<string>();
      pontos.forEach((pt, idx) => {
        const feat = ufFc.features.find((f) => pointInFeature(pt, f.geometry));
        const code = feat?.properties?.codarea != null ? String(feat.properties.codarea) : undefined;
        if (code) {
          ufPorPonto.set(idx, code);
          ufsEnvolvidas.add(code);
        }
      });

      // 2) Municípios só das UFs envolvidas.
      const municipiosSet = new Set<string>(); // "Município/UF"
      const ufsSet = new Set<string>();
      for (const ufCode of Array.from(ufsEnvolvidas)) {
        const [munFc, munNames] = await Promise.all([municipioFeatures(ufCode), municipioNames(ufCode)]);
        const sigla = ufMap.get(ufCode)?.sigla || ufCode;
        ufsSet.add(sigla);
        pontos.forEach((pt, idx) => {
          if (ufPorPonto.get(idx) !== ufCode) return;
          const feat = munFc.features.find((f) => pointInFeature(pt, f.geometry));
          const munCode = feat?.properties?.codarea != null ? String(feat.properties.codarea) : undefined;
          if (munCode) {
            const nome = munNames.get(munCode) || `Município ${munCode}`;
            municipiosSet.add(`${nome}/${sigla}`);
          }
        });
      }

      return {
        municipios: Array.from(municipiosSet).sort(),
        ufs: Array.from(ufsSet).sort(),
      };
    }),
});
