import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { createConnection, type Connection, type RowDataPacket } from "mysql2/promise";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const enabled = process.env.INSTITUTIONAL_LOCAL_SYNTHETIC === "1";
let connection: Connection;
let baseHash = "";
let ibgeHash = "";
let simulateFailure = false;
const requests: string[] = [];
const report: Record<string, unknown> = { syntheticOnly: true, realDrizzleMysql2: true, databaseMocked: false, remoteHttpMocked: true, geographicDataSynthetic: true, externalNetworkAvailable: false, OAuthExercised: false, appAuthBypassAdded: false };
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
function context(role: "admin" | "client"): TrpcContext {
  const now = new Date("2026-01-01T12:00:00Z");
  return { user: { id: role === "admin" ? 1 : 3, openId: `synthetic-${role}`, role, name: "SYNTHETIC institutional actor", email: null, loginMethod: "synthetic-test", mfaEnabled: false, mfaSecret: null, createdAt: now, updatedAt: now, lastSignedIn: now }, req: { headers: {}, ip: "127.0.0.1", protocol: "http" } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}
const admin = () => appRouter.createCaller(context("admin"));
const reader = () => appRouter.createCaller(context("client"));
const anonymous = () => appRouter.createCaller({ ...context("client"), user: null });
function crc32(data: Buffer) { let crc = 0xffffffff; for (const b of data) { crc ^= b; for (let k=0;k<8;k++) crc = (crc>>>1)^((crc&1)?0xedb88320:0); } return (crc^0xffffffff)>>>0; }
function chunk(name: string, data: Buffer) { const tag=Buffer.from(name); const size=Buffer.alloc(4);size.writeUInt32BE(data.length);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([tag,data])));return Buffer.concat([size,tag,data,crc]); }
function png() { const header=Buffer.alloc(13);header.writeUInt32BE(128,0);header.writeUInt32BE(128,4);header[8]=8;header[9]=6;const raw=Buffer.alloc(128*(1+128*4));for(let y=0;y<128;y++)for(let x=0;x<128;x++){const p=y*(1+128*4)+1+x*4;raw[p]=80;raw[p+1]=160;raw[p+2]=220;raw[p+3]=255;}return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]); }
async function count(table: string) { if (!['ogc_services','ogc_catalog_variants','layers','files','base_layers','__drizzle_migrations'].includes(table)) throw Error('Unsafe table');const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${table}\``);return Number(rows[0].n); }
async function fingerprintBases() { const [r] = await connection.query('SELECT * FROM base_layers ORDER BY id');return hash(r); }
async function fingerprintIbge() { const [s] = await connection.query("SELECT * FROM ogc_services WHERE publisher='IBGE' ORDER BY id");const [v] = await connection.query("SELECT v.* FROM ogc_catalog_variants v JOIN ogc_services s ON s.id=v.serviceId WHERE s.publisher='IBGE' ORDER BY v.id");return hash({s,v}); }
async function catalogCounts() { return [await count('ogc_services'),await count('ogc_catalog_variants')]; }

