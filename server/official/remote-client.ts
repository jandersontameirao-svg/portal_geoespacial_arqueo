import { validateClosedPolygonCoordinates } from "../../shared/geometry-coordinates";
import type { Feature, FeatureCollection, Geometry, GeoJsonProperties } from "geojson";
import { getOfficialRecord } from "./records";
import type { OfficialBbox, QueryScope, RemoteConnection, RemoteQueryResult } from "./remote-types";
export type { RemoteQueryResult, QueryScope, OfficialBbox } from "./remote-types";

export const REMOTE_LIMITS = { timeoutMs: 10000, maxBytes: 4 * 1024 * 1024, ttlMs: 5 * 60 * 1000, cacheBytes: 16 * 1024 * 1024, cacheEntries: 32, maxFeatures: 200, maxCoordinatePairs: 200000 } as const;
type FetchFunction = typeof fetch;
interface CacheItem { serialized: string; bytes: number; expires: number }
const memoryCache = new Map<string, CacheItem>();
let cacheBytes = 0;
export function clearRemoteMemoryCache() { memoryCache.clear(); cacheBytes = 0; }
function removeCache(key: string) { const item = memoryCache.get(key); if (item) { cacheBytes -= item.bytes; memoryCache.delete(key); } }
function putCache(key: string, result: RemoteQueryResult) {
  const serialized = JSON.stringify(result), bytes = Buffer.byteLength(serialized);
  if (bytes > REMOTE_LIMITS.maxBytes) return;
  for (const [oldKey, item] of Array.from(memoryCache)) if (item.expires <= Date.now()) removeCache(oldKey);
  removeCache(key);
  while (memoryCache.size >= REMOTE_LIMITS.cacheEntries || cacheBytes + bytes > REMOTE_LIMITS.cacheBytes) {
    const oldest = memoryCache.keys().next().value; if (!oldest) break; removeCache(oldest);
  }
  memoryCache.set(key, { serialized, bytes, expires: Date.now() + REMOTE_LIMITS.ttlMs }); cacheBytes += bytes;
}

export function validateRemoteBbox(b: OfficialBbox, kind: RemoteConnection["kind"]) {
  const vals = [b.west,b.south,b.east,b.north];
  if (vals.some(v => !Number.isFinite(v)) || b.west < -180 || b.east > 180 || b.south < -90 || b.north > 90 || b.west >= b.east || b.south >= b.north) throw new Error("Extensão territorial inválida.");
  const span = kind === "overpass" ? 0.02 : 10;
  if (b.east-b.west > span || b.north-b.south > span) throw new Error(`Recorte excede ${span} grau(s); reduza a extensão da consulta.`);
}

