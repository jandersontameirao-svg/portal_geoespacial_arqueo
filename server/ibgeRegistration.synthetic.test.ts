import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { createConnection, type Connection, type RowDataPacket } from "mysql2/promise";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const enabled = process.env.IBGE_LOCAL_SYNTHETIC === "1";
let connection: Connection;
let basesBefore = "";
let serviceIds: number[] = [];
let published: any[] = [];
const requests: string[] = [];
let simulateFailure = false;
const now = new Date("2026-01-01T12:00:00Z");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const report: Record<string, unknown> = { syntheticOnly: true, realDrizzleMysql2: true, databaseMocked: false, remoteTransportMocked: true, remoteDataSynthetic: true, OAuthExercised: false, applicationAuthBypassAdded: false, externalNetworkAvailable: false };
const collection = { type: "FeatureCollection", totalFeatures: 1, features: [{ type: "Feature", id: "synthetic-municipality", properties: { CodMunic: 5300108, NomMunic: "Município SINTÉTICO", NomUF: "UF sintética" }, geometry: { type: "Polygon", coordinates: [[[-47.92,-15.80],[-47.90,-15.80],[-47.90,-15.78],[-47.92,-15.78],[-47.92,-15.80]]] } }], crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::4674" } } };
function crc32(data: Buffer) { let crc = 0xffffffff; for (const b of data) { crc ^= b; for (let k=0;k<8;k++) crc = (crc>>>1)^((crc&1)?0xedb88320:0); } return (crc^0xffffffff)>>>0; }
function chunk(name: string, data: Buffer) { const tag=Buffer.from(name);const size=Buffer.alloc(4);size.writeUInt32BE(data.length);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([tag,data])));return Buffer.concat([size,tag,data,crc]); }
function syntheticPng() { const header=Buffer.alloc(13);header.writeUInt32BE(128,0);header.writeUInt32BE(128,4);header[8]=8;header[9]=6;const raw=Buffer.alloc(128*(1+128*4));for(let y=0;y<128;y++)for(let x=0;x<128;x++){const p=y*(1+128*4)+1+x*4;raw[p]=80;raw[p+1]=160;raw[p+2]=220;raw[p+3]=255;}return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]); }
function context(role: "admin" | "editor" | "client", id=role==='admin'?1:role==='editor'?2:3): TrpcContext {
  return { user: { id, openId: `synthetic-${role}`, role, name: "IBGE synthetic actor", email: null, loginMethod: "synthetic-test", mfaEnabled: false, mfaSecret: null, createdAt: now, updatedAt: now, lastSignedIn: now }, req: { headers: {}, ip: "127.0.0.1", protocol: "http" } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}
const admin = () => appRouter.createCaller(context("admin"));
const reader = () => appRouter.createCaller(context("client"));
async function count(table: string) { if(!['ogc_services','ogc_catalog_variants','layers','base_layers','__drizzle_migrations'].includes(table))throw Error('Unsafe table'); const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${table}\``);return Number(rows[0].n); }
async function fingerprintBases() { const [rows]=await connection.query('SELECT * FROM base_layers ORDER BY id'); return hash(rows); }

