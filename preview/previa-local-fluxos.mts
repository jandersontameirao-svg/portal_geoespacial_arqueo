import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { ingestCog, renderCog } from "./previa-local-raster.mts";
import { exportVector } from "./previa-exportar-vetor.mts";
import { readIbgeLayer } from "./previa-ibge-dados.mts";
import { defaultStudioPaper, linearAtlasScale, studioModels, studioTerrain, studioLayerRequirements, readPaper, readOrientation, restoreLegend, readLayout, readScale, readStudioView } from "./previa-layout.mts";

const require = createRequire(new URL("../package.json", import.meta.url));
const { jsPDF } = require("jspdf");
const bufferGeometry = require("@turf/buffer").default;
const municipalAnchors = JSON.parse(readFileSync(new URL("./previa-raster/angicos/rotulos-ibge.json", import.meta.url), "utf8"));
const storePath = fileURLToPath(new URL("./previa-local-dados.json", import.meta.url));
const seed = { id: 1, name: "Levantamento arqueológico demonstrativo", code: "DEMO-01", description: "Projeto fictício para explorar o Geoportal.", clientName: "Cliente fictício", status: "active", createdAt: "2026-11-12T12:00:00Z" };
type Row = Record<string, any>;
type State = { mapProjectIds?: number[]; iphanKnowledge?: Row[]; geometries?: Row[]; projects: Row[]; files: Row[]; jobs: Row[]; templates: Row[]; products?: Record<string, Row[]>; recentProjects?: Record<string, number[]>; connections?: Row[]; studioBrands?: Row[]; nextId: number };
let state: State;
try {
  state = JSON.parse(readFileSync(storePath, "utf8"));
} catch (error: any) {
  if (error.code !== "ENOENT") throw error;
  state = { projects: [seed], files: [], jobs: [], templates: [], nextId: 2 };
}

const sample = {
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: { nome: "Área fictícia" }, geometry: {
    type: "Polygon", coordinates: [[[-43.96,-19.94],[-43.94,-19.94],[-43.94,-19.92],[-43.96,-19.92],[-43.96,-19.94]]],
  } }],
};

function paths(geometry: any): number[][][] {
  switch (geometry?.type) {
    case "Point": return [[geometry.coordinates]];
    case "MultiPoint": return geometry.coordinates.map((point: number[]) => [point]);
    case "LineString": return [geometry.coordinates];
    case "MultiLineString":
    case "Polygon": return geometry.coordinates;
    case "MultiPolygon": return geometry.coordinates.flat();
    case "GeometryCollection": return geometry.geometries.flatMap(paths);
    default: return [];
  }
}

function parseVector(contents: Buffer, extension: string) {
  if (!["geojson", "json", "kml", "kmz", "zip"].includes(extension)) return null;
  let document;
  if (extension === "kml" || extension === "kmz") {
    const { DOMParser } = require("@xmldom/xmldom");
    const { kml } = require("@mapbox/togeojson");
    if (extension === "kmz") {
      const Zip = require("adm-zip");
      const entry = new Zip(contents).getEntries().find((item: any) => !item.isDirectory && /\.kml$/i.test(item.entryName) && item.header.size <= 8_000_000);
      if (!entry) throw Error("KMZ sem KML compatível.");
      contents = entry.getData();
    }
    document = kml(new DOMParser().parseFromString(contents.toString("utf8"), "text/xml"));
  } else if (extension === "zip") {
    const Zip = require("adm-zip");
    const entries = new Zip(contents).getEntries();
    if (entries.reduce((sum: number, entry: any) => sum + entry.header.size, 0) > 32_000_000) throw Error("Shapefile excede o limite descompactado da prévia.");
    document = (require("shpjs").default ?? require("shpjs"))(contents);
  } else {
    document = JSON.parse(contents.toString("utf8").replace(/^\uFEFF/, ""));
  }
  return Promise.resolve(document).then(value => {
    const features = (Array.isArray(value) ? value : [value]).flatMap(item =>
      item.type === "FeatureCollection" ? item.features : [item.type === "Feature" ? item : { type: "Feature", properties: {}, geometry: item }]
    );
    const vertices = features.flatMap(feature => paths(feature.geometry)).flat();
    if (!vertices.length || vertices.length > 100_000 || !vertices.every(point =>
      Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90
    )) throw Error("Arquivo sem feições válidas em longitude/latitude ou acima do limite da prévia.");
    return { type: "FeatureCollection", features };
  });
}

function save(next: State) {
  writeFileSync(storePath + ".tmp", JSON.stringify(next));
  renameSync(storePath + ".tmp", storePath);
  state = next;
}

function append(collection: Exclude<keyof State, "nextId">, values: Row) {
  const row = { ...values, id: state.nextId, createdAt: new Date().toISOString() };
  save({ ...state, [collection]: [...(state[collection] ?? []), row], nextId: row.id + 1 });
  return row;
}

export function* projectSearchEntries() {
  for (const project of state.projects) {
    const href = "/projects/" + project.id;
    yield { key: "project-" + project.id, title: project.name, detail: project.code ?? "", category: "Projeto", href };
    for (const file of projectRows(state.files, { projectId: project.id })) {
      yield { key: "file-" + file.id, title: file.name, detail: project.name,
        category: file.isGeospatial ? "Camada" : "Arquivo", href: href + (file.isGeospatial ? "?tab=map" : "?tab=files") };
    }
  }
}

function projectRows(rows: Row[], input: Row) {
  return rows.filter(row => !input.projectId || row.projectId === input.projectId);
}

type DrawKind = "marker" | "polyline" | "polygon";
function checkedDrawing(type: DrawKind, coordinates: unknown) {
  if (typeof coordinates === "string") coordinates = JSON.parse(coordinates);
  const point = (value: unknown): value is number[] => Array.isArray(value) && value.length === 2 &&
    value.every(Number.isFinite) && Math.abs(value[0]) <= 90 && Math.abs(value[1]) <= 180;
  if (type === "marker" && point(coordinates)) return coordinates;
  const path = (value:unknown, minimum:number): value is number[][] =>
    Array.isArray(value) && value.length <= 5000 && value.every(point) &&
    new Set(value.map(p => p.join(","))).size >= minimum;
  if (type === "polyline" && path(coordinates,2)) return coordinates;
  if (type === "polygon") {
    const rings = path(coordinates,3) ? [coordinates] : coordinates;
    if (Array.isArray(rings) && rings.length && rings.length <= 20 && rings.every(ring => path(ring,3)))
      return rings.map(ring => ring[0].join(",") === ring.at(-1).join(",") ? ring : [...ring,ring[0]]);
  }
  throw Error("Confira o tipo da feição e as coordenadas.");
}

function influenceGeometry(projectId: number, options: {kind: string; source: string; metres?: number}) {
  const sourceName = options.source.replace(/\.geojson$/i, "");
  const normalized = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const layers = state.files.filter(row => row.projectId === projectId && row.vector &&
    normalized(row.name.replace(/\.geojson$/i,"")) === normalized(sourceName));
  const drawings = (state.geometries ?? []).filter(row => row.projectId === projectId && normalized(row.name) === normalized(sourceName));
  if (layers.length + drawings.length !== 1) throw Error("Informe o nome exato de uma única camada ou feição do projeto.");
  const shape = drawings[0];
  const features = layers[0]?.vector.features ?? (shape?.type === "polyline" ? [{
    type:"Feature", properties:{}, geometry:{ type:"LineString",
      coordinates:(checkedDrawing("polyline",shape.coordinates) as number[][]).map(([lat,lon]) => [lon,lat]),
    },
  }] : []);
  if (!features.length || !features.every((feature: Row) =>
    /^(Multi)?LineString$/.test(feature.geometry?.type) && paths(feature.geometry).every(line => line.length >= 2)))
    throw Error("Use uma camada de linhas ou uma linha desenhada como eixo.");
  const collection = { type:"FeatureCollection", features };
  const radius = options.metres ?? (options.kind === "ADA" ? 30 : 250);
  const buffered = bufferGeometry(collection, radius, { units:"meters" });
  if (!buffered?.features.length) throw Error("O buffer não produziu áreas.");
  const properties = { camada:options.kind, camada_origem:sourceName, buffer_m:radius };
  if (options.kind !== "AII") return { ...buffered,
    features:buffered.features.map((feature: Row) => ({...feature,properties})) };
  const bounds = [Infinity,Infinity,-Infinity,-Infinity];
  for (const feature of buffered.features) for (const ring of paths(feature.geometry)) for (const [x,y] of ring) {
    bounds[0] = Math.min(bounds[0],x); bounds[1] = Math.min(bounds[1],y);
    bounds[2] = Math.max(bounds[2],x); bounds[3] = Math.max(bounds[3],y);
  }
  const candidates = readIbgeLayer("municipios",bounds.join(","));
  if (!candidates || candidates.zoomRequired) throw Error("Divida o eixo em trechos para consultar a malha municipal.");
  const intersect = require("@turf/intersect").default;
  const selected = candidates.features.filter(municipality => buffered.features.some((area:Row) =>
    intersect({type:"FeatureCollection",features:[municipality,area]}) !== null));
  if (!selected.length) throw Error("Nenhum município da malha IBGE disponível intercepta a AID.");
  return {type:"FeatureCollection", features:selected.map(municipality => ({
    ...municipality,
    properties:{ ...properties, nome:municipality.properties.nome, uf:municipality.properties.uf,
      codigo_ibge:municipality.properties.codigo, fonte:"IBGE 2024 · malha simplificada da prévia" },
  }))};
}

function saveAnalysis(projectId: number, name: string, vector: Row) {
  // Store the same GeoJSON as a visible vector and as the original download.
  // append() assigns an ID and atomically replaces the local preview store.
  const contents = Buffer.from(JSON.stringify(vector));
  const file = append("files", { projectId, name, fileType: "geojson", fileSize: contents.length,
    isGeospatial: true, currentVersion: 1, uploadedAt: new Date().toISOString(),
    s3Url: "/previa/download/arquivo/" + state.nextId, contents: contents.toString("base64"), vector });
  return { id: file.id, name, result: { output: vector } };
}

const iphanConnection = {
  id: -1, name: "IPHAN · Sítios arqueológicos (SICG)", type: "WMS",
  address: "https://geoserver.iphan.gov.br/geoserver/wms",
  layer: "SICG:sitios,SICG:sitios_pol", enabled: true, official: true,
};