describe.skipIf(!enabled)('Institutional registration on private real MySQL; synthetic HTTP only', () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL || '');const socket = url.searchParams.get('socketPath') || '';
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/geoportal_institutional_synthetic' || !socket.startsWith('/tmp/atena-institutional.') || !socket.endsWith('/mysql-data/mysql.sock')) throw Error('Exact private synthetic database/socket required');
    if (process.env.BUILT_IN_FORGE_API_KEY || process.env.OGC_ALLOWED_HOSTS) throw Error('External keys/configuration forbidden in test');
    connection = await createConnection({ user: 'root', socketPath: socket, database: 'geoportal_institutional_synthetic' });
    const [engine] = await connection.query<RowDataPacket[]>('SELECT VERSION() AS version');report.engine = engine[0].version;
    for (const [i,source] of ['funai','incra','iphan','osm'].entries()) await connection.query("INSERT INTO base_layers (id,name,source,layerType,dataFormat,createdBy) VALUES (?,?,?,'other','geojson',1)",[990001+i,`SYNTHETIC cache ${source}`,source]);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const u = new URL(String(input));requests.push(u.toString());
      if (simulateFailure) return new Response('SYNTHETIC upstream unavailable',{status:503,headers:{'Content-Type':'text/plain'}});
      const request = [...u.searchParams].find(([k]) => k.toLowerCase()==='request')?.[1]?.toLowerCase();
      if (request==='getmap') return new Response(new Uint8Array(png()),{status:200,headers:{'Content-Type':'image/png'}});
      if (request==='getfeature') {
        const ibge = u.hostname.includes('ibge.gov.br');
        const get = (key: string) => [...u.searchParams].find(([k])=>k.toLowerCase()===key.toLowerCase())?.[1];
        const coords = (get('bbox') || '-47.95,-15.81,-47.85,-15.72').split(',').slice(0,4).map(Number);
        const latLon=(get('bbox')||'').includes('urn:ogc:def:crs:EPSG::');
        const lon=latLon?(coords[1]+coords[3])/2:(coords[0]+coords[2])/2,lat=latLon?(coords[0]+coords[2])/2:(coords[1]+coords[3])/2;
        const code=(get('srsName')||'EPSG:4326').match(/(4326|4674)/)?.[1]||'4326';
        const geometry=ibge?{type:'Polygon',coordinates:[[[-47.92,-15.80],[-47.90,-15.80],[-47.90,-15.78],[-47.92,-15.78],[-47.92,-15.80]]]}:{type:'Polygon',coordinates:[[[lon-0.001,lat-0.001],[lon+0.001,lat-0.001],[lon+0.001,lat+0.001],[lon-0.001,lat+0.001],[lon-0.001,lat-0.001]]]};
        return new Response(JSON.stringify({type:'FeatureCollection',totalFeatures:1,numberMatched:1,numberReturned:1,features:[{type:'Feature',id:'SYNTHETIC-only',properties:{CodMunic:5300108,title:'SYNTHETIC institutional feature'},geometry}],crs:{type:'name',properties:{name:`urn:ogc:def:crs:EPSG::${ibge?'4674':code}`}}}),{status:200,headers:{'Content-Type':'application/json'}});
      }
      throw Error('Unexpected synthetic HTTP request');
    }));
    await admin().ogcCatalog.registerIbge();
    await connection.query("INSERT INTO projects (id,name,code,createdBy,status) VALUES (99001,'SYNTHETIC institutional project','SYNTH-INSTITUTIONAL',1,'active')");
    baseHash=await fingerprintBases();ibgeHash=await fingerprintIbge();
    report.baseLayersBeforeHash=baseHash;report.ibgeBeforeHash=ibgeHash;
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    if(connection) {
      report.baseLayersAfterHash=await fingerprintBases();report.ibgeAfterHash=await fingerprintIbge();report.baseLayersPreserved=report.baseLayersAfterHash===baseHash;report.ibgePreserved=report.ibgeAfterHash===ibgeHash;
      report.finalCatalogCounts=await catalogCounts();report.projectLayers=await count('layers');report.files=await count('files');report.journalCount=await count('__drizzle_migrations');await connection.end();
    }
    report.requests=requests;
    if(process.env.INSTITUTIONAL_EVIDENCE_DIR) await writeFile(process.env.INSTITUTIONAL_EVIDENCE_DIR+'/institutional-real-driver-report.json',JSON.stringify(report,null,2)+'\n');
  });
  it('enforces authentication and admin registration before external probes',async()=>{
    const before=requests.length;
    await expect(anonymous().institutionalCatalog.listSources()).rejects.toMatchObject({code:'UNAUTHORIZED'});
    await expect(reader().institutionalCatalog.registerSource({publisher:'IPHAN'})).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(requests.length).toBe(before);expect(await catalogCounts()).toEqual([2,2]);
  });
  it('keeps blocked sources visible without allowing false registrations',async()=>{
    const sources=await reader().institutionalCatalog.listSources();expect(sources.map(s=>s.publisher).sort()).toEqual(['FUNAI','INCRA','IPHAN']);
    for(const source of sources.filter(s=>s.status==='blocked')) await expect(admin().institutionalCatalog.registerSource({publisher:source.publisher})).rejects.toBeDefined();
    expect(await catalogCounts()).toEqual([2,2]);report.sourceStatuses=sources.map(s=>({publisher:s.publisher,status:s.status,supportsWms:s.supportsWms,supportsWfs:s.supportsWfs}));
  });
  it('does not write when a validated source fails its runtime HTTP probe',async()=>{
    const source=(await reader().institutionalCatalog.listSources()).find(s=>s.status==='validated');
    if(!source) return;
    simulateFailure=true;try{await expect(admin().institutionalCatalog.registerSource({publisher:source.publisher})).rejects.toBeDefined();}finally{simulateFailure=false;}
    expect(await catalogCounts()).toEqual([2,2]);
  });
  it('rolls back service insertion on an actual SQL variant failure',async()=>{
    const source=(await reader().institutionalCatalog.listSources()).find(s=>s.status==='validated');
    if(!source) return;
    await connection.query("CREATE TRIGGER institutional_test_reject BEFORE INSERT ON ogc_catalog_variants FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SYNTHETIC variant insert failure'");
    try{await expect(admin().institutionalCatalog.registerSource({publisher:source.publisher})).rejects.toBeDefined();expect(await catalogCounts()).toEqual([2,2]);}finally{await connection.query('DROP TRIGGER institutional_test_reject');}
    report.atomicFailureRollback=true;
  });
  it('registers validated protocols and remains idempotent without changing IBGE or legacy caches',async()=>{
    const sources=await reader().institutionalCatalog.listSources();const registered=[];
    for(const source of sources.filter(s=>s.status==='validated')) {
      const first=await admin().institutionalCatalog.registerSource({publisher:source.publisher});
      const afterFirst=await catalogCounts();const second=await admin().institutionalCatalog.registerSource({publisher:source.publisher});
      expect(await catalogCounts()).toEqual(afterFirst);expect(second.idempotent).toBe(true);
      registered.push({publisher:source.publisher,first,secondIdempotent:second.idempotent});
    }
    report.registered=registered;expect(await fingerprintIbge()).toBe(ibgeHash);expect(await fingerprintBases()).toBe(baseHash);
    expect(await count('layers')).toBe(0);expect(await count('files')).toBe(0);expect(await count('__drizzle_migrations')).toBe(15);
  });
  it('uses the real authenticated router for bounded WFS without persisting geographic data',async()=>{
    const catalog=await reader().ogcCatalog.listPublished();let queries=0;
    for(const entry of catalog) {
      const variant=entry.selected;
      if(!variant||variant.publisher==='IBGE'||variant.serviceType!=='wfs') continue;
      const result=await reader().institutionalCatalog.queryViewport({variantId:variant.id,bbox:{west:-47.95,south:-15.81,east:-47.85,north:-15.72},limit:50});
      expect(result.complete).toBe(true);expect(result.featureCount).toBe(1);expect(result.attribution).toBe(`Fonte: ${variant.publisher}`);
      await expect(admin().ogcCatalog.importWfsToProject({projectId:99001,variantId:variant.id})).rejects.toMatchObject({code:'FORBIDDEN',message:expect.stringContaining('somente para consulta remota')});
      await expect(reader().institutionalCatalog.queryViewport({variantId:variant.id,bbox:{west:-48,south:-17,east:-44,north:-13},limit:50})).rejects.toBeDefined();queries++;
    }
    report.boundedQueries=queries;expect(await count('layers')).toBe(0);expect(await count('files')).toBe(0);
  });
  it('rejects unknown variants, oversized viewports, and anonymous queries',async()=>{
    const request={variantId:999999,bbox:{west:-47.95,south:-15.81,east:-47.85,north:-15.72},limit:50};
    await expect(reader().institutionalCatalog.queryViewport(request)).rejects.toBeDefined();
    await expect(anonymous().institutionalCatalog.queryViewport(request)).rejects.toMatchObject({code:'UNAUTHORIZED'});
    expect(await fingerprintIbge()).toBe(ibgeHash);expect(await fingerprintBases()).toBe(baseHash);
  });
});