export function buildRemoteRequest(c: RemoteConnection, b: OfficialBbox, limit: number, query?:string): { url: URL; init: RequestInit } {
  validateRemoteBbox(b, c.kind);
  const url = new URL(c.baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Endpoint remoto exige HTTPS sem credenciais embutidas.");
  const xy = `${b.west},${b.south},${b.east},${b.north}`;
  const ordered = c.bboxAxisOrder === "latlng" ? `${b.south},${b.west},${b.north},${b.east}` : xy;
  const init: RequestInit = { method: "GET", redirect: "manual", headers: { Accept: "application/geo+json,application/json,text/csv" } };
  if (c.kind === "wfs") {
    for (const key of ["request","Request","typeNames","typeName","maxFeatures","count","bbox"]) url.searchParams.delete(key);
    url.searchParams.set("service","WFS"); url.searchParams.set("version",c.serviceVersion);
    url.searchParams.set("request","GetFeature"); url.searchParams.set(c.serviceVersion.startsWith("2") ? "typeNames" : "typeName",c.layer);
    url.searchParams.set(c.serviceVersion.startsWith("2") ? "count" : "maxFeatures",String(limit+1));
    url.searchParams.set("outputFormat",c.outputFormat ?? "application/json");
    url.searchParams.set("srsName",c.srsName ?? "EPSG:4326");
    url.searchParams.set("bbox",c.bboxCrsSuffix === false ? ordered : `${ordered},${c.srsName ?? "EPSG:4326"}`);
  } else if (c.kind === "arcgis") {
    if (!url.pathname.endsWith("/query")) url.pathname = url.pathname.replace(/\/$/,"") + "/query";
    url.searchParams.set("f","geojson"); url.searchParams.set("where","1=1");
    url.searchParams.set("geometry",xy); url.searchParams.set("geometryType","esriGeometryEnvelope");
    url.searchParams.set("inSR","4326"); url.searchParams.set("outSR","4326");
    url.searchParams.set("spatialRel","esriSpatialRelIntersects"); url.searchParams.set("outFields","*");
    url.searchParams.set("returnGeometry","true"); url.searchParams.set("resultRecordCount",String(limit+1));
  } else if (c.kind === "ogcapi") {
    url.searchParams.set("bbox",xy); url.searchParams.set("limit",String(limit+1)); url.searchParams.set("f","json");
  } else if (c.kind === "overpass") {
    const data=`[out:json][timeout:8][maxsize:4194304];way["highway"](${b.south},${b.west},${b.north},${b.east});out geom ${limit+1};`;
    init.method="POST"; init.headers={"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"};
    init.body=new URLSearchParams({data}).toString();
  } else if (c.kind === "gviz") {
    const needle=query?.trim().toLocaleLowerCase("pt-BR");
    if(!needle)throw new Error("Tabela sem coordenadas: informe filtro de UF, município ou comunidade.");
    const columns=c.tableFilterColumns??[];
    if(!columns.length||columns.some(column=>!/^[A-Z]{1,2}$/.test(column)))throw new Error("Colunas de consulta tabular não foram validadas.");
    const filter=columns.map(column=>`lower(${column}) contains ${JSON.stringify(needle)}`).join(" or ");
    url.searchParams.set("tqx","out:json"); url.searchParams.set("headers","1");
    url.searchParams.set("tq",`select * where ${filter} limit ${limit+1}`);
  } else if (c.kind === "wms") throw new Error("WMS fornece imagem e não substitui uma consulta vetorial.");
  return { url, init };
}

export async function readRemoteBody(response: Response, encoding="utf-8"): Promise<string> {
  if (!response.ok) throw new Error(`Serviço oficial respondeu HTTP ${response.status}; nenhum arquivo local foi utilizado.`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > REMOTE_LIMITS.maxBytes) throw new Error("Resposta oficial excede 4 MiB; reduza o recorte.");
  if (!response.body) throw new Error("Serviço oficial retornou resposta sem corpo.");
  const reader=response.body.getReader(); const chunks:Uint8Array[]=[];let size=0;
  try {
    for (;;) {
      const next=await reader.read();if(next.done)break;
      size+=next.value.byteLength;
      if(size>REMOTE_LIMITS.maxBytes) { await reader.cancel();throw new Error("Resposta descomprimida excede 4 MiB; consulta interrompida."); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return new TextDecoder(encoding,{fatal:true}).decode(bytes);
}

function text(value: unknown) { return (typeof value === "string" ? value : JSON.stringify(value) ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,"").slice(0,4096); }
function properties(value: unknown): GeoJsonProperties {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([k])=>!["__proto__","constructor","prototype"].includes(k)).slice(0,200).map(([k,v])=>[k.slice(0,128),v===null || typeof v === "number" || typeof v === "boolean" ? v : text(v)]));
}
function convertCoordinates(value: unknown, order: "lnglat"|"latlng", counter: {pairs:number}, depth=0): unknown {
  if (depth>8 || !Array.isArray(value) || !value.length) throw new Error("Estrutura de coordenadas oficial inválida; nenhuma feição foi omitida silenciosamente.");
  if (typeof value[0] === "number") {
    if (value.length<2 || value.some(v=>typeof v!=="number" || !Number.isFinite(v))) throw new Error("Vértice oficial inválido.");
    const [a,b,...rest]=value as number[]; const [lng,lat]=order==="latlng"?[b,a]:[a,b];
    if(Math.abs(lng)>180 || Math.abs(lat)>90) throw new Error("Coordenada fora de CRS geográfico confirmado.");
    if(++counter.pairs>REMOTE_LIMITS.maxCoordinatePairs)throw new Error("Resposta excede o limite de vértices; nenhuma geometria foi truncada.");
    return [lng,lat,...rest];
  }
  return value.map(child=>convertCoordinates(child,order,counter,depth+1));
}
function geometry(value:unknown,c:RemoteConnection,counter:{pairs:number}): Geometry {
  if(!value || typeof value!=="object")throw new Error("Feição oficial sem geometria.");
  const g=value as Record<string,unknown>;
  if(g.type==="GeometryCollection") {
    if(!Array.isArray(g.geometries) || !g.geometries.length)throw new Error("Coleção geométrica vazia.");
    return {type:"GeometryCollection",geometries:g.geometries.map(child=>geometry(child,c,counter))};
  }
  if(!["Point","MultiPoint","LineString","MultiLineString","Polygon","MultiPolygon"].includes(String(g.type)))throw new Error("Tipo geométrico remoto não suportado.");
  const coordinates = convertCoordinates(g.coordinates,c.responseAxisOrder,counter);
  if (g.type === "Polygon" || g.type === "MultiPolygon") validateClosedPolygonCoordinates(coordinates, "geojson-lng-lat");
  return {type:g.type,coordinates} as Geometry;
}
function parseCsv(body:string,delimiter=","): Array<Record<string,string>> {
  const all:string[][]=[];let row:string[]=[],cell="",quoted=false;
  for(let i=0;i<body.length;i++) {
    const ch=body[i];
    if(ch==='"'){if(quoted && body[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(ch===delimiter && !quoted){row.push(cell);cell="";}
    else if((ch==='\n'||ch==='\r') && !quoted){if(ch==='\r'&&body[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))all.push(row);row=[];cell="";}
    else cell+=ch;
  }
  if(quoted)throw new Error("Tabela oficial CSV malformada.");
  row.push(cell);if(row.some(Boolean))all.push(row);
  const headerIndex=all.findIndex(cells=>cells.length>3&&cells.some(v=>/\bUF\b/i.test(v)));
  const start=headerIndex>=0?headerIndex:0;
  const headers=all[start];if(!headers?.length)throw new Error("Tabela oficial sem cabeçalho.");
  return all.slice(start+1).map(cells=>{if(cells.length!==headers.length)throw new Error("Linha oficial CSV inconsistente; não foi omitida.");return Object.fromEntries(headers.map((h,i)=>[text(h),text(cells[i])]));});
}

export function decodeRemote(body:string,c:RemoteConnection,limit:number,query?:string): {geojson:FeatureCollection;complete:boolean;matched:number|null;rows?:Array<Record<string,string>>} {
  if(c.kind==="csv") {
    const needle=query?.trim().toLocaleLowerCase("pt-BR");
    if(!needle)throw new Error("Tabela sem coordenadas: informe filtro de UF, município ou comunidade; não há interseção espacial fictícia.");
    const rows=parseCsv(body,c.tableDelimiter).filter(r=>Object.values(r).some(v=>v.toLocaleLowerCase("pt-BR").includes(needle)));
    return {geojson:{type:"FeatureCollection",features:[]},rows:rows.slice(0,limit),complete:rows.length<=limit,matched:rows.length};
  }
  if(c.kind==="gviz") {
    const safe=body.replace(/^\s*\/\*[\s\S]*?\*\//,"").trim();
    const prefix="google.visualization.Query.setResponse(";
    if(!safe.startsWith(prefix)||!safe.endsWith(");"))throw new Error("Resposta tabular oficial não reconhecida.");
    const parsed=JSON.parse(safe.slice(prefix.length,-2)) as {status:string;table?:{cols:Array<{label:string;id:string}>;rows:Array<{c:Array<{v?:unknown;f?:string}|null>}>}};
    if(parsed.status!=="ok"||!parsed.table)throw new Error("Consulta tabular oficial informou erro.");
    const rows=parsed.table.rows.map(row=>Object.fromEntries(parsed.table!.cols.map((col,i)=>[col.label||col.id,text(row.c[i]?.f??row.c[i]?.v??"")])));
    const needle=query?.toLocaleLowerCase("pt-BR");const filtered=needle?rows.filter(row=>Object.values(row).some(v=>v.toLocaleLowerCase("pt-BR").includes(needle))):rows;
    return {geojson:{type:"FeatureCollection",features:[]},rows:filtered.slice(0,limit),complete:rows.length<=limit,matched:null};
  }
  let raw:Record<string,unknown>;
  try { raw=JSON.parse(body) as Record<string,unknown>; } catch { throw new Error("Serviço não retornou GeoJSON/JSON válido (HTML, GML ou erro da fonte); nenhum fallback local."); }
  if(raw.error || raw.remark)throw new Error("Serviço remoto informou erro ou consulta incompleta.");
  let inputs:unknown[];
  if(c.kind==="overpass") {
    if(!Array.isArray(raw.elements))throw new Error("Resposta Overpass inválida.");
    inputs=raw.elements.map((item:Record<string,unknown>)=>{
      if(item.type!=="way" || !Array.isArray(item.geometry) || item.geometry.length<2)throw new Error("Elemento OSM sem geometria completa.");
      const coords=item.geometry.map((p:Record<string,unknown>)=>[p.lon,p.lat]);
      return {type:"Feature",id:`way/${item.id}`,geometry:{type:"LineString",coordinates:coords},properties:{...(item.tags as Record<string,unknown> ?? {}),osm_id:item.id,osm_type:item.type}};
    });
  } else if(raw.type==="Feature") inputs=[raw];
  else if(raw.type==="FeatureCollection" && Array.isArray(raw.features)) inputs=raw.features;
  else throw new Error("Fonte retornou formato não geográfico; não será convertida em pontos fictícios.");
  const counter={pairs:0};
  const features:Feature[]=inputs.map(value=>{
    if(!value || typeof value!=="object")throw new Error("Feição oficial inválida.");
    const f=value as Record<string,unknown>;if(f.type!=="Feature")throw new Error("Objeto não é Feature GeoJSON.");
    return {type:"Feature",...(typeof f.id==="string"||typeof f.id==="number"?{id:f.id}:{}),geometry:geometry(f.geometry,c,counter),properties:properties(f.properties)};
  });
  const reported=Number(raw.numberMatched ?? raw.totalFeatures);
  const matched=Number.isFinite(reported)&&reported>=0?reported:null;
  const next=Array.isArray(raw.links)&&raw.links.some((link:Record<string,unknown>)=>link.rel==="next");
  const complete=features.length<=limit&&!next&&!raw.exceededTransferLimit&&(matched===null||matched<=features.length);
  const needle=query?.trim().toLocaleLowerCase("pt-BR");
  const filtered=needle?features.filter(f=>JSON.stringify(f.properties).toLocaleLowerCase("pt-BR").includes(needle)):features;
  return {geojson:{type:"FeatureCollection",features:filtered.slice(0,limit)},complete,matched};
}

export async function queryRemoteSource(recordId:string,input:{bbox:OfficialBbox;query?:string;limit:number},scope:QueryScope,options:{fetch?:FetchFunction;disableCache?:boolean}={}):Promise<RemoteQueryResult> {
  if(!Number.isInteger(scope.userId)||scope.userId<=0)throw new Error("Consulta vetorial exige identidade autorizada.");
  if(!Number.isInteger(input.limit)||input.limit<1||input.limit>REMOTE_LIMITS.maxFeatures)throw new Error("Limite de feições inválido.");
  const record=getOfficialRecord(recordId), c=record?.remote;
  if(!c || c.enabled===false || !c.publicQueryPermitted || c.probeStatus!==200 || !c.validatedAt)throw new Error(record?.restriction ?? "Conexão oficial ainda não comprovada; nenhuma amostra local foi usada.");
  const {url,init}=buildRemoteRequest(c,input.bbox,input.limit,input.query);
  const key=JSON.stringify([scope.userId,scope.projectId ?? null,recordId,c.edition,input.bbox,url.toString(),init.body ?? null,input.query ?? "",input.limit]);
  const cached=memoryCache.get(key);
  if(c.cacheAllowed && !options.disableCache&&cached&&cached.expires>Date.now()) {
    const result=JSON.parse(cached.serialized) as RemoteQueryResult;result.provenance.cacheHit=true;return result;
  }
  if(cached)removeCache(key);
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),REMOTE_LIMITS.timeoutMs);
  try {
    const response=await (options.fetch ?? fetch)(url,{...init,signal:controller.signal});
    if(response.status>=300&&response.status<400)throw new Error("Redirecionamento da fonte exige nova validação; não foi seguido automaticamente.");
    const body=await readRemoteBody(response,c.tableEncoding), decoded=decodeRemote(body,c,input.limit,input.query);
    const now=new Date();
    const result:RemoteQueryResult={...decoded,provenance:{institutionId:recordId,endpoint:c.baseUrl,serviceVersion:c.serviceVersion,edition:c.edition,geometryComplete:c.geometryComplete,queriedAt:now.toISOString(),cacheExpiresAt:new Date(now.getTime()+(c.cacheAllowed?REMOTE_LIMITS.ttlMs:0)).toISOString(),cacheHit:false,license:c.license,crs:c.crs}};
    if(c.cacheAllowed&&!options.disableCache)putCache(key,result);return result;
  } catch(error) {
    if(controller.signal.aborted)throw new Error("Fonte excedeu o timeout de 10 segundos. Sem fallback para download/cache expirado.");
    throw error;
  } finally {clearTimeout(timer);}
}