const officialConnections = [
  iphanConnection,
  { id: -21, name: "MapBiomas Brasil · 2024", type: "ArcGIS cache SIRGAS 2000",
    address: "https://tiles.arcgis.com/tiles/qFQYQQeTXZSPY7Fs/arcgis/rest/services/MapBiomas_Mapas_de_Cobertura_do_Solo/MapServer",
    layer: "mapbiomas2024", enabled: false, group: "uso-solo",
    status: "Cobertura nacional de 2024 · serviço público da Imagem/ArcGIS (beta, CC BY 4.0).",
  },
  { id: -20, name: "ESA WorldCover · Cobertura do solo (2021)", type: "Raster local",
    address: "https://esa-worldcover.org/en/data-access", layer: "worldcover",
    enabled: false, group: "uso-solo", status: "Recorte da LT Angicos–Jaguaruana II." },
  { id: -16, name: "ICMBio / CECAV · Cavidades CANIE (05/2026)", type: "WMS",
    address: "https://geoservicos.inde.gov.br/geoserver/ICMBio/ows", layer: "canie_052026_p",
    enabled: false, group: "cavidades" },
  ...[
    { id: -17, title: "Imóveis rurais privados · SIGEF", service: "lim_imovel_sigef_privado_a", layer: "9" },
    { id: -18, title: "Imóveis rurais públicos · SIGEF", service: "lim_imovel_sigef_publico_a", layer: "10" },
    { id: -19, title: "Assentamentos rurais", service: "assentamentos_incra", layer: "1" },
  ].map(({ id, title, service, layer }) => ({
    id, name: "INCRA via Ibama · " + title, type: "ArcGIS REST",
    address: "https://pamgia.ibama.gov.br/server/rest/services/01_Publicacoes_Bases/" + service + "/MapServer",
    layer, enabled: false, group: "fundiario",
  })),
  { id: -15, name: "Copernicus GLO-30 · LT Angicos–Jaguaruana II", type: "Raster local",
    address: "https://registry.opendata.aws/copernicus-dem/", layer: "sombreado,elevacao,declividade,curvas",
    enabled: false, group: "relevo" },
  { id: -13, name: "ANA · Trechos de drenagem", type: "ArcGIS REST",
    address: "https://www.snirh.gov.br/arcgis/rest/services/IG/Servicos_Base_IG/MapServer",
    layer: "1", enabled: false, group: "recursos-hidricos" },
  { id: -14, name: "ANA · Bacias, águas e monitoramento", type: "ArcGIS REST",
    address: "https://www.snirh.gov.br/arcgis/rest/services/INDE/Camadas/MapServer",
    layer: "53,54,140,156,159,154,134,141", enabled: false, group: "recursos-hidricos" },
  // Public services used by the IPHAE map at https://www.iphae.rs.gov.br/mapa.
  ...[
    { id: -10, title: "Bens tombados", service: "bens_tombados" },
    { id: -11, title: "Entorno dos bens tombados", service: "entornos_bens_tombados" },
    { id: -12, title: "Centros históricos", service: "centro_historico" },
  ].map(({ id, title, service }) => ({
    id, name: "RS · IPHAE · " + title, type: "ArcGIS REST",
    address: "https://iede.rs.gov.br/server/rest/services/CULTURA/" + service + "/MapServer",
    layer: "0", enabled: false, group: "patrimonio-estadual",
  })),
  { id: -9, name: "SP · Condephaat estadual", type: "WMS", address: "https://www.idesp.sp.gov.br/geoserver/idesp_acervo/wms",
    layer: "idesp_acervo:bem_tomb_a_2025_01_v0", enabled: false, group: "patrimonio-estadual",
    status: "Bens tombados mapeados pela IDE-SP em todo o estado · edição 2025.01." },
  { id: -8, name: "SP · Condephaat", type: "GeoJSON", address: "https://dadosabertos.urbis.prefeitura.sp.gov.br/dataset/idesp-imoveis-estadual",
    layer: "condephaat-capital", enabled: false, group: "patrimonio-estadual",
    status: "Base estadual IDE-SP, recorte do município de São Paulo." },
  { id: -7, name: "MG · IEPHA-MG", type: "WMS", address: "https://geoserver.meioambiente.mg.gov.br/ows",
    layer: "IDE:ide_2017_mg_tombamento_iepha_pto,IDE:ide_2017_mg_ai_patrimonio_cultural_iepha_pol,IDE:ide_2017_mg_celebracoes_formas_expressao_iepha_pto,IDE:ide_2017_mg_lugares_iepha_pto,IDE:ide_2017_mg_saberes_iepha_pol",
    enabled: false, group: "patrimonio-estadual" },
  { id: -2, name: "IBGE · Estados, municípios e localidades", type: "GeoJSON", address: "https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais.html", layer: "ibge", enabled: true },
  { id: -3, name: "FUNAI/CMR · Terras indígenas", type: "WMS", address: "https://cmr.funai.gov.br/geoserver/ows", layer: "CMR-PUBLICO:lim_terra_indigena_a", enabled: false },
  { id: -4, name: "INCRA · Territórios quilombolas (via Ibama)", type: "ArcGIS REST", address: "https://pamgia.ibama.gov.br/server/rest/services/BasesSincronizadas/lim_quilombos_incra_a/MapServer", layer: "0", enabled: false },
  { id: -5, name: "Palmares · Municípios com comunidades certificadas", type: "GeoJSON · Palmares e IBGE", address: "https://www.gov.br/palmares/pt-br/departamentos/protecao-preservacao-e-articulacao/certificacao-quilombola", layer: "palmares", enabled: false, status: "Destaque por município. Os polígonos representam limites municipais." },
  { id: -6, name: "ANEEL · Linhas de transmissão (GGT)", type: "ArcGIS REST", address: "https://sigel.aneel.gov.br/arcgis/rest/services/GGT/Dados_WebApp_GGT/MapServer", layer: "0", enabled: false, group: "infraestrutura-eletrica" },
].map(connection => ({ ...connection, official: true }));

function listConnections() {
  const custom = state.connections ?? [];
  return [...officialConnections.map(connection => ({
    ...connection,
    enabled: Boolean(connection.layer) && (custom.find(item => item.id === connection.id)?.enabled ?? connection.enabled),
    selectedLayers: custom.find(item => item.id === connection.id)?.selectedLayers,
    availableLayers: connection.id === -1 ? ["DBGEO:Empreendimentos", "fca:fca"] : undefined,
  })), ...custom.filter(item => !officialConnections.some(connection => connection.id === item.id))];
}

function validRemoteSelection(values: unknown[], type: string) {
  const pattern = type === "WMS" ? /^[\w.:-]{1,150}$/ : /^\d{1,8}$/;
  return [...new Set(values.filter((value): value is string =>
    typeof value === "string" && pattern.test(value)))].slice(0, 40);
}

const iphanSiteEndpoint = "https://geoserver.iphan.gov.br/geoserver/SICG/wfs";
const iphanFields = "id_bem,identificacao_bem,co_iphan,codigo_iphan,ds_tipo_bem,ds_classificacao,sintese_bem,dt_cadastro";

async function iphanRecords(filter: {bbox:string} | {id:number} | {code:string}, includeGeometry = false) {
  // The endpoint is fixed. The viewport and numeric record ID are validated before use.
  const plain = (value:unknown, limit:number) => String(value ?? "").slice(0,limit)
    .replace(/<\/?(?:p|div|br|li)\b[^>]*>/gi," ").replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim();
  const rows = await Promise.all(["sitios","sitios_pol"].map(async layer => {
    const params = new URLSearchParams({service:"WFS",version:"1.0.0",request:"GetFeature",typeName:"SICG:"+layer,
      maxFeatures:includeGeometry ? "501" : "8", outputFormat:"application/json", srsName:"EPSG:4326",
      propertyName:includeGeometry ? iphanFields+","+(layer === "sitios" ? "ponto" : "poligono") : iphanFields});
    if ("bbox" in filter) params.set("bbox",filter.bbox+",EPSG:4326");
    else if ("id" in filter) params.set("CQL_FILTER","id_bem="+filter.id);
    else params.set("CQL_FILTER","codigo_iphan='"+filter.code+"' OR co_iphan='"+filter.code+"'");
    const loadPage = async () => {
      const response = await fetch(iphanSiteEndpoint+"?"+params,{signal:AbortSignal.timeout(15000),redirect:"error"});
      if (!response.ok) throw Error("O serviço de sítios do IPHAN não respondeu.");
      const body = await response.json();
      if (!Array.isArray(body.features)) throw Error("O IPHAN não retornou registros consultáveis.");
      return body;
    };
    if (includeGeometry && "bbox" in filter) {
      params.set("version","2.0.0");
      params.set("typeNames","SICG:"+layer);
      params.delete("typeName");
      params.delete("maxFeatures");
      params.set("bbox",filter.bbox+",urn:ogc:def:crs:OGC:1.3:CRS84");
      params.set("count","200");
      params.set("sortBy","id_bem");
    }
    const first = await loadPage();
    const features:Row[] = [...first.features];
    if (includeGeometry) {
      const total = first.numberMatched;
      if (!Number.isSafeInteger(total) || total > 2500)
        throw Error("O total de sítios não pôde ser verificado ou excede 2.500 feições por camada.");
      while (features.length < total) {
        params.set("startIndex",String(features.length));
        const page = await loadPage();
        if (!page.features.length || page.numberMatched !== total) throw Error("A paginação do IPHAN ficou incompleta. Tente novamente.");
        features.push(...page.features);
      }
      if (features.length !== total || new Set(features.map(feature => feature.id)).size !== total)
        throw Error("A paginação do IPHAN retornou feições repetidas ou incompletas.");
    }
    return features.flatMap(({properties:p,geometry}:Row) => {
      if (!Number.isSafeInteger(p?.id_bem) || p.id_bem < 1) return [];
      return [{id:p.id_bem, nome:plain(p.identificacao_bem,300),
        codigo:plain(p.co_iphan || p.codigo_iphan,100), classificacao:plain(p.ds_classificacao,150),
        sintese:plain(p.sintese_bem,12000), cadastro:plain(p.dt_cadastro,24), tipoBem:plain(p.ds_tipo_bem,150),
        fonte:"GeoServer IPHAN / SICG", camada:"SICG:"+layer, tipologia:null,
        ...(includeGeometry ? {geometry} : {})}];
    });
  }));
  return includeGeometry ? rows.flat() : [...new Map(rows.flat().map(record => [record.id,record])).values()];
}

const influenceKinds = ["ADA","AID","AII"] as const;
const influenceColors = { ADA:"#dc2638", AID:"#a76400", AII:"#217a4b" };

function iphanInfluenceLayers(projectId:number) {
  const files = state.files.filter(file => file.projectId === projectId && file.vector);
  return influenceKinds.map(kind => {
    const layer = files.find(file => file.name === kind+".geojson");
    if (!layer?.vector.features.length || !layer.vector.features.every((feature:Row) => /^(Multi)?Polygon$/.test(feature.geometry?.type)))
      throw Error("A camada poligonal "+kind+" precisa estar disponível no projeto.");
    return {kind,layer};
  });
}

