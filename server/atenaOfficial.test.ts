import { describe, expect, it, vi, afterEach } from "vitest";
import { buildRemoteRequest, decodeRemote, queryRemoteSource, readRemoteBody, REMOTE_LIMITS } from "./official/remote-client";
import { REMOTE_CONNECTIONS } from "./official/remote-contracts";
import { getPublicOfficialCatalog } from "./official/records";
import { selectRemoteOfficialAii } from "./atena/remote-aii";
import { analyzeRemoteFeatures } from "./official/remote-analysis";
import type { Feature, Polygon } from "geojson";

const bbox={west:-46.6,south:-23.5,east:-46.59,north:-23.49};
const ada:Feature<Polygon>={type:"Feature",properties:{},geometry:{type:"Polygon",coordinates:[[[-46.6,-23.5],[-46.59,-23.5],[-46.59,-23.49],[-46.6,-23.49],[-46.6,-23.5]]]}};
afterEach(()=>vi.unstubAllGlobals());

describe("contratos remotos; todos os fetches são fronteiras simuladas só neste teste",()=>{
  it("recusa protocolo inseguro, credencial embutida e recorte amplo",()=>{
    const c=REMOTE_CONNECTIONS["ibge-municipal-2025"];
    expect(()=>buildRemoteRequest({...c,baseUrl:"http://example.test/wfs"},bbox,5)).toThrow(/HTTPS/);
    expect(()=>buildRemoteRequest({...c,baseUrl:"https://user:pass@example.test/wfs"},bbox,5)).toThrow(/credenciais/);
    expect(()=>buildRemoteRequest(c,{...bbox,east:0},5)).toThrow(/excede/);
    const request=buildRemoteRequest(c,bbox,5);
    expect(request.url.protocol).toBe("https:");
    expect(request.url.searchParams.get("bbox")).toBe("-23.5,-46.6,-23.49,-46.59");
    expect(request.init.redirect).toBe("manual");
  });
  it("fonte bloqueada não consulta rede e não carrega cache local",async()=>{
    const fetcher=vi.fn(()=>{throw new Error("NETWORK_FORBIDDEN");});
    await expect(queryRemoteSource("funai-terras-indigenas-wfs",{bbox,limit:5},{userId:1},{fetch:fetcher})).rejects.toThrow(/TLS/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("redirecionamento não é seguido e falha não fabrica geometrias",async()=>{
    const fetcher=vi.fn(async()=>new Response(null,{status:302,headers:{location:"https://example.test/evil"}}));
    await expect(queryRemoteSource("ibge-municipal-2025",{bbox,limit:5},{userId:1},{fetch:fetcher})).rejects.toThrow(/Redirecionamento/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("preserva proveniência e CRS em consulta simulada completa",async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({type:"FeatureCollection",features:[{...ada,properties:{CD_MUN:"3550308",NM_MUN:"Município sintético"}}],numberMatched:1}),{status:200}));
    const response=await queryRemoteSource("ibge-municipal-2025",{bbox,limit:5},{userId:42,projectId:12},{fetch:fetcher});
    expect(response.complete).toBe(true);
    expect(response.geojson.features[0].geometry).toEqual(ada.geometry);
    expect(response.provenance).toMatchObject({institutionId:"ibge-municipal-2025",edition:"2025",geometryComplete:true,cacheHit:false});
    expect(response.provenance.queriedAt).toBeTruthy();
  });
  it("truncamento e tabela/WMS jamais sustentam análise espacial",()=>{
    const connection=REMOTE_CONNECTIONS["ibge-municipal-2025"];
    const decoded=decodeRemote(JSON.stringify({type:"FeatureCollection",features:[ada],numberMatched:2}),connection,1);
    expect(decoded.complete).toBe(false);
    const response={...decoded,provenance:{institutionId:"x",endpoint:"https://example.test",serviceVersion:"2",edition:"2025",geometryComplete:true,queriedAt:"x",cacheExpiresAt:"x",cacheHit:false,license:"x",crs:"EPSG:4326"}};
    expect(()=>analyzeRemoteFeatures(ada,response)).toThrow(/incompleto/);
    expect(()=>analyzeRemoteFeatures(ada,{...response,complete:true,provenance:{...response.provenance,geometryComplete:false}})).toThrow(/tabela\/WMS/);
  });
  it("resposta grande é bloqueada antes de consumir corpo",async()=>{
    const response=new Response("{}",{headers:{"content-length":String(REMOTE_LIMITS.maxBytes+1)}});
    await expect(readRemoteBody(response)).rejects.toThrow(/4 MiB/);
  });
  it("AII bloqueia fonte indisponível em vez de usar amostra local",async()=>{
    const fetcher=vi.fn(async()=>{throw new Error("fonte sinteticamente indisponível");});
    vi.stubGlobal("fetch",fetcher);
    await expect(selectRemoteOfficialAii(ada,[],{userId:1,projectId:1})).rejects.toThrow(/indisponível/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("AII exige geometria completa e cobertura, preserva município inteiro",async()=>{
    const municipal={...ada,properties:{CD_MUN:"3550308",NM_MUN:"Município sintético"}};
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({type:"FeatureCollection",features:[municipal],numberMatched:1}))));
    const result=await selectRemoteOfficialAii(ada,[],{userId:1,projectId:1});
    expect(result.featureCollection.features[0].geometry).toEqual(municipal.geometry);
    expect(result.coveredFraction).toBeCloseTo(1,8);
    expect(result.municipalities).toEqual([{code:"3550308",name:"Município sintético",year:2025}]);
    expect(result.sha256).toHaveLength(64);
    expect(result.featureCollection.features[0].properties?.role).toBe("AII");
  });
  it("catálogo diferencia imagem, tabela e vetor, sem prometer disponibilidade viva",()=>{
    const catalog=getPublicOfficialCatalog();
    expect(catalog.find(item=>item.id==="funai-terras-indigenas-wfs")?.connectionMode).toBe("unavailable");
    expect(catalog.find(item=>item.id==="fcp-certificacao-quilombola")?.geometryMode).toBe("tabular");
  });
});
