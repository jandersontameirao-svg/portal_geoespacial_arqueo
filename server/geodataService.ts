/**
 * SERVIÇO DE DOWNLOAD DE DADOS GEOESPACIAIS
 * 
 * Responsável por baixar e processar dados de fontes oficiais:
 * - FUNAI: Terras Indígenas (WFS)
 * - INCRA: Terras Quilombolas (Shapefile ZIP)
 */

import { storagePut } from "./storage";
import fetch from "node-fetch";
import AdmZip from "adm-zip";
import { randomBytes } from "crypto";

// ============================================================================
// TIPOS
// ============================================================================

export interface DownloadResult {
  success: boolean;
  featureCount?: number;
  bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  s3Key?: string;
  s3Url?: string;
  errorMessage?: string;
}

export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: any;
    properties: Record<string, any>;
  }>;
  crs?: {
    type: string;
    properties: {
      name: string;
    };
  };
  bbox?: [number, number, number, number];
}

// ============================================================================
// FUNAI - TERRAS INDÍGENAS
// ============================================================================

/**
 * Baixa terras indígenas da FUNAI via WFS
 * 
 * @param uf Sigla do estado (opcional) - ex: 'BA', 'MG'. Se não informado, baixa todos.
 * @param maxFeatures Limite de features (opcional)
 * @returns Resultado do download com URL do S3
 */
export async function downloadTerrasIndigenas(
  uf?: string,
  maxFeatures?: number
): Promise<DownloadResult> {
  try {
    const baseUrl = "https://geoserver.funai.gov.br/geoserver/Funai/ows";
    
    const params = new URLSearchParams({
      service: "WFS",
      version: "1.0.0",
      request: "GetFeature",
      typeName: "Funai:tis_poligonais",
      outputFormat: "application/json",
    });

    // Filtro por estado
    if (uf) {
      params.append("CQL_FILTER", `uf_sigla='${uf}'`);
    }

    // Limite de features
    if (maxFeatures) {
      params.append("maxFeatures", maxFeatures.toString());
    }

    const url = `${baseUrl}?${params.toString()}`;
    
    console.log(`[FUNAI] Baixando terras indígenas${uf ? ` do estado ${uf}` : ""}...`);
    
    // Download
    const response = await fetch(url, {
      timeout: 120000, // 2 minutos
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const geojson = (await response.json()) as GeoJSONFeatureCollection;
    
    // Extrair metadados
    const featureCount = geojson.features.length;
    const bounds = geojson.bbox
      ? {
          west: geojson.bbox[0],
          south: geojson.bbox[1],
          east: geojson.bbox[2],
          north: geojson.bbox[3],
        }
      : undefined;

    // Salvar no S3
    const suffix = randomBytes(4).toString("hex");
    const s3Key = `base-layers/funai/terras_indigenas${uf ? `_${uf}` : ""}_${suffix}.geojson`;
    
    const { url: s3Url } = await storagePut(
      s3Key,
      JSON.stringify(geojson),
      "application/json"
    );

    console.log(`[FUNAI] ✓ ${featureCount} terras indígenas baixadas`);

    return {
      success: true,
      featureCount,
      bounds,
      s3Key,
      s3Url,
    };
  } catch (error: any) {
    console.error("[FUNAI] Erro ao baixar terras indígenas:", error);
    return {
      success: false,
      errorMessage: error.message || "Erro desconhecido",
    };
  }
}

// ============================================================================
// INCRA - TERRAS QUILOMBOLAS
// ============================================================================

/**
 * Baixa terras quilombolas do INCRA
 * 
 * @returns Resultado do download com URL do S3
 */
export async function downloadTerrasQuilombolas(): Promise<DownloadResult> {
  try {
    const url = "https://www.gov.br/insa/pt-br/centrais-de-conteudo/mapas/mapas-em-shapefile/quilombos-incra.zip";
    
    console.log("[INCRA] Baixando terras quilombolas...");
    
    // Download
    const response = await fetch(url, {
      timeout: 60000, // 1 minuto
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = await response.buffer();
    
    // Extrair ZIP
    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();
    
    // Procurar arquivo .shp
    const shpEntry = zipEntries.find((entry: any) => entry.entryName.endsWith(".shp"));
    if (!shpEntry) {
      throw new Error("Arquivo .shp não encontrado no ZIP");
    }

    // Procurar arquivo .dbf para contar features
    const dbfEntry = zipEntries.find((entry: any) => entry.entryName.endsWith(".dbf"));
    let featureCount: number | undefined;
    
    if (dbfEntry) {
      const dbfBuffer = dbfEntry.getData();
      // Ler header do DBF para contar registros
      // Bytes 4-7 contêm o número de registros (little-endian)
      if (dbfBuffer.length >= 8) {
        featureCount = dbfBuffer.readUInt32LE(4);
      }
    }

    // Salvar ZIP completo no S3
    const suffix = randomBytes(4).toString("hex");
    const s3Key = `base-layers/incra/quilombos_${suffix}.zip`;
    
    const { url: s3Url } = await storagePut(
      s3Key,
      buffer,
      "application/zip"
    );

    console.log(`[INCRA] ✓ Terras quilombolas baixadas (${featureCount || "?"} features)`);

    return {
      success: true,
      featureCount,
      s3Key,
      s3Url,
      // Bounds conhecidos do shapefile
      bounds: {
        west: -44.018936,
        south: -17.646125,
        east: -35.495522,
        north: -2.817687,
      },
    };
  } catch (error: any) {
    console.error("[INCRA] Erro ao baixar terras quilombolas:", error);
    return {
      success: false,
      errorMessage: error.message || "Erro desconhecido",
    };
  }
}

// ============================================================================
// CACHE E ATUALIZAÇÃO
// ============================================================================

/**
 * Verifica se o cache de uma camada expirou
 */
export function isCacheExpired(cacheExpiresAt: Date | null): boolean {
  if (!cacheExpiresAt) return true;
  return new Date() > cacheExpiresAt;
}

/**
 * Calcula data de expiração do cache
 * 
 * @param source Fonte dos dados
 * @returns Data de expiração
 */
export function calculateCacheExpiration(source: string): Date {
  const now = new Date();
  
  switch (source) {
    case "funai":
      // Cache de 7 dias
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    case "incra":
      // Cache de 30 dias
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    
    default:
      // Cache de 7 dias por padrão
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
}
