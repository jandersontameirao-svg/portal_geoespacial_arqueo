import shapefile from "shapefile";
import { fileTypeFromBuffer } from "file-type";
import mime from "mime-types";
import bbox from "@turf/bbox";
import { featureCollection } from "@turf/helpers";
import JSZip from "jszip";
import toGeoJSON from "@mapbox/togeojson";
import { DOMParser } from "@xmldom/xmldom";

/**
 * Utilitários para processamento de arquivos geoespaciais
 */

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface FileProcessingResult {
  isGeospatial: boolean;
  crs?: string;
  bounds?: BoundingBox;
  featureCount?: number;
  layerData?: any;
  metadata?: Record<string, any>;
}

/**
 * Validar tipo MIME do arquivo
 */
export async function validateMimeType(buffer: Buffer, expectedTypes: string[]): Promise<boolean> {
  try {
    const fileType = await fileTypeFromBuffer(buffer);
    
    if (!fileType) {
      // Alguns arquivos de texto não são detectados, validar por extensão
      return false;
    }

    return expectedTypes.includes(fileType.mime);
  } catch (error) {
    console.error("Erro ao validar MIME type:", error);
    return false;
  }
}

/**
 * Extrair bounding box de GeoJSON
 */
export function extractBoundsFromGeoJSON(geojson: any): BoundingBox | null {
  try {
    const features = geojson.type === "FeatureCollection" 
      ? geojson 
      : featureCollection([geojson]);

    const [west, south, east, north] = bbox(features);

    return { north, south, east, west };
  } catch (error) {
    console.error("Erro ao extrair bounds do GeoJSON:", error);
    return null;
  }
}

/**
 * Extrair bounding box de KML
 * Usa regex simples para extrair coordenadas (parsing completo requer xml2js)
 */
export function extractBoundsFromKML(kmlText: string): BoundingBox | null {
  try {
    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;

    // Buscar todas as tags <coordinates>
    const coordRegex = /<coordinates>([\s\S]*?)<\/coordinates>/gi;
    let match;
    
    while ((match = coordRegex.exec(kmlText)) !== null) {
      const coords = match[1].trim();
      const points = coords.split(/\s+/);
      
      for (const point of points) {
        const parts = point.split(",");
        if (parts.length >= 2) {
          const lon = parseFloat(parts[0]);
          const lat = parseFloat(parts[1]);
          
          if (!isNaN(lon) && !isNaN(lat)) {
            minLon = Math.min(minLon, lon);
            maxLon = Math.max(maxLon, lon);
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
          }
        }
      }
    }

    if (minLat === Infinity) return null;

    return {
      north: maxLat,
      south: minLat,
      east: maxLon,
      west: minLon,
    };
  } catch (error) {
    console.error("Erro ao extrair bounds do KML:", error);
    return null;
  }
}

/**
 * Processar arquivo SHP (Shapefile)
 * SHP deve vir em ZIP com: .shp, .shx, .dbf, .prj
 */
export async function processSHP(zipBuffer: Buffer): Promise<FileProcessingResult> {
  try {
    const zip = await JSZip.loadAsync(zipBuffer);
    
    // Verificar arquivos obrigatórios
    const files = Object.keys(zip.files);
    const hasShp = files.some(f => f.toLowerCase().endsWith('.shp'));
    const hasShx = files.some(f => f.toLowerCase().endsWith('.shx'));
    const hasDbf = files.some(f => f.toLowerCase().endsWith('.dbf'));
    
    if (!hasShp || !hasShx || !hasDbf) {
      throw new Error("ZIP do Shapefile incompleto. Arquivos obrigatórios: .shp, .shx, .dbf");
    }

    // Extrair arquivos
    const shpFile = files.find(f => f.toLowerCase().endsWith('.shp'))!;
    const dbfFile = files.find(f => f.toLowerCase().endsWith('.dbf'))!;
    const prjFile = files.find(f => f.toLowerCase().endsWith('.prj'));

    const shpBuffer = await zip.files[shpFile].async('nodebuffer');
    const dbfBuffer = await zip.files[dbfFile].async('nodebuffer');
    
    // Ler CRS do arquivo .prj se existir
    let crs = "EPSG:4674"; // SIRGAS 2000 padrão
    if (prjFile) {
      const prjContent = await zip.files[prjFile].async('string');
      // Tentar identificar CRS (simplificado)
      if (prjContent.includes('SIRGAS_2000') || prjContent.includes('SIRGAS 2000')) {
        crs = "EPSG:4674";
      } else if (prjContent.includes('WGS_1984') || prjContent.includes('WGS 84')) {
        crs = "EPSG:4326";
      }
    }

    // Converter SHP para GeoJSON usando shapefile library
    const geojson = await shapefile.read(shpBuffer, dbfBuffer);
    
    // Extrair bounds
    const bounds = extractBoundsFromGeoJSON(geojson);

    return {
      isGeospatial: true,
      crs,
      bounds: bounds || undefined,
      featureCount: geojson.features?.length || 0,
      layerData: geojson,
      metadata: {
        originalFormat: 'shapefile',
        files: files.filter(f => !f.endsWith('/')),
      },
    };
  } catch (error: any) {
    console.error("Erro ao processar SHP:", error);
    throw new Error(`Falha ao processar Shapefile: ${error.message}`);
  }
}