async function officialSiteTypology(id:number, code:string) {
  const url = new URL("https://sicg.iphan.gov.br/sicg/pesquisarBem/detalharBem");
  url.search = new URLSearchParams({"pesquisaBemVO.filtro":"BEM_MATERIAL","pesquisaBemVO.idBem":String(id)}).toString();
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(url,{signal:AbortSignal.timeout(7500),redirect:"error"});
    if (!response.ok) return {status:"ficha_indisponivel",checkedAt,url:url.href,http:response.status};
    const body = await response.json();
    // Only accept an explicit site typology from a record that identifies the same site.
    // A classification or a word found in the synthesis is not a typology from the official record.
    const detail = body?.detalharBemVO ?? body;
    const records = [detail?.sitioArqueologico,detail?.bem?.sitioArqueologico,detail?.bem,detail].filter(Boolean);
    const record = records.find(item =>
      String(item.idBem ?? item.id_bem ?? item.id ?? "") === String(id) ||
      (code && String(item.codigoIphan ?? item.codigo_iphan ?? "").toLowerCase() === code.toLowerCase()));
    const value = record?.tipologiaSitio ?? record?.tipologiaArqueologica ??
      (record && records.slice(0,2).includes(record) && (record === detail?.sitioArqueologico || record === detail?.bem?.sitioArqueologico) ? record.tipologia : undefined);
    if (typeof value === "string" && value.trim() && value.length <= 1000)
      return {status:"confirmada",checkedAt,url:url.href,value:value.trim()};
    // Preserve an explicit designation from the matched public record as descriptive evidence.
    const literal = record?.sintese?.trim?.().match(/^s[ií]tio l[ií]tico\b/iu)?.[0];
    return {status:"sem_tipologia_estruturada",checkedAt,url:url.href,
      ...(literal ? {descricaoTipologica:literal,campo:"detalharBemVO.sintese"} : {})};
  } catch {
    return {status:"ficha_indisponivel",checkedAt,url:url.href};
  }
}

function prepareCorridorAtlas(projectId:number,text:string) {
  if (projectId !== 11) throw Error("O Estúdio do atlas por corredor está disponível na prévia da LT Angicos.");
  const requestedScale = text.match(/\b1\s*:\s*(\d+(?:\.\d{3})*)\b/)?.[1];
  const scale = requestedScale ? readScale(Number(requestedScale.replaceAll(".",""))) ?? linearAtlasScale : linearAtlasScale;
  const paper = text.match(/\ba[0-4]\b/)?.[0].toUpperCase() ?? defaultStudioPaper;
  const portrait = /\b(retrato|vertical)\b/.test(text);
  const available = state.files.filter(row => row.projectId === projectId && row.vector);
  if (![14,15].every(id => available.some(row => row.id === id))) throw Error("O atlas por corredor precisa da ADA e do eixo da LT.");
  const query = new URLSearchParams({modelo:"corredor",papel:paper,
    orientacao:portrait ? "portrait" : "landscape",foco:"ada",escala:String(scale)});
  return {
    studioUrl:`/projects/${projectId}?tab=products&${query}`,
    description:`${paper} ${portrait ? "retrato" : "paisagem"}, a 1:${scale.toLocaleString("pt-BR")}`,
  };
}

async function crossIphanInfluence(projectId:number, areas:ReturnType<typeof iphanInfluenceLayers>) {
  const turfBbox = require("@turf/bbox").default;
  const intersect = require("@turf/intersect").default;
  const contains = require("@turf/boolean-point-in-polygon").default;
  const bounds = turfBbox({type:"FeatureCollection",features:areas.flatMap(({layer}) => layer.vector.features)});
  if (!bounds.every(Number.isFinite) || bounds[2]-bounds[0]>4 || bounds[3]-bounds[1]>4)
    throw Error("O recorte das áreas de influência está inválido ou excede 4° por eixo.");
  const geometries = await iphanRecords({bbox:bounds.join(",")},true);
  const hits = new Map<number,{record:typeof geometries[number]; matches:Map<string,Row>}>();
  for (const record of geometries) {
    const geometry = record.geometry;
    if (!geometry) continue;
    const polygon = /^(Multi)?Polygon$/.test(geometry.type);
    if (!polygon && geometry.type !== "Point") continue;
    for (const {kind,layer} of areas) {
      const site = {type:"Feature",properties:{},geometry};
      const match = layer.vector.features.some((area:Row) => polygon
        ? intersect({type:"FeatureCollection",features:[area,site]}) !== null
        : contains(site,area));
      if (!match) continue;
      const hit = hits.get(record.id) ?? {record,matches:new Map<string,Row>()};
      // One row per SICG site per area. Keep the polygon where both representations match.
      if (!hit.matches.has(kind) || polygon) hit.matches.set(kind,geometry);
      hits.set(record.id,hit);
    }
  }
  const sites = [...hits.values()];
  const volumes = Object.fromEntries(influenceKinds.map(kind => [kind,sites.filter(site => site.matches.has(kind)).length]));
  const deadline = Date.now()+35000;
  type TypologyCheck = Awaited<ReturnType<typeof officialSiteTypology>>;
  const typologies = new Map<number,TypologyCheck>();
  const observations = state.iphanKnowledge ?? [];
  const isRecent = (check:TypologyCheck) => Date.now()-Date.parse(check.checkedAt) < 86400000;
  let rateLimited = observations.some(row => row.verificacaoTipologia?.http === 429 && isRecent(row.verificacaoTipologia));
  for (let index=0;index<sites.length;index+=5) {
    await Promise.all(sites.slice(index,index+5).map(async ({record}) => {
      const previous = observations.findLast(row => row.id === record.id && row.verificacaoTipologia?.checkedAt)?.verificacaoTipologia as TypologyCheck | undefined;
      if (previous && isRecent(previous)) {
        typologies.set(record.id,previous);
      } else if (!rateLimited && Date.now() < deadline) {
        const check = await officialSiteTypology(record.id,record.codigo);
        typologies.set(record.id,check);
        if (check.http === 429) rateLimited = true;
      }
    }));
  }

  const checkedAt = new Date().toISOString();
  // The result layers and evidence are committed together only after both WFS layers were read completely.
  let nextId = state.nextId;
  const files = state.files.filter(file => !(file.projectId === projectId && file.analysisKind === "iphan-influence"));
  const knowledge = [...(state.iphanKnowledge ?? [])];
  for (const {record} of sites) {
    const {geometry,...attrs} = record;
    const check = typologies.get(record.id);
    const prior = knowledge.findLast(item => item.id === record.id && item.tipologia);
    const description = knowledge.findLast(item => item.id === record.id && item.descricaoTipologicaSicg);
    // A temporary upstream failure must not discard an earlier confirmed observation.
    knowledge.push({...attrs,projectId,consultadoEm:checkedAt,
      tipologia:check?.value ?? prior?.tipologia ?? null,
      descricaoTipologicaSicg:check?.descricaoTipologica ?? description?.descricaoTipologicaSicg,
      fonteDescricaoTipologica:check?.descricaoTipologica ? check.url : description?.fonteDescricaoTipologica,
      verificacaoTipologia:check ?? {status:"consulta_pendente"},
      fonteTipologia:check?.value ? check.url : prior?.fonteTipologia,
      ficha:"https://sicg.iphan.gov.br/sicg/pesquisarBem"});
  }
  for (const {kind,layer} of areas) {
    const features = sites.flatMap(({record,matches}) => {
      const geometry = matches.get(kind);
      if (!geometry) return [];
      const memberships = influenceKinds.filter(area => matches.has(area)).join(", ");
      return [{type:"Feature",geometry,properties:{
        name:record.nome+" · "+(record.codigo || "sem código") + " · "+memberships,
        codigo_iphan:record.codigo, id_sicg:record.id, areas:memberships, fonte:record.camada,
      }}];
    });
    if (!features.length) continue;
    const id = nextId++;
    const vector = {type:"FeatureCollection",features};
    const contents = Buffer.from(JSON.stringify(vector));
    files.push({id,projectId,name:"Sítios IPHAN · "+kind+".geojson",fileType:"geojson",
      fileSize:contents.length, isGeospatial:true, isVisible:true,currentVersion:1, uploadedAt:checkedAt,
      s3Url:"/previa/download/arquivo/"+id,contents:contents.toString("base64"),vector,
      analysisKind:"iphan-influence",areaSourceId:layer.id,consultadoEm:checkedAt,
      defaultStyle:{color:influenceColors[kind],weight:3,fillOpacity:.2}});
  }
  save({...state,files,iphanKnowledge:knowledge,nextId});
  const verified = [...typologies.values()].filter(check => check.status === "confirmada").length;
  const unavailable = [...typologies.values()].filter(check => check.status === "ficha_indisponivel").length;
  return {iphanCrossing:true, message:`IPHAN · ADA: ${volumes.ADA}; AID: ${volumes.AID}; AII: ${volumes.AII}. ${sites.length} sítio(s) distinto(s) guardado(s). As áreas podem se sobrepor. Tipologias confirmadas nas fichas: ${verified}. Fichas indisponíveis: ${unavailable}; sem tentativa registrada: ${sites.length-typologies.size}. As áreas com resultado têm camada própria em Mapa & Análise.`};
}

// Keep earlier source observations and avoid duplicating a record read twice.
function saveIphanKnowledge(record:Row, projectId:number, consultadoEm:string) {
  const records = state.iphanKnowledge ?? [];
  const latest = records.findLast(row => row.id === record.id);
  if (latest && Object.keys(record).every(key => record[key] === latest[key])) return;
  const confirmed = records.findLast(row => row.id === record.id && row.tipologia);
  save({...state,iphanKnowledge:[...records,{...record,projectId,consultadoEm,
    tipologia:record.tipologia ?? confirmed?.tipologia ?? null, fonteTipologia:confirmed?.fonteTipologia,
    ficha:"https://sicg.iphan.gov.br/sicg/pesquisarBem"}]});
}

function iphanPopupFields(record:Row) {
  const saved = (state.iphanKnowledge ?? []).findLast(row => row.id === record.id);
  return {
    ...record,
    tipoBem:record.tipoBem || saved?.tipoBem || "Sítio arqueológico",
    tipologia:saved?.tipologia ?? record.tipologia ?? null,
    descricaoTipologicaSicg:saved?.descricaoTipologicaSicg,
    ficha:saved?.fonteTipologia ?? saved?.fonteDescricaoTipologica ??
      "https://sicg.iphan.gov.br/sicg/pesquisarBem",
  };
}
function annotateIphanVector(file:Row) {
  if (file.analysisKind !== "iphan-influence") return file.vector;
  return {...file.vector,features:file.vector.features.map((feature:Row) => {
    const props = feature.properties;
    const saved = (state.iphanKnowledge ?? []).findLast(row => row.id === props.id_sicg);
    return {...feature,properties:{...props,...iphanPopupFields({
      id:props.id_sicg,nome:saved?.nome ?? props.name,codigo:props.codigo_iphan,
      classificacao:saved?.classificacao,sintese:saved?.sintese,cadastro:saved?.cadastro,
    })}};
  })};
}

