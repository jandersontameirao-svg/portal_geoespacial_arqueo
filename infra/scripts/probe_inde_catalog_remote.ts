import { createHash } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createIndeCatalogService, requestPinnedWms } from "../../server/indeCatalogService";
import type { IndeMapImageInput } from "../../shared/indeCatalog";

/** HTTP externo somente GET, nos endpoints fixos. Nunca usa DATABASE_URL, cookies ou storage. */
async function main() {
  const output = process.argv[2];
  if (!output || !output.startsWith("/home/ubuntu/atena_inde_catalogo_20261102_2243/evidence/"))
    throw new Error("Destino exclusivo de evidência esperado.");
  const requests: Array<Record<string, unknown>> = [];
  const service = createIndeCatalogService({ transport: async (endpoint, parameters, limit) => {
    const started = Date.now();
    const record: Record<string, unknown> = { endpoint, parameters, limitBytes: limit };
    requests.push(record);
    try {
      const body = await requestPinnedWms(endpoint, parameters, limit);
      Object.assign(record, { httpAcceptedByTransport: 200, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex"), elapsedMs: Date.now()-started });
      return body;
    } catch (error) {
      Object.assign(record, { error: error instanceof Error ? error.message : "Falha remota", elapsedMs: Date.now()-started });
      throw error;
    }
  }});
  const catalog = service.organizations();
  const wanted = ["ANM", "BNDES", "ICMBIO", "IBAMA"];
  const results: Array<Record<string, unknown>> = [];
  const mercator = (lon: number, lat: number): [number,number] => [lon*Math.PI/180*6378137, Math.log(Math.tan(Math.PI/4+Math.max(-85.0511,Math.min(85.0511,lat))*Math.PI/360))*6378137];
  // Duas consultas no máximo ao mesmo tempo, sem varrer os 71 serviços.
  for (let offset=0; offset<wanted.length; offset+=2) await Promise.all(wanted.slice(offset,offset+2).map(async label => {
    const org = catalog.organizations.find(row => row.name.split(/\s+-\s+/)[0].trim().toUpperCase()===label);
    const result: Record<string,unknown> = { label, organizationId: org?.id, endpoint: org?.endpoint, eligible: org?.eligible };
    results.push(result);
    if (!org) { result.error="Instituição não encontrada no inventário fixo."; return; }
    try {
      const caps = await service.layers(org.id);
      const matching = caps.layers.filter(layer => layer.crs.includes("EPSG:3857") && layer.crs.includes("EPSG:4326"));
      const chosen = matching.find(layer => /process.*ativ|AP_2009|unidade.*conserv|embargo/i.test(layer.name+" "+layer.title)) ?? matching[0];
      Object.assign(result,{capabilitiesPassed:true, namedLayers: caps.layers.length, truncated: caps.truncated, version:caps.version, capabilitySha256:caps.capabilitySha256, sample:chosen ? {name:chosen.name,title:chosen.title,crs:chosen.crs}:null});
      if (!chosen) { result.mapPending="Nenhuma camada anuncia ambos EPSG:3857 e EPSG:4326."; return; }
      const [west,south]=mercator(-74,-34),[east,north]=mercator(-28,6);
      const images=[];
      for (const crs of ["EPSG:3857","EPSG:4326"] as const) {
        const input:IndeMapImageInput={organizationId:org.id,layerName:chosen.name,crs,bounds:crs==="EPSG:4326"?[-180,-90,180,90]:[west,south,east,north],width:512,height:256};
        try {
          const image=await service.mapImage(input);
          const body=Buffer.from(image.dataUrl.slice("data:image/png;base64,".length),"base64");
          images.push({crs,bounds:input.bounds,pngPassed:true,bytes:body.length,width:body.readUInt32BE(16),height:body.readUInt32BE(20),sha256:createHash("sha256").update(body).digest("hex"),attribution:image.attribution,mimeDetected:"image/png",httpHeaderContentType:"não exposto pelo contrato de transporte; assinatura PNG validada"});
        } catch(error) { images.push({crs,pngPassed:false,error:error instanceof Error?error.message:"Falha remota"}); }
      }
      result.images=images;
    } catch(error) { result.capabilitiesPassed=false; result.error=error instanceof Error?error.message:"Falha remota"; }
  }));
  const report={testedAt:new Date().toISOString(),source:catalog.sourceUrl,registeredServiceRecords:catalog.organizations.length,eligibleTransportCandidates:catalog.organizations.filter(row=>row.eligible).length,blocked:catalog.organizations.filter(row=>!row.eligible).map(({label,endpoint,blocker})=>({label,endpoint,blocker})),scope:"Cliente node:https real do backend, DNS fixado/TLS estrito. Corpos apenas em memória. Não é teste do deployment nem OAuth.",databaseTouched:false,storageTouched:false,remoteGeometriesSaved:false,results,requests};
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({output,results},null,2));
}
void main().catch(error=>{console.error(error instanceof Error?error.message:"Falha de probe");process.exitCode=1;});