/**
 * Processar arquivo KML
 */
export async function processKML(kmlText: string): Promise<FileProcessingResult> {
  try {
    const document = new DOMParser().parseFromString(kmlText, "text/xml");
    if (document.getElementsByTagName("parsererror").length > 0) {
      throw new Error("XML KML inválido");
    }
    const layerData = toGeoJSON.kml(document) as { type: string; features?: unknown[] };
    const featureCount = layerData.features?.length || 0;
    const bounds = featureCount > 0 ? extractBoundsFromGeoJSON(layerData) : extractBoundsFromKML(kmlText);

    return {
      isGeospatial: true,
      crs: "EPSG:4326", // KML sempre usa WGS84
      bounds: bounds || undefined,
      featureCount,
      layerData: featureCount > 0 ? layerData : undefined,
      metadata: {
        originalFormat: 'kml',
        convertedToGeoJSON: featureCount > 0,
      },
    };
  } catch (error: any) {
    console.error("Erro ao processar KML:", error);
    throw new Error(`Falha ao processar KML: ${error.message}`);
  }
}

/**
 * Processar arquivo GeoJSON
 */
export async function processGeoJSON(geojsonText: string): Promise<FileProcessingResult> {
  try {
    const geojson = JSON.parse(geojsonText);
    const bounds = extractBoundsFromGeoJSON(geojson);

    return {
      isGeospatial: true,
      crs: geojson.crs?.properties?.name || "EPSG:4326",
      bounds: bounds || undefined,
      featureCount: geojson.features?.length || (geojson.type === "Feature" ? 1 : 0),
      layerData: geojson,
      metadata: {
        originalFormat: 'geojson',
      },
    };
  } catch (error: any) {
    console.error("Erro ao processar GeoJSON:", error);
    throw new Error(`Falha ao processar GeoJSON: ${error.message}`);
  }
}

/**
 * Detectar e processar arquivo geoespacial
 */
export async function processGeospatialFile(
  buffer: Buffer,
  filename: string
): Promise<FileProcessingResult> {
  const extension = filename.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'shp':
    case 'zip':
      // Assumir que ZIP contém SHP
      return await processSHP(buffer);
    
    case 'kml':
      return await processKML(buffer.toString('utf-8'));
    
    case 'kmz':
      // Extrair KML do KMZ
      const zip = await JSZip.loadAsync(buffer);
      const kmlFile = Object.keys(zip.files).find(f => f.toLowerCase().endsWith('.kml'));
      if (!kmlFile) {
        throw new Error("Nenhum arquivo KML encontrado no KMZ");
      }
      const kmlText = await zip.files[kmlFile].async('string');
      return await processKML(kmlText);
    
    case 'geojson':
    case 'json':
      return await processGeoJSON(buffer.toString('utf-8'));
    
    default:
      return {
        isGeospatial: false,
        metadata: {
          originalFormat: extension,
        },
      };
  }
}

/**
 * Validar tamanho de arquivo (proteção contra zip bomb)
 */
export function validateFileSize(size: number, maxSize: number = 100 * 1024 * 1024): boolean {
  return size <= maxSize; // 100MB padrão
}

/**
 * Validar arquivo ZIP (proteção contra zip bomb)
 */
export async function validateZipFile(buffer: Buffer): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    
    let totalUncompressedSize = 0;
    const maxUncompressedSize = 500 * 1024 * 1024; // 500MB descompactado

    for (const filename of Object.keys(zip.files)) {
      const file = zip.files[filename];
      if (!file.dir) {
        // @ts-ignore - _data existe mas não está tipado
        const uncompressedSize = file._data?.uncompressedSize || 0;
        totalUncompressedSize += uncompressedSize;

        if (totalUncompressedSize > maxUncompressedSize) {
          return false; // Possível zip bomb
        }
      }
    }

    return true;
  } catch (error) {
    console.error("Erro ao validar ZIP:", error);
    return false;
  }
}