type PreviewBounds = [number,number,number,number];
function regionalProjectSelection(projectId:number, requireAii = false) {
  const bbox = require("@turf/bbox").default;
  const valid = (box:unknown): box is PreviewBounds => Array.isArray(box) && box.length === 4 &&
    box.every(Number.isFinite) && box[0] <= box[2] && box[1] <= box[3] &&
    box[0] >= -180 && box[2] <= 180 && box[1] >= -90 && box[3] <= 90;
  const filesFor = (id:number) => state.files.filter(file => file.projectId === id && !file.analysisKind);
  const boundsFor = (project:Row) => {
    const bounds:PreviewBounds[] = [];
    if (project.aoiBounds) {
      try {
        const box = bbox(typeof project.aoiBounds === "string" ? JSON.parse(project.aoiBounds) : project.aoiBounds);
        if (valid(box)) bounds.push(box);
      } catch { /* Invalid or absent AOI does not contribute to the map selection. */ }
    }
    for (const file of filesFor(project.id)) {
      if (file.vector?.features.length) {
        const box = bbox(file.vector);
        if (valid(box)) bounds.push(box);
      }
      if (file.cog?.bounds) {
        const {west,south,east,north} = file.cog.bounds;
        const box = [west,south,east,north];
        if (valid(box)) bounds.push(box);
      }
    }
    return bounds;
  };
  const reference = state.projects.find(project => project.id === projectId);
  if (!reference) throw Error("Indique o projeto usado como referência.");
  const aii = filesFor(projectId).find(file => /^AII\.geojson$/i.test(file.name) && file.vector?.features.length);
  if (requireAii && !aii) throw Error("O projeto de referência não tem uma camada AII.");
  if (aii) {
    const aiiFeatures:Row[] = aii.vector.features.filter((feature:Row) =>
      /^(Multi)?Polygon$/.test(feature.geometry?.type));
    if (aiiFeatures.length !== aii.vector.features.length || !aiiFeatures.length)
      throw Error("A AII precisa conter geometrias poligonais válidas.");
    const intersects = require("@turf/boolean-intersects").default;
    const areaBounds = bbox(aii.vector,{recompute:true});
    if (!valid(areaBounds)) throw Error("A geometria da AII está fora dos limites válidos.");
    const overlaps = ([w,s,e,n]:PreviewBounds) => w <= areaBounds[2] && e >= areaBounds[0] && s <= areaBounds[3] && n >= areaBounds[1];

    const projects = state.projects.filter(project => {
      const geometries:Row[] = filesFor(project.id).flatMap(file =>
        (file.vector?.features ?? []).flatMap((feature:Row) => feature.geometry ? [feature.geometry] : []));
      if (project.aoiBounds) {
        try {
          const aoi = typeof project.aoiBounds === "string" ? JSON.parse(project.aoiBounds) : project.aoiBounds;
          const candidates = aoi?.type === "FeatureCollection" ? aoi.features.map((feature:Row) => feature.geometry)
            : [aoi?.type === "Feature" ? aoi.geometry : aoi];
          geometries.push(...candidates);
        } catch { /* An invalid AOI contributes no geometry. */ }
      }
      for (const drawing of state.geometries ?? []) {
        if (drawing.projectId !== project.id) continue;
        try {
          const coordinates = checkedDrawing(drawing.type,drawing.coordinates);
          const lngLat = ([lat,lng]:number[]) => [lng,lat];
          if (drawing.type === "marker") geometries.push({type:"Point",coordinates:lngLat(coordinates as number[])});
          if (drawing.type === "polyline") geometries.push({type:"LineString",coordinates:(coordinates as number[][]).map(lngLat)});
          if (drawing.type === "polygon") geometries.push({type:"Polygon",coordinates:(coordinates as number[][][]).map(ring => ring.map(lngLat))});
        } catch { /* A malformed drawing contributes no geometry. */ }
      }
      // Bounding boxes reject distant candidates only. Membership requires topology against the AII.
      return geometries.some(geometry => {
        if (!geometry || !/^(Multi)?(Point|LineString|Polygon)$|^GeometryCollection$/.test(geometry.type)) return false;
        const box = bbox(geometry,{recompute:true});
        return valid(box) && overlaps(box) && aiiFeatures.some(area => intersects(area.geometry,geometry));
      });
    });
    if (projects.length > 500) throw Error("A seleção excede 500 projetos.");
    return {reference,projects,basis:"interseção com a geometria da AII"};
  }
  const extents = boundsFor(reference);
  if (!extents.length) throw Error("O projeto de referência ainda não tem um recorte geográfico válido.");
  const region = extents.reduce<PreviewBounds>((a,b) =>
    [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])],extents[0]);
  const projects = state.projects.filter(project => boundsFor(project).some(([w,s,e,n]) =>
    w <= region[2] && e >= region[0] && s <= region[3] && n >= region[1]));
  if (projects.length > 500) throw Error("O recorte excede o limite de 500 projetos exibidos. Selecione um recorte menor.");
  return {reference, projects, basis:"envolvente das feições e áreas cadastradas"};
}

