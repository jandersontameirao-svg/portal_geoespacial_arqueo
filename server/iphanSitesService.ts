/**
 * Consulta de sítios arqueológicos do IPHAN (SICG) via WFS oficial, como
 * camada vetorial consultável. Porte de previa-local-fluxos.mts (iphanRecords)
 * do Codex. Endpoint fixo e verificado; bbox validado; timeout, paginação com
 * verificação de integridade e limites de feições.
 */
import type { Feature, FeatureCollection, Geometry } from "geojson";

const IPHAN_WFS = "https://geoserver.iphan.gov.br/geoserver/SICG/wfs";
const FIELDS = "id_bem,identificacao_bem,co_iphan,codigo_iphan,ds_tipo_bem,ds_classificacao,sintese_bem,dt_cadastro";
const MAX_PER_LAYER = 2500;

function plain(value: unknown, limit: number): string {
  return String(value ?? "").slice(0, limit)
    .replace(/<\/?(?:p|div|br|li)\b[^>]*>/gi, " ").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function validBbox(bbox: string): boolean {
  const parts = bbox.split(",").map(Number);
  return parts.length === 4 && parts.every(Number.isFinite) && parts[1] <= parts[3];
}

async function fetchLayer(layer: "sitios" | "sitios_pol", bbox: string): Promise<Feature[]> {
  const geomField = layer === "sitios" ? "ponto" : "poligono";
  const params = new URLSearchParams({
    service: "WFS", version: "2.0.0", request: "GetFeature", typeNames: "SICG:" + layer,
    outputFormat: "application/json", srsName: "EPSG:4326",
    propertyName: FIELDS + "," + geomField,
    bbox: bbox + ",urn:ogc:def:crs:OGC:1.3:CRS84", count: "200", sortBy: "id_bem",
  });
  const loadPage = async () => {
    const response = await fetch(IPHAN_WFS + "?" + params, { signal: AbortSignal.timeout(15000), redirect: "error" });
    if (!response.ok) throw new Error("O serviço de sítios do IPHAN não respondeu.");
    const body = await response.json();
    if (!Array.isArray(body.features)) throw new Error("O IPHAN não retornou registros consultáveis.");
    return body as { features: any[]; numberMatched?: number };
  };
  const first = await loadPage();
  const raw: any[] = [...first.features];
  const total = first.numberMatched;
  if (!Number.isSafeInteger(total) || (total as number) > MAX_PER_LAYER) {
    throw new Error("O total de sítios excede o limite ou não pôde ser verificado. Aproxime o mapa.");
  }
  while (raw.length < (total as number)) {
    params.set("startIndex", String(raw.length));
    const page = await loadPage();
    if (!page.features.length || page.numberMatched !== total) throw new Error("A paginação do IPHAN ficou incompleta. Tente novamente.");
    raw.push(...page.features);
  }
  return raw.flatMap((feature) => {
    const p = feature.properties ?? {};
    if (!Number.isSafeInteger(p.id_bem) || p.id_bem < 1 || !feature.geometry) return [];
    return [{
      type: "Feature" as const,
      geometry: feature.geometry as Geometry,
      properties: {
        id: p.id_bem,
        nome: plain(p.identificacao_bem, 300),
        codigo: plain(p.co_iphan || p.codigo_iphan, 100),
        classificacao: plain(p.ds_classificacao, 150),
        tipoBem: plain(p.ds_tipo_bem, 150),
        sintese: plain(p.sintese_bem, 12000),
        cadastro: plain(p.dt_cadastro, 24),
        fonte: "GeoServer IPHAN / SICG",
        camada: "SICG:" + layer,
      },
    }];
  });
}

/** Sítios SICG (pontos + polígonos) dentro da vista. Lança em caso de falha/limite. */
export async function iphanSitesInView(bbox: string): Promise<FeatureCollection> {
  if (!validBbox(bbox)) throw new Error("Recorte (bbox) inválido.");
  const layers = await Promise.all((["sitios", "sitios_pol"] as const).map((layer) => fetchLayer(layer, bbox)));
  return { type: "FeatureCollection", features: layers.flat() };
}
