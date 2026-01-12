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
// OSM - RODOVIAS (via Overpass API)
// ============================================================================

/**
 * Baixa rodovias federais do OpenStreetMap via Overpass API
 * 
 * @param state Sigla do estado (opcional) - ex: 'BA', 'MG'. Se não informado, baixa do Brasil inteiro.
 * @returns Resultado do download com URL do S3
 */
export async function downloadRodovias(
  state?: string
): Promise<DownloadResult> {
  try {
    // Bounding box do Brasil ou estado específico
    const bbox = state ? getStateBBox(state) : "(-34,-74,6,-34)";
    
    // Query Overpass para rodovias federais
    const query = `
      [out:json][timeout:60];
      (
        way["highway"~"^(motorway|trunk|primary)$"]["ref"~"^BR-"]${bbox};
      );
      out geom;
    `;

    console.log(`[OSM] Baixando rodovias${state ? ` do estado ${state}` : " do Brasil"}...`);

    const response = await fetch(
      "https://overpass-api.de/api/interpreter",
      {
        method: "POST",
        body: query,
        headers: { "Content-Type": "text/plain" },
        timeout: 65000,
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const osmData = await response.json() as any;

    // Converter OSM para GeoJSON
    const features = osmData.elements.map((element: any) => {
      const coordinates = element.geometry.map((point: any) => [
        point.lon,
        point.lat,
      ]);

      return {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates,
        },
        properties: {
          nome: element.tags.name || element.tags.ref || "Rodovia",
          ref: element.tags.ref,
          tipo: element.tags.highway,
          superficie: element.tags.surface,
          faixas: element.tags.lanes,
          velocidade_max: element.tags.maxspeed,
          osm_id: element.id,
        },
      };
    });

    const geojson: GeoJSONFeatureCollection = {
      type: "FeatureCollection",
      features,
    };

    const featureCount = features.length;

    // Calcular bounds
    let bounds: DownloadResult["bounds"];
    if (features.length > 0) {
      let minLon = Infinity, minLat = Infinity;
      let maxLon = -Infinity, maxLat = -Infinity;
      
      for (const feature of features) {
        for (const [lon, lat] of feature.geometry.coordinates) {
          minLon = Math.min(minLon, lon);
          minLat = Math.min(minLat, lat);
          maxLon = Math.max(maxLon, lon);
          maxLat = Math.max(maxLat, lat);
        }
      }
      
      bounds = {
        west: minLon,
        south: minLat,
        east: maxLon,
        north: maxLat,
      };
    }

    // Salvar no S3
    const suffix = randomBytes(4).toString("hex");
    const s3Key = `base-layers/osm/rodovias${state ? `_${state}` : ""}_${suffix}.geojson`;
    
    const { url: s3Url } = await storagePut(
      s3Key,
      JSON.stringify(geojson),
      "application/json"
    );

    console.log(`[OSM] ✓ ${featureCount} rodovias baixadas`);

    return {
      success: true,
      featureCount,
      bounds,
      s3Key,
      s3Url,
    };
  } catch (error: any) {
    console.error("[OSM] Erro ao baixar rodovias:", error);
    return {
      success: false,
      errorMessage: error.message || "Erro desconhecido",
    };
  }
}

// Helper para bbox de estados
function getStateBBox(state: string): string {
  const bboxes: Record<string, string> = {
    AC: "(-11,-74,-7,-66)",
    AL: "(-10.5,-38,-8.8,-35)",
    AM: "(-10,-74,2,-56)",
    AP: "(2,-55,5,-49)",
    BA: "(-18.5,-47,-8.5,-37)",
    CE: "(-8,-41.5,-2.5,-37)",
    DF: "(-16.1,-48.3,-15.5,-47.3)",
    ES: "(-21.5,-41.5,-17.5,-39.5)",
    GO: "(-19.5,-53.5,-12,-45.5)",
    MA: "(-10.5,-48,-1.5,-41.5)",
    MG: "(-23,-51,-14,-39)",
    MS: "(-24.5,-58.5,-17,-50.5)",
    MT: "(-18.5,-61.5,-7,-50.5)",
    PA: "(-10,-59,3,-46)",
    PB: "(-8.5,-39,-6,-34.5)",
    PE: "(-9.5,-41.5,-7,-34.5)",
    PI: "(-11,-46,-2.5,-40)",
    PR: "(-26.5,-55,-22.5,-48)",
    RJ: "(-23.5,-45,-20.5,-40.5)",
    RN: "(-7,-38.5,-4.5,-34.5)",
    RO: "(-14,-66.5,-7.5,-59.5)",
    RR: "(-1,-65,6,-58)",
    RS: "(-34,-58,-27,-49)",
    SC: "(-29.5,-54,-25.5,-48)",
    SE: "(-11.5,-38.5,-10,-36.5)",
    SP: "(-25.5,-53.5,-19.5,-44)",
    TO: "(-13.5,-51.5,-5,-45.5)",
  };
  return bboxes[state] || "(-34,-74,6,-34)";
}

// ============================================================================
// IPHAN - SÍTIOS ARQUEOLÓGICOS
// ============================================================================

/**
 * Baixa sítios arqueológicos do IPHAN via WFS
 * 
 * @param maxFeatures Limite de features (opcional, padrão: todos)
 * @returns Resultado do download com URL do S3
 */
export async function downloadSitiosArqueologicos(
  maxFeatures?: number
): Promise<DownloadResult> {
  try {
    const baseUrl = "http://portal.iphan.gov.br/geoserver/SICG/ows";
    
    const params = new URLSearchParams({
      service: "WFS",
      version: "1.0.0",
      request: "GetFeature",
      typeName: "SICG:sitios",
      outputFormat: "application/json",
    });

    // Limite de features (se não especificado, baixa todos)
    if (maxFeatures) {
      params.append("maxFeatures", maxFeatures.toString());
    }

    const url = `${baseUrl}?${params.toString()}`;
    
    console.log(`[IPHAN] Baixando sítios arqueológicos${maxFeatures ? ` (limite: ${maxFeatures})` : " (todos)"}...`);
    
    // Download
    const response = await fetch(url, {
      timeout: 300000, // 5 minutos (pode ser grande)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const geojson = (await response.json()) as GeoJSONFeatureCollection;
    
    // Extrair metadados
    const featureCount = geojson.features.length;
    const totalFeatures = (geojson as any).totalFeatures || featureCount;
    
    // Calcular bounds manualmente
    let bounds: DownloadResult["bounds"];
    if (geojson.features.length > 0) {
      let minLon = Infinity, minLat = Infinity;
      let maxLon = -Infinity, maxLat = -Infinity;
      
      for (const feature of geojson.features) {
        if (feature.geometry.type === "Point") {
          const [lon, lat] = feature.geometry.coordinates as [number, number];
          minLon = Math.min(minLon, lon);
          minLat = Math.min(minLat, lat);
          maxLon = Math.max(maxLon, lon);
          maxLat = Math.max(maxLat, lat);
        }
      }
      
      bounds = {
        west: minLon,
        south: minLat,
        east: maxLon,
        north: maxLat,
      };
    }

    // Salvar no S3
    const suffix = randomBytes(4).toString("hex");
    const s3Key = `base-layers/iphan/sitios_arqueologicos_${suffix}.geojson`;
    
    const { url: s3Url } = await storagePut(
      s3Key,
      JSON.stringify(geojson),
      "application/json"
    );

    console.log(`[IPHAN] ✓ ${featureCount} sítios arqueológicos baixados (total no servidor: ${totalFeatures})`);

    return {
      success: true,
      featureCount: totalFeatures, // Usar total do servidor
      bounds,
      s3Key,
      s3Url,
    };
  } catch (error: any) {
    console.error("[IPHAN] Erro ao baixar sítios arqueológicos:", error);
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
    
    case "iphan":
      // Cache de 14 dias (dados atualizados com frequência média)
      return new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    
    case "osm":
    case "osm_rodovias":
      // Cache de 30 dias (dados de rodovias mudam com menos frequência)
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    
    default:
      // Cache de 7 dias por padrão
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
}