export async function workflow(method: string, input: Row = {}, write = false, validateOnly = false) {
  if (method === "projectSelection.get" && !write) {
    return state.mapProjectIds ?? state.projects.filter(project =>
      state.files.some(file => file.projectId === project.id && file.vector)).slice(0,500).map(project => project.id);
  }
  if (method === "projectSelection.set" && write) {
    if (!Array.isArray(input.projectIds) || input.projectIds.length > 500 || !input.projectIds.every(Number.isSafeInteger))
      throw Error("Selecione até 500 projetos.");
    const mapProjectIds = [...new Set<number>(input.projectIds)].filter(id => state.projects.some(project => project.id === id));
    save({...state,mapProjectIds});
    return {success:true,count:mapProjectIds.length};
  }
  if (method === "previewIphan.identify" && !write) {
    if (input.projectId !== 0 && !state.projects.some(project => project.id === input.projectId)) throw Error("Projeto indisponível.");
    const box = input.box;
    if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite) ||
        box[0] < -180 || box[2] > 180 || box[1] < -90 || box[3] > 90 ||
        box[2] <= box[0] || box[3] <= box[1] || box[2]-box[0] > .15 || box[3]-box[1] > .15)
      throw Error("Aproxime o mapa para identificar um sítio.");
    return (await iphanRecords({bbox:box.join(",")})).map(row => iphanPopupFields(row));
  }
  if (method === "previewConnections.list" && !write) return listConnections();
  if (method === "previewConnections.save" && write) {
    const { id, type } = input;
    const official = officialConnections.find(connection => connection.id === id);
    if (official) {
      // Only visibility is configurable for the published official sources.
      if (!official.layer) throw Error("Fonte disponível para consulta.");
      const allowed = official.layer === "ibge" ? ["estados", "municipios", "localidades"] : official.layer.split(",");
      const selectedLayers = Array.isArray(input.selectedLayers)
        ? official.type === "WMS" || official.type === "ArcGIS REST"
          ? validRemoteSelection(input.selectedLayers, official.type)
          : allowed.filter(layer => input.selectedLayers.includes(layer))
        : (state.connections ?? []).find(item => item.id === id)?.selectedLayers;
      const connection = { ...official, enabled: Boolean(input.enabled), selectedLayers };
      save({ ...state, connections: [...(state.connections ?? []).filter(item => item.id !== id), connection] });
      return connection;
    }
    const name = String(input.name ?? "").trim(), address = String(input.address ?? "").trim();
    if (!name || name.length > 100 || !address || address.length > 500 ||
        !["WMS", "WFS", "ArcGIS REST", "GeoJSON", "PostGIS"].includes(type)) throw Error("Confira o nome, o tipo e o endereço da fonte.");
    // Registration is metadata only. Do not contact submitted endpoints or store credentials.
    if (type === "PostGIS") {
      if (!/^[a-z\d.-]+(?::\d{1,5})?\/[a-z\d_-]+$/i.test(address)) throw Error("Informe servidor[:porta]/banco, sem credenciais.");
    } else {
      let endpoint: URL;
      try { endpoint = new URL(address); } catch { throw Error("Informe um endereço HTTP ou HTTPS."); }
      if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password ||
          endpoint.search || endpoint.hash) throw Error("Use o endereço base, sem credenciais, parâmetros ou fragmento.");
    }
    const connections = state.connections ?? [];
    if (id != null && !connections.some(item => item.id === id)) throw Error("Fonte não encontrada.");
    const layer = type === "WMS" ? String(input.layer ?? "").trim() : "";
    if (layer && !/^[\w.:-]{1,150}$/.test(layer)) throw Error("Informe o identificador da camada WMS.");
    const selectedLayers = type === "WMS" && Array.isArray(input.selectedLayers)
      ? validRemoteSelection(input.selectedLayers, type) : undefined;
    const enabled = Boolean(input.enabled);
    if (enabled && (type !== "WMS" || !layer)) throw Error("Para exibir no mapa, informe a camada de uma fonte WMS.");
    const connection = { id: id ?? state.nextId, name, type, address, layer, enabled,
      selectedLayers, status: enabled ? "Ligada no mapa" : "Desligada" };
    if (validateOnly) return connection;
    save({ ...state, nextId: id == null ? state.nextId+1 : state.nextId,
      connections: [...connections.filter(item => item.id !== id), connection] });
    return connection;
  }
  if (method === "previewProducts.brand") {
    if (input.projectId !== 11 || !state.projects.some(project => project.id === 11)) throw Error("Projeto indisponível.");
    const brands = state.studioBrands ?? [];
    if (!write) return brands.find(brand => brand.id === input.id);
    const name = typeof input.name === "string" ? input.name.trim().slice(0,80) : "";
    const { kind, image } = input;
    if (!name || !["empresa","cliente"].includes(kind) || typeof image !== "string" || image.length > 300000 ||
      !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(image)) throw Error("Informe um nome e uma imagem válida.");
    const bytes = Buffer.from(image.split(",")[1],"base64");
    const { PNG } = createRequire(require.resolve("qrcode"))("pngjs");
    if (bytes.length < 24 || bytes.readUInt32BE(16) > 480 || bytes.readUInt32BE(20) > 240) throw Error("Imagem fora do tamanho permitido.");
    const { width,height } = PNG.sync.read(bytes);
    const brand = { id:state.nextId, name, kind, image, width,height };
    save({ ...state, studioBrands:[...brands,brand], nextId:state.nextId+1 });
    return { id:brand.id,name,kind };
  }
  if (method === "previewProducts.list" || method === "previewProducts.save") {
    if (input.projectId !== 11 || !state.projects.some(project => project.id === input.projectId)) throw Error("Projeto indisponível.");
    // Na LT Angicos, 14 é ADA e 15 é o eixo de referência do atlas.
    const defaults = [
      { id: "mapa", title: "Mapa de localização", columns: 1, rows: 1, overlap: 0, grid: 25000 },
      { id: "influencia", title: "Áreas de influência — ADA, AID e AII", columns: 1, rows: 1, overlap: 0, grid: 25000, layerIds: [12, 13, 14, 15] },
      { id: "detalhe", title: "Detalhe de trecho da LT", columns: 1, rows: 1, overlap: 0, grid: 2000, scale: 25000, layerIds: [13, 14, 15] },
      { id: "prospeccao", title: "Planejamento da prospecção", columns: 1, rows: 1, overlap: 0, grid: 10000, layerIds: [13, 15, 17] },
      { id: "uso-solo", title: "Uso e cobertura do solo — MapBiomas 2024", columns: 1, rows: 1, overlap: 0, grid: 25000, layerIds: [-21, 15] },
      { id:"relevo", title:"Relevo e hipsometria", columns:1, rows:1, overlap:0, grid:10000, layerIds:[-22,15] },
      { id:"topografia", title:"Topografia", columns:1, rows:1, overlap:0, grid:10000, layerIds:[-23,15] },
      ...["sitio","pocos","comparativo"].map(id => ({ id, title:studioModels.find(model => model.id === id)!.title, columns:1, rows:1, overlap:0, grid:1000, layerIds:[] })),
      { id: "corredor", title: "Atlas por corredor", columns: 1, rows: 1, overlap: 15, grid: 500, scale: linearAtlasScale, layerIds: [14, 15] },
      { id: "atlas", title: "Atlas", columns: 3, rows: 2, overlap: 10, grid: 10000, layerIds: [14, 15] },
    ];
    const products = defaults.map(model => ({ ...model, ...state.products?.[11]?.find(item => item.id === model.id) }));
    const layers = state.files.filter(file => file.projectId === 11 && file.vector);
    const mapBiomas = { id: -21, name: "MapBiomas Brasil · 2024" };
    if (!write && method === "previewProducts.list") return {
      linearAtlasScale,
      models:studioModels,
      brands:(state.studioBrands ?? []).map(({id,name,kind}) => ({id,name,kind})),
      products: products.map(product => ({ layerIds: layers.filter(file => file.isVisible !== false).map(file => file.id), ...product, paper: readPaper(product.paper ?? defaultStudioPaper), orientation: readOrientation(product.orientation), layout: product.paper ? readLayout(product.layout, readOrientation(product.orientation)) : restoreLegend(readLayout(product.layout)), view: readStudioView(product.view) })),
      layers: [...layers.map(({ id, name, vector, defaultStyle, analysisKind }) => ({ id, name, area:vector.features.some((feature:Row) => /Polygon$/.test(feature.geometry.type)), line:vector.features.some((feature:Row) => /LineString$/.test(feature.geometry.type)), point:vector.features.some((feature:Row) => /Point$/.test(feature.geometry.type)), iphanInfluence:analysisKind === "iphan-influence", color:defaultStyle?.color })), mapBiomas, ...studioTerrain],
    };
    if (!write || method !== "previewProducts.save") return undefined;
    const { id, title, columns, rows, overlap, grid } = input.product ?? {};
    if (!products.some(product => product.id === id) || typeof title !== "string" || !title.trim() || title.length > 85 ||
        ![columns, rows].every(n => Number.isInteger(n) && n >= 1 && n <= 8) || columns*rows > 24 ||
        !Number.isFinite(overlap) || overlap < 0 || overlap > 30 ||
        !Number.isInteger(grid) || grid < (id === "corredor" ? 100 : 1000) || grid > 50000) throw Error("Confira o título e os parâmetros da grade.");
    const { layerIds } = input.product;
    if (!Array.isArray(layerIds) || !layerIds.length || !layerIds.every(layerId => (id === "uso-solo" && layerId === mapBiomas.id) || (id === "relevo" && layerId === -22) || (id === "topografia" && layerId === -23) || layers.some(layer => layer.id === layerId))) throw Error("Selecione pelo menos uma camada do projeto.");
    if (id === "corredor" && !layerIds.includes(15)) throw Error("O atlas por corredor precisa do eixo da LT.");
    if (id === "uso-solo" && (!layerIds.includes(-21) || !layerIds.includes(15))) throw Error("O mapa de uso do solo precisa do MapBiomas e do eixo.");
    const missing = studioLayerRequirements(id,layers.filter(layer => layerIds.includes(layer.id)).map(layer => ({name:layer.name,layerData:layer.vector})));
    if (missing) throw Error(missing);
    if ((id === "relevo" && !layerIds.includes(-22)) || (id === "topografia" && !layerIds.includes(-23))) throw Error("Selecione a base temática do modelo.");
    const view = readStudioView(input.product.view);
    if (Object.values(view.insets).some(inset => inset.layers?.some(id => !layers.some(layer => layer.id === id)))) throw Error("Use camadas do projeto nos mapas de situação.");
    const locks = Array.isArray(input.product.locks) ? ["principal", "legenda", "norte", "brasil", "regional"].filter(key => input.product.locks.includes(key)) : [];
    const orientation = readOrientation(input.product.orientation);
    const marks = { empresa:input.product.marks?.empresa ?? 0, cliente:input.product.marks?.cliente ?? 0 };
    for (const [kind,brandId] of Object.entries(marks)) if (brandId !== 0 && !(state.studioBrands ?? []).some(brand => brand.id === brandId && brand.kind === kind)) throw Error("Marca indisponível para esta posição.");
    const product = { id, marks, orientation, title: title.trim(), columns, rows, overlap, grid, view, locks, paper: readPaper(input.product.paper ?? defaultStudioPaper),
      layerIds: [...new Set(layerIds)], layout: readLayout(input.product.layout, orientation), scale: readScale(input.product.scale) ?? (id === "corredor" ? linearAtlasScale : undefined) };
    save({ ...state, products: { ...state.products, 11: products.map(item => item.id === id ? product : item) } });
    return product;
  }
  if (!write) {
    switch (method) {
      case "projects.list": {
        const recent = state.recentProjects?.["1"] ?? [];
        const rank = (id: number) => recent.includes(id) ? recent.indexOf(id) : recent.length;
        return [...state.projects].sort((a, b) => rank(a.id) - rank(b.id));
      }
      case "projects.get": {
        const project = state.projects.find(project => project.id === input.id);
        // The local preview has one simulated user. Production should use the authenticated ID.
        const recent = state.recentProjects?.["1"] ?? [];
        if (project && recent[0] !== project.id) save({
          ...state, recentProjects: { ...state.recentProjects, "1": [project.id, ...recent.filter(id => id !== project.id)].slice(0, 100) },
        });
        return project ?? null;
      }
      case "layers.list": return projectRows(state.files, input).filter(file => file.vector).map(file => ({
        id: file.id, projectId: file.projectId, name: file.name, layerType: "vector",
        layerData: annotateIphanVector(file), isGroup: false, isVisible: file.isVisible ?? true, effectiveVisible: file.isVisible ?? true,
        defaultStyle: { color: ({ "AII.geojson": "#217a4b", "AID.geojson": "#da9800", "ADA.geojson": "#dc2638", "Eixo.geojson": "#58278d" } as Record<string, string>)[file.name] || "#2563eb" },
      }));
      case "files.list":
      case "files.listAll": return projectRows(state.files, input).map(({ contents, vector, ...file }) => ({
        ...file,
        exportFormats: vector ? ["shp", "kml", "geojson", ...(vector.features.every((feature: Row) => /^(Multi)?(Point|LineString)$/.test(feature.geometry.type)) ? ["gpx"] : [])] : [],
      }));
      case "geometries.listForProjects":
        return (state.geometries ?? []).filter(row => input.projectIds?.includes(row.projectId) && row.visible === 1)
          .map(row => ({...row,effectiveVisible:true}));
      case "geometries.list": return projectRows(state.geometries ?? [], input);
      case "gisAnalysis.list": return projectRows(state.files, input).filter(file => file.vector).map(file => ({
        id: file.id, name: file.name, projectId: file.projectId, layerType: "vector", layerData: annotateIphanVector(file), metadata: { kind: "vector", featureCount: file.vector.features.length },
        isVisible: file.isVisible ?? true,
        ...(file.projectId === 11 && file.name === "AII.geojson" ? {
          layerData: { ...file.vector, features: file.vector.features.map((feature: Row) => ({
            ...feature, properties: { ...feature.properties, rotulo_ibge: municipalAnchors[feature.properties.codigo_ibge] },
          })) },
        } : {}),
        defaultStyle: file.defaultStyle ?? {
          color: ({ "AII.geojson": "#217a4b", "AID.geojson": "#da9800", "ADA.geojson": "#dc2638", "Eixo.geojson": "#58278d" } as Record<string, string>)[file.name] || "#2563eb",
          fillOpacity: 0.18,
        },
      }));
      case "printJobs.list": return projectRows(state.jobs, input).filter(job => job.kind === "map");
      case "atlas.list": return projectRows(state.jobs, input).filter(job => job.kind === "atlas");
      case "atlas.templates.list": return projectRows(state.templates, input);
      case "raster.ingestionAvailability": return { available: true, mode: "local", reason: "GDAL local do QGIS." };
      case "raster.listForMap": return projectRows(state.files, input).filter(file => file.cog).map(file => ({
        id: file.id, name: file.name, bounds: file.cog.bounds, crs: "EPSG:4674", nodata: 0, isVisible: false,
        metadata: { rasterIngestion: { status: "completed", cogSha256: file.cog.sha256 } },
      }));
    }
    return undefined;
  }
  switch (method) {
    case "geometries.create": {
      if (!state.projects.some(project => project.id === input.projectId)) throw Error("Projeto inexistente.");
      const coordinates = checkedDrawing(input.type,input.coordinates);
      if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 120) throw Error("Informe um nome de até 120 caracteres.");
      return append("geometries",{ projectId:input.projectId, name:input.name.trim(), type:input.type,
        description:typeof input.description === "string" ? input.description.slice(0,1000) : null,
        coordinates:JSON.stringify(coordinates), color:"#2563eb", opacity:100, visible:1 });
    }
    case "geometries.update":
    case "geometries.updateVisibility":
    case "geometries.delete": {
      const rows = state.geometries ?? [];
      const row = rows.find(item => item.id === input.id);
      if (!row) throw Error("Feição não encontrada.");
      if (method === "geometries.delete") {
        save({...state,geometries:rows.filter(item => item.id !== row.id)});
        return {success:true};
      }
      const updated = method === "geometries.updateVisibility"
        ? {...row,visible:input.visible ? 1 : 0}
        : {...row,coordinates:JSON.stringify(checkedDrawing(row.type,input.coordinates))};
      save({...state,geometries:rows.map(item => item.id === row.id ? updated : item)});
      return updated;
    }
    case "atena.previewPlan":
    case "atena.previewRun": {
      const text = String(input.text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const request = String(input.text ?? "").trim();
      if (/\b(cruzar|cruze|cruzamento|intersectar|intersecte)\b/.test(text) && /\biphan\b/.test(text) && /\b(ada|aid|aii)\b/.test(text)) {
        if (!state.projects.some(project => project.id === input.projectId)) throw Error("Abra o projeto para cruzar as áreas.");
        const areas = iphanInfluenceLayers(input.projectId);
        // Resolve the atlas settings before saving any crossing results.
        const atlas = /\batlas\b/.test(text) ? prepareCorridorAtlas(input.projectId,text) : undefined;
        const summary = "Cruzar pontos e polígonos do SICG com ADA, AID e AII, mostrar as camadas no mapa e guardar os sítios no acervo.";
        if (method === "atena.previewPlan") return {
          summary:summary + (atlas ? " Em seguida, abrir o atlas da ADA em "+atlas.description+" no Estúdio." : ""),
        };
        const result = await crossIphanInfluence(input.projectId,areas);
        return atlas ? {...result,studioUrl:atlas.studioUrl} : result;
      }
      if (/\b(selecione|selecionar|mostre|mostrar|exiba|exibir)\b/.test(text) && /\bprojetos\b/.test(text) &&
          /\b(regiao|entorno|vizinhos|proximos|aii)\b/.test(text)) {
        const normalize = (value:string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
          .toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
        const query = " "+normalize(request)+" ";
        const named = state.projects.filter(project => {
          const name = normalize(project.name);
          const code = normalize(project.code ?? "");
          const short = name.split(" ").slice(0,2).join(" ");
          return query.includes(" "+name+" ") || (code && query.includes(" "+code+" ")) ||
            (short.startsWith("lt ") && query.includes(" "+short+" "));
        });
        if (named.length > 1) throw Error("Há mais de um projeto de referência. Informe o código do projeto.");
        const {reference,projects,basis} = regionalProjectSelection(named[0]?.id ?? input.projectId,/\baii\b/.test(text));
        const names = projects.map(project => project.name).join(", ");
        const message = `${projects.length} projeto(s) no recorte de ${reference.name}, por ${basis}: ${names}.`;
        if (method === "atena.previewPlan") return {summary:message};
        const ids = projects.map(project => project.id);
        await workflow("projectSelection.set",{projectIds:ids},true);
        return {mapSelection:true,ids,referenceId:reference.id,message};
      }
      const iphan = request.match(/^(guardar|consultar|conferir tipologia d[eo]|qual a tipologia d[eo])\s+s[ií]tio(?:\s+do)?\s+IPHAN\s+([\p{L}\d._/-]{1,100})[!?]?$/iu);
      if (iphan) {
        const [,verb,key] = iphan;
        const records = state.iphanKnowledge ?? [];
        if (input.projectId !== 0 && !state.projects.some(project => project.id === input.projectId)) throw Error("Projeto indisponível.");
        const sources = records.filter(row => String(row.id) === key || row.codigo.toLowerCase() === key.toLowerCase());
        const previous = sources.at(-1);
        if (verb.toLowerCase().startsWith("conferir")) {
          if (!previous) throw Error("Guarde o sítio no acervo antes de conferir sua ficha.");
          if (method === "atena.previewPlan") return {summary:"Conferir o detalhe oficial de “"+previous.nome+"” no SICG."};
          const check = await officialSiteTypology(previous.id,previous.codigo);
          const current = (state.iphanKnowledge ?? []).findLast(row => row.id === previous.id) ?? previous;
          save({...state,iphanKnowledge:[...(state.iphanKnowledge ?? []),{...current,
            tipologia:check.value ?? current.tipologia ?? null, verificacaoTipologia:check,
            descricaoTipologicaSicg:check.descricaoTipologica ?? current.descricaoTipologicaSicg,
            fonteDescricaoTipologica:check.descricaoTipologica ? check.url : current.fonteDescricaoTipologica,
            fonteTipologia:check.value ? check.url : current.fonteTipologia,
          }]});
          return {knowledgeMessage:`${previous.nome} · ${check.value ?? check.descricaoTipologica ?? "tipologia pendente"}. Fonte: ${check.url}`};
        }
        if (verb.toLowerCase() !== "guardar") {
          const numericId = /^\d+$/.test(key) && Number.isSafeInteger(Number(key)) ? Number(key) : 0;
          const matches = previous ? [previous] : await iphanRecords(numericId ? {id:numericId} : {code:key});
          if (matches.length !== 1) throw Error("Informe um código IPHAN que identifique um único sítio.");
          const record = matches[0] as Row;
          const date = record.consultadoEm ?? new Date().toISOString();
          if (method === "atena.previewPlan") return {summary:`Consultar “${record.nome}” ${previous ? "no acervo IPHAN da prévia" : "no GeoServer oficial e guardar o registro no acervo"}.`};
          if (!previous) saveIphanKnowledge(record,input.projectId,date);
          const message = `${record.nome} · ${record.codigo || "sem código"} · ${record.classificacao || "sem classificação"}. ${record.sintese || "Sem síntese publicada"}. Tipologia oficial: ${record.tipologia ?? "pendente de conferência na ficha SICG"}.${record.descricaoTipologicaSicg ? " Descrição no SICG: "+record.descricaoTipologicaSicg+". Fonte: "+(record.fonteDescricaoTipologica ?? record.verificacaoTipologia?.url)+"." : ""} Fonte: ${record.camada}, consultada em ${date.slice(0,10)}.`;
          return {knowledgeMessage:message};
        }
        const id = Number(key);
        if (!/^\d+$/.test(key) || !Number.isSafeInteger(id) || id < 1) throw Error("Use Guardar com a Atena na janela do sítio para identificá-lo no SICG.");
        const [record] = await iphanRecords({id});
        if (!record) throw Error("O IPHAN não retornou o sítio selecionado.");
        if (method === "atena.previewPlan") return {summary:`Guardar “${record.nome}” no acervo IPHAN da prévia, com atributos do GeoServer. A tipologia fica pendente de conferência na ficha oficial.`};
        saveIphanKnowledge(record,input.projectId,new Date().toISOString());
        return {knowledgeMessage:`Sítio “${record.nome}” guardado no acervo IPHAN da prévia. Para recuperar, peça: Consultar sítio IPHAN ${record.codigo || record.id}.`};
      }
      if (!state.projects.some(project => project.id === input.projectId)) throw Error("Abra um projeto para executar o comando.");
      const influence = request.match(/^(?:criar|gere|gerar|crie)\s+(?:a\s+)?(ADA|AID|AII)(?:\s+(?:a partir d[eo]|d[eo]|n[eo])\s+"?([^"!.]+)(?:\.geojson)?"?)?[.!]?$/i);
      if (influence) {
        const kind = influence[1].toUpperCase();
        const source = influence[2]?.trim() ?? "Eixo";
        const vector = influenceGeometry(input.projectId,{kind,source});
        const purpose = kind === "AII"
          ? `selecionar ${vector.features.length} municípios da malha IBGE 2024 da prévia que interceptam a AID de 250 m`
          : `criar faixa de ${kind === "ADA" ? 30 : 250} m de cada lado do eixo`;
        if (method === "atena.previewPlan") return {summary:`${kind}: ${purpose}, usando “${source}”. Uma nova camada será salva no projeto.`};
        const base = `${kind} · ${source}`;
        let name = base, version = 2;
        while (state.files.some(row => row.projectId === input.projectId && row.name === name+".geojson")) name = `${base} (${version++})`;
        return saveAnalysis(input.projectId,name+".geojson",vector);
      }
      const drawing = request.match(/^(?:criar|crie)\s+(ponto|linha|pol[ií]gono)\s+"([^"]{1,120})"\s+com coordenadas\s+(\[[\s\S]+\])[.!]?$/i);
      if (drawing) {
        const [,shape,name,raw] = drawing;
        const type = shape.toLowerCase() === "ponto" ? "marker" : shape.toLowerCase() === "linha" ? "polyline" : "polygon";
        const points = JSON.parse(raw);
        const swap = (point:unknown) => Array.isArray(point) && point.length === 2 ? [point[1],point[0]] : null;
        const coordinates = checkedDrawing(type,type === "marker" ? swap(points) : Array.isArray(points) ? points.map(swap) : null);
        if (method === "atena.previewPlan") return {summary:`Criar ${shape.toLowerCase()} “${name}” no mapa com as coordenadas informadas.`};
        await workflow("geometries.create",{ projectId:input.projectId, name, type, coordinates },true);
        return { drawingSaved:true, message:`Feição “${name}” salva no mapa do projeto.` };
      }
      if (/^(?:criar|crie)\s+(ponto|linha|poligono)\b/.test(text))
        throw Error('Informe a feição, o nome entre aspas e as coordenadas [longitude, latitude]. Exemplo: criar ponto "Amostra" com coordenadas [-37.3,-5.2].');
      const siteLocationAtlas = /\batlas\b/.test(text) && /\blocalizacao\b/.test(text) &&
        /\bsitios?\b/.test(text) && /\b(influencia|ada|aid|aii)\b/.test(text);
      if (siteLocationAtlas) {
        if (input.projectId !== 11) throw Error("O atlas de localização dos sítios está disponível na prévia da LT Angicos.");
        iphanInfluenceLayers(input.projectId);
        const results = state.files.filter(row => row.projectId === input.projectId && row.analysisKind === "iphan-influence" && row.vector);
        if (!results.length) throw Error("Execute primeiro o cruzamento dos sítios IPHAN com a ADA, AID e AII.");
        const paper = text.match(/\ba[0-4]\b/)?.[0].toUpperCase() ?? defaultStudioPaper;
        const orientation = /\b(retrato|vertical)\b/.test(text) ? "portrait" : "landscape";
        if (method === "atena.previewPlan") return {
          summary:"Montar o atlas de localização dos sítios IPHAN nas áreas ADA, AID e AII, em "+paper+
            (orientation === "portrait" ? " retrato" : " paisagem")+", com grade e escala automática para cobrir o recorte.",
        };
        const query = new URLSearchParams({modelo:"atlas",papel:paper,orientacao:orientation,foco:"sitios-influencia"});
        return {studioUrl:"/projects/11?tab=products&"+query,message:"Atlas de localização dos sítios preparado para revisão."};
      }
      // Pedidos livres de atlas usam o corredor da ADA. A grade explícita continua no fluxo próprio.
      const atlasCorridor = /\b(montar modelo corredor|atlas por corredor)\b/.test(text) ||
        (/\batlas\b/.test(text) && !/^montar modelo /.test(text) && !/\b\d+\s*[x×]\s*\d+\b/.test(text));
      if (input.projectId === 11 && atlasCorridor && !(text.startsWith("montar modelo ") && /\scom .+ e .+/.test(text))) {
        const atlas = prepareCorridorAtlas(input.projectId,text);
        if (method === "atena.previewPlan") return {
          summary:`Atlas por corredor com foco na ADA e eixo como referência, em ${atlas.description}. Abrir para revisão no Estúdio.`,
        };
        return {studioUrl:atlas.studioUrl,message:"Atlas da ADA preparado para revisão."};
      }
      if (input.projectId === 11 && text.startsWith("montar modelo ")) {
        const command = text.match(/^montar modelo (.+?)(?: em (a[0-4]) (paisagem|horizontal|retrato|vertical))?(?: com (.+?) e (.+?))?[.!]?$/);
        if (!command) throw Error("Informe o modelo e, se desejar, o papel, a orientação e as duas marcas.");
        const [, name, paper, direction, company, client] = command;
        const normalize = (value:string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
        const model = studioModels.find(item => item.id === name || normalize(item.title) === name);
        if (!model) throw Error("Informe o nome ou identificador de um modelo da biblioteca.");
        const { products } = await workflow("previewProducts.list", {projectId:11});
        const product = products.find((item:Row) => item.id === model.id);
        if (paper && company && client) {
          const brandId = (kind:string, label:string) => {
            const matches = (state.studioBrands ?? []).filter(item => item.kind === kind && normalize(item.name) === label);
            if (matches.length !== 1) throw Error("Escolha uma marca cadastrada e inequívoca: "+label+".");
            return matches[0].id;
          };
          const marks = {empresa:brandId("empresa",company),cliente:brandId("cliente",client)};
          const orientation = direction === "retrato" || direction === "vertical" ? "portrait" : "landscape";
          if (!product.layerIds.length) throw Error("Indique no Estúdio as camadas necessárias: "+model.needs+".");
          if (method === "atena.previewPlan") return {summary:`Preparar ${model.title} em ${paper.toUpperCase()} ${direction}, com ${company} e ${client}, para revisão no Estúdio.`};
          const query = new URLSearchParams({modelo:model.id,papel:paper.toUpperCase(),orientacao:orientation,empresa:String(marks.empresa),cliente:String(marks.cliente)});
          return {studioUrl:"/projects/11?tab=products&"+query, message:"Prancha preparada para revisão."};
        }
        if (paper || company || client) throw Error("Informe papel, orientação, empresa e cliente no mesmo pedido.");
        if (method === "atena.previewPlan") return { summary: model.title + ". Dados necessários: " + model.needs + ". Abrir para revisão no Estúdio." };
        return { studioUrl:"/projects/11?tab=products&modelo="+model.id, message:product.layerIds.length ? "Modelo pronto para revisar no Estúdio." : "Indique no Estúdio as camadas necessárias: "+model.needs+"." };
      }
      const addSource = request.match(/^cadastrar fonte wms "([^"]+)" (https?:\/\/\S+) camada ([\w.:-]+)$/i);
      if (addSource) {
        const [, name, address, layer] = addSource;
        const entry = { name, address, layer, type: "WMS", enabled: false };
        if (listConnections().some(item => item.address === address && item.layer === layer)) throw Error("Esta fonte já está cadastrada.");
        const planning = method === "atena.previewPlan";
        await workflow("previewConnections.save", entry, true, planning);
        if (planning) return { summary: `Cadastrar ${name} (${layer}) em ${address}, com a visualização desligada.` };
        return { message: `${name} cadastrada em Gestão e Conexões.`, connectionChanged: true };
      }
      const toggledSource = text.match(/^(ligar|desligar) fonte (iphan|ibge|funai|incra|palmares|aneel)[.!]?$/);
      if (toggledSource) {
        const source = listConnections().find(item => item.official && item.name.toLowerCase().startsWith(toggledSource[2]));
        if (!source?.layer) throw Error("Fonte cartográfica indisponível.");
        const enabled = toggledSource[1] === "ligar";
        const summary = `${enabled ? "Ligar" : "Desligar"} ${source.name} nos mapas da prévia.`;
        if (method === "atena.previewPlan") return { summary };
        await workflow("previewConnections.save", { ...source, enabled }, true);
        return { message: `${source.name} ${enabled ? "ligada" : "desligada"} nos mapas da prévia.`, connectionChanged: true };
      }
      const copyLayer = request.match(/^criar camada "([^"]{1,100})" a partir de "([^"]{1,150})"[.!]?$/i);
      if (copyLayer) {
        const [, requestedName, origin] = copyLayer;
        const baseName = requestedName.trim().replace(/\.geojson$/i, "").trim();
        if (!baseName || /[<>:"/\\|?*\x00-\x1f]/.test(baseName)) throw Error("Informe um nome válido para a camada.");
        const name = baseName + ".geojson";
        const files = state.files.filter(file => file.projectId === input.projectId);
        const matches = files.filter(file => file.vector && String(file.name).toLowerCase() === origin.trim().toLowerCase());
        if (matches.length !== 1) throw Error("Informe o nome completo de uma única camada vetorial deste projeto.");
        if (files.some(file => String(file.name).toLowerCase() === name.toLowerCase())) throw Error("Já existe uma camada ou arquivo com esse nome.");
        if (method === "atena.previewPlan") return { summary: `Criar ${name} como cópia de ${matches[0].name} neste projeto.` };
        return saveAnalysis(input.projectId, name, matches[0].vector);
      }
      const wantsShape = /\b(shapefile|shape file|shp)\b/.test(text) && /\bmalha\b/.test(text);
      const wantsA2 = /\ba2\b/.test(text) && /\b(mapa|prancha|pdf)\b/.test(text);
      // The chat resolves only known local operations. It passes project IDs and
      // validated parameters to the same exporters used by the map workspace.
      if (/\batlas\b/.test(text)) {
        if (input.projectId !== 11) throw Error("O atlas A2 está disponível na prévia da LT Angicos.");
        const size = text.match(/(\d+)\s*[x×]\s*(\d+)/);
        const columns = Number(size?.[1] ?? 3), rows = Number(size?.[2] ?? 2);
        const overlap = Number(text.match(/(\d+)\s*%/)?.[1] ?? 10);
        const interval = text.match(/grade(?: utm)?(?: de)?\s+(\d+)\s*(km|m)\b/);
        const grid = Number(interval?.[1] ?? 10) * (interval?.[2] === "m" ? 1 : 1000);
        if (columns < 1 || rows < 1 || columns > 8 || rows > 8 || columns*rows > 24 ||
            overlap > 30 || grid < 1000 || grid > 50000) throw Error("Use até 24 folhas, sobreposição de 0 a 30% e grade UTM entre 1 e 50 km.");
        const ids = [14, 15].filter(id => state.files.some(row => row.id === id && row.projectId === input.projectId && row.vector));
        if (!ids.includes(14)) throw Error("Adicione a camada ADA ao projeto para gerar o atlas.");
        return method === "atena.previewPlan" ? { summary: `Atlas A2 com foco na ADA: ${columns} colunas × ${rows} linhas, ${overlap}% de sobreposição, grade UTM de ${grid/1000} km.` } :
          { name: "Baixar atlas A2 em PDF", url: `/previa/prancha/11.pdf?camadas=${ids.join(",")}&atlas=${columns},${rows},${overlap},${grid}` };
      }
      if (wantsShape && wantsA2) throw Error("Peça um arquivo por vez.");
      if (wantsShape) {
        const grids = state.files.filter(row => row.projectId === input.projectId && /^Malha /.test(row.name) && row.vector);
        const distances = [...text.matchAll(/(\d+)\s*m\b/g)];
        const candidates = grids.filter(row => (!distances.length || row.name.includes(` ${distances[0][1]} m.`)) &&
          (!/\btriangular\b/.test(text) || row.name.includes("triangular")) &&
          (!/\bquadrada\b/.test(text) || row.name.includes("quadrada")));
        if (candidates.length !== 1) throw Error("Informe qual malha exportar. Use o formato e o espaçamento da camada.");
        const layer = candidates[0];
        return method === "atena.previewPlan" ? { summary: `Exportar ${layer.name} em Shapefile (.zip).` } :
          { name: "Baixar Shapefile da malha", url: `/previa/vetores/${input.projectId}/${layer.id}/shp` };
      }
      if (wantsA2) {
        if (input.projectId !== 11) throw Error("O modelo A2 de localização está disponível na prévia da LT Angicos.");
        const ids = state.files.filter(row => row.projectId === input.projectId && row.vector && row.isVisible !== false).map(row => row.id);
        if (!ids.length) throw Error("Ative ao menos uma camada do projeto.");
        return method === "atena.previewPlan" ? { summary: `Gerar o mapa de localização A2 com ${ids.length} camadas visíveis.` } :
          { name: "Baixar mapa A2 em PDF", url: `/previa/prancha/11.pdf?camadas=${ids.join(",")}` };
      }
      const operation = /\bbuffer\b/.test(text) ? "buffer" : /\bmalha\b/.test(text) ? "grid" : null;
      const distances = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(km|m(?:etros?)?)\b/g)];
      const layerKey = operation === "buffer" && /\beixo\b/.test(text) ? "Eixo" :
        operation === "grid" && /\bada\b/.test(text) ? "ADA" : null;
      if (!operation || !layerKey || distances.length !== 1 || (/\bbuffer\b/.test(text) && /\bmalha\b/.test(text))) {
        throw Error("Informe uma operação por vez, a camada e a distância. Exemplos: buffer de 120 m no eixo ou malha triangular de 250 m na ADA.");
      }
      const [, amount, unit] = distances[0];
      const metres = Number(amount.replace(",", ".")) * (unit === "km" ? 1000 : 1);
      if (metres < (operation === "grid" ? 10 : 1) || metres > 10000) throw Error("Distância fora do intervalo permitido.");
      const layer = state.files.find(row => row.projectId === input.projectId && row.name === layerKey + ".geojson" && row.vector);
      if (!layer) throw Error("Camada não encontrada neste projeto.");
      const pattern = /\btriangular\b/.test(text) ? "triangular" : "quadrada";
      if (input.operation !== undefined) throw Error("Use o pedido de texto para preparar a operação.");
      if (method === "atena.previewPlan") return { summary: operation === "buffer"
        ? `Criar buffer de ${metres} m em ${layer.name}.`
        : `Criar malha ${pattern} de ${metres} m dentro de ${layer.name}.` };
      return workflow("gisAnalysis.execute", { projectId: input.projectId, operation, inputs: layer.vector.features,
        bufferMeters: metres, grid: { spacingMeters: metres, pattern, originCode: "ATENA" } }, true);
    }
    case "gisAnalysis.execute": {
      if (!["grid", "buffer"].includes(input.operation)) return undefined;
      if (!state.projects.some(project => project.id === input.projectId)) throw Error("Projeto inexistente.");
      if (input.operation === "buffer") {
        const metres = input.bufferMeters;
        if (!Number.isFinite(metres) || metres < 1 || metres > 100000 || !input.inputs?.length) throw Error("Informe feições e uma distância válida.");
        const output = bufferGeometry({ type: "FeatureCollection", features: input.inputs }, metres, { units: "meters" });
        if (!output?.features.length) throw Error("O buffer não produziu feições.");
        return saveAnalysis(input.projectId, `Buffer ${metres} m.geojson`, output);
      }
      const [area] = input.inputs ?? [];
      if (input.inputs?.length !== 1 || !["Polygon", "MultiPolygon"].includes(area?.geometry?.type)) throw Error("Selecione uma única feição poligonal.");
      const { spacingMeters: step, rotationDegrees = 0, pattern = "quadrada", originCode = "MALHA" } = input.grid ?? {};
      if (!Number.isFinite(step) || step < 10 || step > 10000 || !Number.isFinite(rotationDegrees) || Math.abs(rotationDegrees) > 180 || !["quadrada", "triangular"].includes(pattern)) throw Error("Confira o espaçamento, o formato e a rotação.");
      const vertices = paths(area.geometry).flat();
      const [lon, lat] = vertices[0];
      const zone = Math.min(60, Math.floor((lon + 180) / 6) + 1);
      const project = require("proj4")("EPSG:4326", `+proj=utm +zone=${zone}${lat < 0 ? " +south" : ""} +ellps=GRS80 +units=m`);
      const contains = require("@turf/boolean-point-in-polygon").default;
      const angle = rotationDegrees * Math.PI / 180;
      const rotate = ([x,y]: number[], a: number) => [x*Math.cos(a)-y*Math.sin(a), x*Math.sin(a)+y*Math.cos(a)];
      const bounds = vertices.map(p => rotate(project.forward(p.slice(0,2)), -angle));
      const xs = bounds.map(p => p[0]), ys = bounds.map(p => p[1]);
      const rowStep = pattern === "triangular" ? step * Math.sqrt(3)/2 : step;
      // Build the lattice in metric coordinates, then test each point against
      // the original polygon (including holes) before storing longitude/latitude.
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const firstRow = Math.ceil(Math.min(...ys)/rowStep), lastRow = Math.floor(Math.max(...ys)/rowStep);
      if ((lastRow - firstRow + 1) * (2 + (maxX-minX)/step) > 500000) throw Error("A área é grande para esse espaçamento. Aumente a distância ou selecione uma área menor.");
      const features = [];
      for (let row = firstRow; row <= lastRow; row++) {
        const offset = pattern === "triangular" && row % 2 !== 0 ? step/2 : 0;
        for (let x = Math.ceil((minX-offset)/step)*step+offset; x <= maxX; x += step) {
          const coordinates = project.inverse(rotate([x,row*rowStep],angle));
          if (!contains(coordinates, area)) continue;
          features.push({type:"Feature", geometry:{type:"Point", coordinates}, properties:{name:`${originCode}-${features.length+1}`, spacingMeters:step, rotationDegrees, pattern}});
          if (features.length > 5000) throw Error("A malha ultrapassa 5.000 pontos. Aumente o espaçamento.");
        }
      }
      if (!features.length) throw Error("Nenhum ponto caiu dentro da área.");
      const vector = {type:"FeatureCollection",features};
      return saveAnalysis(input.projectId, `Malha ${pattern} ${step} m.geojson`, vector);
    }
    case "layers.previewStyle": {
      const file = state.files.find(row => row.id === input.id && row.projectId === input.projectId && row.vector);
      if (!file || !/^#[0-9a-f]{6}$/i.test(input.color) ||
          !Number.isFinite(input.weight) || input.weight < 1 || input.weight > 8 ||
          !Number.isFinite(input.fillOpacity) || input.fillOpacity < 0 || input.fillOpacity > 1) {
        throw Error("Simbologia inválida.");
      }
      const defaultStyle = { color: input.color, weight: input.weight, fillOpacity: input.fillOpacity };
      save({ ...state, files: state.files.map(row => row.id === file.id ? { ...row, defaultStyle } : row) });
      return { success: true };
    }
    case "layers.setVisibility": {
      if (!state.files.some(file => file.id === input.id && file.vector)) return undefined;
      save({ ...state, files: state.files.map(file => file.id === input.id ? { ...file, isVisible: Boolean(input.visible) } : file) });
      return { success: true };
    }
    case "raster.ingestGeoTiff": {
      if (!state.projects.some(project => project.id === input.projectId)) throw Error("Projeto inexistente.");
      const contents = Buffer.from(input.fileData || "", "base64");
      const magic = contents.subarray(0, 4).toString("hex");
      if (contents.length !== input.size || contents.length > 8_000_000 || !["49492a00", "4d4d002a", "49492b00", "4d4d002b"].includes(magic)) throw Error("Envie um GeoTIFF válido de até 8 MB.");
      const cog = await ingestCog(contents, input.acquisitionAt, input.sourceLabel);
      const file = append("files", { projectId: input.projectId, name: input.filename, fileType: "geotiff", fileSize: contents.length, isGeospatial: true, currentVersion: 1,
        uploadedAt: new Date().toISOString(), s3Url: "/previa/raster/" + cog.key + "/raster.cog.tif", contents: contents.toString("base64"), cog });
      return { success: true, fileId: file.id, layerId: file.id, crs: "EPSG:4674", bounds: cog.bounds, cogSha256: cog.sha256, cogUrl: file.s3Url };
    }
    case "atlas.render": {
      const job = state.jobs.find(row => row.id === input.id && row.kind === "atlas");
      const file = state.files.find(row => row.id === input.rasterLayerId && row.projectId === job?.projectId && row.cog);
      if (!job || !file) throw Error("Selecione um COG do projeto deste atlas.");
      const result = await renderCog(file.cog, job, true);
      save({ ...state, jobs: state.jobs.map(row => row.id === job.id ? { ...row, status: "completed", outputUrl: result.outputUrl, gridConfig: { totalPages: result.totalPages } } : row) });
      return result;
    }
    case "projects.create": {
      if (!input.name?.trim() || !input.code?.trim()) throw Error("Informe nome e código do projeto.");
      if (state.projects.some(project => project.code.toLowerCase() === input.code.trim().toLowerCase())) throw Error("Código de projeto já cadastrado.");
      return append("projects", { ...input, code: input.code.trim(), status: input.status || "active" });
    }
    case "files.upload": {
      if (!state.projects.some(project => project.id === input.projectId)) throw Error("Projeto inexistente.");
      const contents = Buffer.from(input.fileData || "", "base64");
      if (!contents.length || contents.length > 8_000_000) throw Error("Selecione um arquivo de até 8 MB para a prévia.");
      const name = String(input.filename || "arquivo").split(/[\\/]/).pop()!;
      const fileType = name.split(".").pop()!.toLowerCase();
      const vector = await parseVector(contents, fileType);
      const url = "/previa/download/arquivo/" + state.nextId;
      const file = append("files", { projectId: input.projectId, name, fileType, fileSize: contents.length, mimeType: input.mimeType, isGeospatial: Boolean(vector), currentVersion: 1, uploadedAt: new Date().toISOString(), s3Url: url, vector, contents: contents.toString("base64") });
      return { id: file.id, url };
    }
    case "files.download": {
      const file = state.files.find(row => row.id === (input.id ?? input.fileId));
      if (!file) throw Error("Arquivo inexistente.");
      return { url: file.s3Url, filename: file.name };
    }
    case "files.delete":
      save({ ...state, files: state.files.filter(file => file.id !== (input.id ?? input.fileId)) });
      return { success: true };
    case "atlas.templates.create":
      return append("templates", input);
    case "printJobs.create":
    case "atlas.create": {
      if (!state.projects.some(project => project.id === input.projectId) || !input.name?.trim() || !input.title?.trim()) throw Error("Informe o projeto, o nome e o título.");
      const kind = method === "atlas.create" ? "atlas" : "map";
      const raster = projectRows(state.files, input).find(file => file.cog);
      if (raster) {
        const result = kind === "map" ? await renderCog(raster.cog, input, false) : null;
        const gridConfig = { totalPages: result?.totalPages ?? 4 };
        const job = append("jobs", { ...input, kind, status: result ? "completed" : "pending", outputUrl: result?.outputUrl, gridConfig });
        return { id: job.id, grid: gridConfig, outputUrl: job.outputUrl };
      }
      const layers = projectRows(state.files, input).filter(file => file.vector && (!input.layersConfig?.length || input.layersConfig.some((layer: Row) => layer.layerId === file.id)));
      const vectors = layers.length ? layers.map(file => file.vector) : [sample];
      const totalPages = kind === "atlas" ? 4 : 1;
      const job = append("jobs", { ...input, vectors, kind, status: "completed", outputUrl: "/previa/download/pdf/" + state.nextId, gridConfig: { totalPages } });
      return { id: job.id, grid: job.gridConfig, outputUrl: job.outputUrl };
    }
  }
  return undefined;
}