describe.skipIf(!enabled)("IBGE registration on real local MySQL (HTTP fixtures only)", () => {
  beforeAll(async () => {
    const url=new URL(process.env.DATABASE_URL||''); const socket=url.searchParams.get('socketPath')||'';
    if(url.hostname!=='127.0.0.1'||url.pathname!=='/geoportal_ibge_synthetic'||!socket.startsWith('/tmp/atena-ibge.')||!socket.endsWith('/mysql-data/mysql.sock'))throw Error('Exact private synthetic database/socket required');
    if(process.env.BUILT_IN_FORGE_API_KEY||process.env.OGC_ALLOWED_HOSTS)throw Error('External keys/configuration not allowed');
    connection=await createConnection({user:'root',socketPath:socket,database:'geoportal_ibge_synthetic'});
    const [engine]=await connection.query<RowDataPacket[]>('SELECT VERSION() AS version'); report.engine=engine[0].version;
    for(const [index,source] of ['funai','incra','iphan','osm'].entries())await connection.query("INSERT INTO base_layers (id,name,source,layerType,dataFormat,createdBy) VALUES (?,? ,?,'other','geojson',1)",[980001+index,`SYNTHETIC ${source}`,source]);
    basesBefore=await fingerprintBases();report.baseLayersBeforeHash=basesBefore;
    vi.stubGlobal('fetch',vi.fn(async (input: RequestInfo | URL) => {
      const u=new URL(String(input));requests.push(u.toString());
      if(u.hostname!=='geoservicos.ibge.gov.br')throw Error('Test denies any non-IBGE endpoint');
      if(simulateFailure)return new Response('synthetic upstream unavailable',{status:503,headers:{'Content-Type':'text/plain'}});
      const request=u.searchParams.get('REQUEST')||u.searchParams.get('request');
      if(request?.toLowerCase()==='getmap')return new Response(new Uint8Array(syntheticPng()),{status:200,headers:{'Content-Type':'image/png'}});
      if(request?.toLowerCase()==='getfeature')return new Response(JSON.stringify(collection),{status:200,headers:{'Content-Type':'application/json'}});
      throw Error('Unexpected request in directed fixture: '+request);
    }));
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    if(connection){report.baseLayersAfterHash=await fingerprintBases();report.baseLayersPreserved=report.baseLayersAfterHash===basesBefore;report.services=await count('ogc_services');report.variants=await count('ogc_catalog_variants');report.projectLayers=await count('layers');report.journalCount=await count('__drizzle_migrations');await connection.end();}
    report.requests=requests;const out=process.env.IBGE_EVIDENCE_DIR;if(out)await writeFile(out+'/ibge-real-driver-report.json',JSON.stringify(report,null,2)+'\n');
  });
  it('denies registration to readers and unauthenticated callers before probing or writing',async()=>{
    await expect(reader().ogcCatalog.registerIbge()).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(appRouter.createCaller({...context('admin'),user:null}).ogcCatalog.registerIbge()).rejects.toMatchObject({code:'UNAUTHORIZED'});
    expect(requests).toHaveLength(0);expect(await count('ogc_services')).toBe(0);
  });
  it('does not register services when the external validation fails',async()=>{
    simulateFailure=true;await expect(admin().ogcCatalog.registerIbge()).rejects.toBeDefined();simulateFailure=false;
    expect(await count('ogc_services')).toBe(0);expect(await count('ogc_catalog_variants')).toBe(0);
  });
  it('rolls back all new service/variant rows on real SQL insert failure',async()=>{
    await connection.query("CREATE TRIGGER ibge_test_reject BEFORE INSERT ON ogc_catalog_variants FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic variant insert failure'");
    try {await expect(admin().ogcCatalog.registerIbge()).rejects.toBeDefined();expect(await count('ogc_services')).toBe(0);expect(await count('ogc_catalog_variants')).toBe(0);}finally{await connection.query('DROP TRIGGER ibge_test_reject');}
    report.atomicFailureRollback=true;
  });
  it('registers two published services and variants without changing any existing base',async()=>{
    await admin().ogcCatalog.registerIbge();
    const [services]=await connection.query<RowDataPacket[]>('SELECT id,publisher,serviceType,endpoint,enabled,health FROM ogc_services ORDER BY id');
    expect(services).toHaveLength(2);expect(new Set(services.map(x=>x.endpoint)).size).toBe(2);expect(services.every(x=>x.publisher==='IBGE'&&Boolean(x.enabled)&&x.health==='healthy')).toBe(true);serviceIds=services.map(x=>Number(x.id));
    const [variants]=await connection.query<RowDataPacket[]>('SELECT attribution,remoteLayer,enabled FROM ogc_catalog_variants');expect(variants).toHaveLength(2);expect(variants.every(x=>x.attribution==='Fonte: IBGE'&&Boolean(x.enabled))).toBe(true);
    expect(await fingerprintBases()).toBe(basesBefore);expect(await count('layers')).toBe(0);report.twoServicesTwoVariants=true;
  });
  it('is idempotent and returns both protocols through the published catalog',async()=>{
    await admin().ogcCatalog.registerIbge();const [services]=await connection.query<RowDataPacket[]>('SELECT id FROM ogc_services ORDER BY id');expect(services.map(x=>Number(x.id))).toEqual(serviceIds);expect(await count('ogc_catalog_variants')).toBe(2);
    published=await reader().ogcCatalog.listPublished();const selections=published.map(x=>x.selected).filter(Boolean);expect(selections).toHaveLength(2);expect(selections.every(x=>x.publisher==='IBGE'&&x.attribution==='Fonte: IBGE')).toBe(true);expect(new Set(selections.map(x=>x.serviceType))).toEqual(new Set(['wms','wfs']));report.idempotent=true;
  });
  it('queries synthetic WFS via the real router without persisting layers or files',async()=>{
    const selected=published.map(x=>x.selected).find(x=>x?.serviceType==='wfs');expect(selected).toBeDefined();
    const result=await reader().ogcCatalog.queryIbgeViewport({variantId:selected.id,bbox:{west:-47.95,south:-15.81,east:-47.85,north:-15.72},limit:50});
    expect(result.complete).toBe(true);expect(result.featureCount).toBe(1);expect(result.collection.features[0].properties?.CodMunic).toBe(5300108);expect(result.attribution).toBe('Fonte: IBGE');expect(await count('layers')).toBe(0);report.queryWithoutPersistence=true;
    const u=new URL(requests[requests.length-1]);expect(u.searchParams.get('BBOX')||u.searchParams.get('bbox')).toContain('-47.95,-15.81,-47.85,-15.72');
  });
  it('denies missing variants and anonymous reads without changing schema or existing bases',async()=>{
    await expect(reader().ogcCatalog.queryIbgeViewport({variantId:999999,bbox:{west:-47.95,south:-15.81,east:-47.85,north:-15.72},limit:50})).rejects.toBeDefined();
    await expect(appRouter.createCaller({...context('client'),user:null}).ogcCatalog.queryIbgeViewport({variantId:published[0].selected.id,bbox:{west:-47.95,south:-15.81,east:-47.85,north:-15.72},limit:50})).rejects.toMatchObject({code:'UNAUTHORIZED'});
    expect(await fingerprintBases()).toBe(basesBefore);expect(await count('__drizzle_migrations')).toBe(15);report.noSchemaChange=true;
  });
});