export function download(path: string) {
  if (path === "/amostra.geojson") {
    return { body: Buffer.from(JSON.stringify(sample, null, 2)), name: "area-ficticia.geojson", type: "application/geo+json" };
  }
  const match = /^\/(arquivo|pdf)\/(\d+)$/.exec(path);
  if (!match) return;
  const id = Number(match[2]);
  if (match[1] === "arquivo") {
    const file = state.files.find(row => row.id === id);
    if (file) return { body: Buffer.from(file.contents, "base64"), name: file.name, type: "application/octet-stream" };
    return;
  }
  const job = state.jobs.find(row => row.id === id);
  if (!job) return;
  const pdf = new jsPDF({ orientation: job.orientation, format: job.pageSize.toLowerCase() });
  const lines = job.vectors.flatMap((vector: Row) => vector.features.flatMap((feature: Row) => paths(feature.geometry))) as number[][][];
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const line of lines) for (const [longitude, latitude] of line) {
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }
  const dx = Math.max((east - west) * 0.08, 0.0001);
  const dy = Math.max((north - south) * 0.08, 0.0001);
  west -= dx; east += dx; south -= dy; north += dy;
  const pages = job.gridConfig.totalPages;
  const width = pdf.internal.pageSize.getWidth() - 28;
  const height = pdf.internal.pageSize.getHeight() - 76;
  for (let page = 0; page < pages; page++) {
    if (page) pdf.addPage();
    const cols = pages === 1 ? 1 : 2;
    const spanX = (east - west) / cols;
    const spanY = (north - south) / cols;
    const minX = west + (page % cols) * spanX;
    const maxY = north - Math.floor(page / cols) * spanY;
    pdf.setFontSize(16);
    pdf.text(String(job.title).slice(0, 85), 14, 18);
    pdf.setFontSize(9);
    pdf.text("PRÉVIA LOCAL · Cartografia de demonstração", 14, 26);
    pdf.text(`Folha ${page + 1}/${pages} · EPSG:4326 · escala solicitada 1:${job.scale}`, 14, 32);
    pdf.saveGraphicsState();
    pdf.rect(14, 40, width, height).clip().discardPath();
    pdf.setDrawColor(29, 107, 86);
    pdf.setLineWidth(0.45);
    for (const line of lines) {
      const points = line.map(([x, y]) => [14 + (x - minX) * width / spanX, 40 + (maxY - y) * height / spanY]);
      if (points.length === 1) pdf.circle(points[0][0], points[0][1], 0.8, "S");
      for (let i = 1; i < points.length; i++) pdf.line(...points[i - 1], ...points[i]);
    }
    pdf.restoreGraphicsState();
    pdf.rect(14, 40, width, height);
    pdf.text(`Extensão da folha: ${minX.toFixed(4)}, ${(maxY - spanY).toFixed(4)} a ${(minX + spanX).toFixed(4)}, ${maxY.toFixed(4)}`, 14, 46 + height);
  }
  return { body: Buffer.from(pdf.output("arraybuffer")), name: `${job.kind}-${id}.pdf`, type: "application/pdf" };
}

export function downloadVector(projectId: number, fileId: number, format: string) {
  const file = state.files.find(row => row.id === fileId && row.projectId === projectId && row.vector);
  if (file) return exportVector({ name: file.name, vector: file.vector }, format);
}
