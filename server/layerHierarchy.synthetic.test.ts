import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection, type Connection, type RowDataPacket } from "mysql2/promise";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TrpcContext } from "./_core/context";
import type { layersRouter as LayersRouter } from "./layersRouter";
import type { geometriesRouter as GeometriesRouter } from "./geometriesRouter";
import type { projectSelectionRouter as SelectionRouter } from "./projectSelectionRouter";
import type { baseLayersRouter as BasesRouter } from "./baseLayersRouter";

// Opt-in ONLY. No mocks, no DDL, no fallback URL, no TCP connection.
// The parent prepares baseline + ONE additive migration in a disposable MySQL namespace.
const enabled = process.env.HIERARCHY_ATENA_SYNTHETIC === "1";
const rootPattern = /^\/tmp\/atena-panels-atena\.[A-Za-z0-9_-]+$/;
const schemaName = "geoportal_panels_atena";
const projectId = 81101;
const foreignProjectId = 81102;
const adminId = 81001;
const editorId = 81002;
const readerId = 81003;
const outsiderId = 81004;
const fixed = new Date("2026-01-02T03:04:05Z");
let sql: Connection;
let layersRouter: typeof LayersRouter;
let geometriesRouter: typeof GeometriesRouter;
let selectionRouter: typeof SelectionRouter;
let basesRouter: typeof BasesRouter;
let groupId: number;
let childGroupId: number;
let leafId: number;
let foreignLeafId: number;
let geometryId: number;
let orphanId: number;
const legacyId = 81201;
const baseId = 81301;
const inactiveBaseId = 81302;
const evidence: Record<string, unknown> = {
  realMySQLDriver: true, drizzleAndRouterGuards: true, driverMocks: false,
  ddlExecutedByThisTest: false, remoteRequests: false,
  syntheticCallerContexts: true, authenticationOAuthNotTested: true, passed: [] as string[],
};
const passed = (label: string) => (evidence.passed as string[]).push(label);

function context(id: number, role: "admin" | "editor" | "client"): TrpcContext {
  return {
    user: { id, openId: `hierarchy-${id}`, role, name: "Hierarchy synthetic", email: "hierarchy@example.invalid", loginMethod: "synthetic-only", mfaEnabled: false, mfaSecret: null, createdAt: fixed, updatedAt: fixed, lastSignedIn: fixed },
    req: { protocol: "http", headers: {}, ip: "127.0.0.1" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}
const editor = () => layersRouter.createCaller(context(editorId, "editor"));
const reader = () => layersRouter.createCaller(context(readerId, "client"));
const geometryEditor = () => geometriesRouter.createCaller(context(editorId, "editor"));
const parsed = (value: unknown) => typeof value === "string" ? JSON.parse(value) : value;

/** Export-free guard is executed before imports that can initialize persistence. */
async function guardedConnection() {
  if (process.env.NODE_ENV !== "test") throw new Error("NODE_ENV=test required");
  const root = process.env.HIERARCHY_ATENA_LOCAL_ROOT || "";
  if (!rootPattern.test(root) || await realpath(root) !== root) throw new Error("Exact disposable hierarchy root required; symlinks refused");
  const url = new URL(process.env.DATABASE_URL || "");
  const socketPath = url.searchParams.get("socketPath");
  if (url.protocol !== "mysql:" || url.hostname !== "127.0.0.1" || url.port || url.username !== "root" || url.password || url.pathname !== `/${schemaName}`) throw new Error("Exact local hierarchy URL required");
  if (socketPath !== `${root}/mysql-data/mysql.sock` || await realpath(socketPath) !== socketPath) throw new Error("Exact disposable socket required");
  if ([...url.searchParams.keys()].some(key => !["socketPath", "timezone"].includes(key))) throw new Error("Unexpected connection options refused");
  const connection = await createConnection({ user: "root", database: schemaName, socketPath, timezone: "Z" });
  const [rows] = await connection.query<RowDataPacket[]>("SELECT DATABASE() AS dbName, VERSION() AS engine, @@skip_networking AS skipNetworking");
  if (rows[0].dbName !== schemaName || Number(rows[0].skipNetworking) !== 1) { await connection.end(); throw new Error("Disposable DB with skip_networking required"); }
  evidence.engine = rows[0].engine;
  evidence.socketOnly = true;
  return connection;
}

describe.skipIf(!enabled).sequential("Hierarchy / local real MySQL driver contracts", () => {
  beforeAll(async () => {
    sql = await guardedConnection();
    ({ layersRouter } = await import("./layersRouter"));
    ({ geometriesRouter } = await import("./geometriesRouter"));
    ({ projectSelectionRouter: selectionRouter } = await import("./projectSelectionRouter"));
    ({ baseLayersRouter: basesRouter } = await import("./baseLayersRouter"));
    await sql.query("INSERT INTO users (id,openId,role) VALUES (?,?,'admin'),(?,?,'editor'),(?,?,'client'),(?,?,'editor')", [adminId,`hierarchy-${adminId}`,editorId,`hierarchy-${editorId}`,readerId,`hierarchy-${readerId}`,outsiderId,`hierarchy-${outsiderId}`]);
    await sql.query("INSERT INTO projects (id,name,code,createdBy) VALUES (?,'Synthetic hierarchy','HIERARCHY-81101',?),(?,'Foreign hierarchy','HIERARCHY-81102',?)", [projectId,adminId,foreignProjectId,adminId]);
    await sql.query("INSERT INTO project_members (projectId,userId,role,addedBy) VALUES (?,?,'editor',?),(?,?,'viewer',?),(?,?,'editor',?)", [projectId,editorId,adminId,projectId,readerId,adminId,foreignProjectId,outsiderId,adminId]);
    await sql.query("INSERT INTO files (id,projectId,name,originalName,fileType,fileSize,s3Key,s3Url,uploadedBy) VALUES (81999,?,'Legacy GeoJSON','legacy.geojson','geojson',16,'synthetic/hierarchy','/synthetic/hierarchy',?)", [projectId,adminId]);
    await sql.query("INSERT INTO layers (id,projectId,fileId,name,layerType,layerData,metadata,createdBy) VALUES (?,?,81999,'Legacy vector','vector',?,?,?)", [legacyId,projectId,JSON.stringify({ type:"FeatureCollection",features:[{type:"Feature",properties:{legacy:true},geometry:{type:"Point",coordinates:[-47,-15]}}] }),JSON.stringify({kind:"analysis",presentation:{renderOrder:7},provenance:"untouched"}),adminId]);
    await sql.query("INSERT INTO geometries (id,projectId,userId,type,name,coordinates) VALUES (81401,?,?,'marker','Detached geometry','[-15,-47]')", [projectId,editorId]);
    orphanId = 81401;
    await sql.query("INSERT INTO base_layers (id,name,source,layerType,dataFormat,isActive,createdBy) VALUES (?,'Existing official base','funai','terras_indigenas','geojson',1,?),(?,'Inactive base','custom','other','geojson',0,?)", [baseId,adminId,inactiveBaseId,adminId]);
  });
  afterAll(async () => {
    if (sql) await sql.end();
    const target = process.env.HIERARCHY_ATENA_EVIDENCE_DIR;
    if (target && sql) {
      const resolved = path.resolve(target);
      if (!resolved.startsWith("/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/") && !resolved.startsWith(`${process.env.HIERARCHY_ATENA_LOCAL_ROOT}/`)) throw new Error("Evidence must stay in authorized report/disposable root");
      await mkdir(resolved, { recursive: true });
      await writeFile(path.join(resolved, "hierarchy-real-driver-report.json"), JSON.stringify(evidence, null, 2) + "\n");
    }
  });

  it("lists existing layerData and detached geometries without migration/rewrite", async () => {
    const legacy = (await editor().list({ projectId })).find(row => row.id === legacyId)!;
    expect(legacy).toMatchObject({ parentId:null,isGroup:false,sortOrder:0,fileId:81999,userVisible:true,effectiveVisible:true });
    expect(parsed(legacy.layerData)).toMatchObject({ type:"FeatureCollection",features:[{properties:{legacy:true}}] });
    expect(legacy.metadata).toMatchObject({presentation:{renderOrder:7}});
    expect((await geometryEditor().list({projectId})).find(row => row.id === orphanId)).toMatchObject({layerId:null,visible:1,effectiveVisible:true});
    passed("legacy layerData/metadata/fileId and detached geometry preserved");
  });
  it("keeps authorization exact: anonymous/nonmember/client cannot write; project read needs membership", async () => {
    await expect(layersRouter.createCaller({...context(editorId,"editor"),user:null}).list({projectId})).rejects.toMatchObject({code:"UNAUTHORIZED"});
    await expect(layersRouter.createCaller(context(outsiderId,"editor")).list({projectId})).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(reader().createGroup({projectId,name:"Denied"})).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(layersRouter.createCaller(context(outsiderId,"editor")).createLayer({projectId,name:"Denied"})).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(layersRouter.createCaller(context(adminId,"admin")).list({projectId:99999999})).rejects.toMatchObject({code:"NOT_FOUND"});
    passed("anonymous/member/global-role/existence guards");
  });
  it("creates nested groups and leaves using real SQL and editor authorization", async () => {
    groupId = (await editor().createGroup({projectId,name:"Root",sortOrder:3})).id;
    childGroupId = (await editor().createGroup({projectId,name:"Child group",parentId:groupId})).id;
    leafId = (await editor().createLayer({projectId,name:"Leaf",parentId:childGroupId})).id;
    foreignLeafId = (await layersRouter.createCaller(context(outsiderId,"editor")).createLayer({projectId:foreignProjectId,name:"Foreign"})).id;
    expect((await editor().list({projectId})).find(row => row.id===leafId)).toMatchObject({parentId:childGroupId,isGroup:false,effectiveVisible:true});
    passed("arbitrary nested hierarchy create");
  });
  it("rejects cross-project, non-group parents and cycles before writes", async () => {
    await expect(editor().createLayer({projectId,name:"Invalid",parentId:foreignLeafId})).rejects.toMatchObject({code:"BAD_REQUEST"});
    await expect(editor().createGroup({projectId,name:"Invalid",parentId:leafId})).rejects.toMatchObject({code:"BAD_REQUEST"});
    await expect(editor().move({id:groupId,parentId:childGroupId,sortOrder:0})).rejects.toMatchObject({code:"BAD_REQUEST"});
    await expect(editor().move({id:groupId,parentId:groupId,sortOrder:0})).rejects.toMatchObject({code:"BAD_REQUEST"});
    await expect(editor().move({id:leafId,parentId:foreignLeafId,sortOrder:0})).rejects.toMatchObject({code:"BAD_REQUEST"});
    await expect(reader().move({id:leafId,parentId:null,sortOrder:0})).rejects.toMatchObject({code:"FORBIDDEN"});
    passed("cross-project/leaf-parent/self/descendant guards");
  });
  it("serializes concurrent reciprocal moves in the DB; cannot introduce a cycle", async () => {
    const a = (await editor().createGroup({projectId,name:"Concurrent A"})).id;
    const b = (await editor().createGroup({projectId,name:"Concurrent B"})).id;
    const results = await Promise.allSettled([editor().move({id:a,parentId:b,sortOrder:0}),editor().move({id:b,parentId:a,sortOrder:0})]);
    expect(results.filter(result => result.status==="fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status==="rejected")).toHaveLength(1);
    const rows = await editor().list({projectId});
    expect(rows.find(row => row.id===a)?.parentId===b && rows.find(row => row.id===b)?.parentId===a).toBe(false);
    expect(rows.filter(row => row.id===a || row.id===b).every(row => row.effectiveVisible)).toBe(true);
    passed("real concurrent reciprocal moves: one succeeds, other denied");
  });
  it("moves only hierarchy columns; legacy GeoJSON, style and renderOrder survive", async () => {
    const before = (await editor().list({projectId})).find(row=>row.id===legacyId)!;
    await editor().move({id:legacyId,parentId:groupId,sortOrder:17});
    const after = (await editor().list({projectId})).find(row=>row.id===legacyId)!;
    for (const key of ["layerData","metadata","fileId","defaultStyle","layerType"] as const) expect(after[key]).toEqual(before[key]);
    expect(after).toMatchObject({parentId:groupId,sortOrder:17});
    passed("move preserves legacy payload and presentation.renderOrder");
  });
  it("lets a reader override only their own visibility with cascade, never shared flags", async () => {
    await reader().setVisibility({id:groupId,visible:false});
    await reader().setVisibility({id:groupId,visible:false}); // Upsert, not duplicate.
    const clientRows = await reader().list({projectId});
    expect(clientRows.find(row=>row.id===leafId)).toMatchObject({userVisible:true,effectiveVisible:false,isVisible:true});
    expect((await editor().list({projectId})).find(row=>row.id===leafId)?.effectiveVisible).toBe(true);
    const [overrides] = await sql.query<RowDataPacket[]>("SELECT userId, COUNT(*) AS n FROM user_layer_visibility WHERE layerId=? GROUP BY userId",[groupId]);
    expect(overrides).toHaveLength(1);
    expect(Number(overrides[0].userId)).toBe(readerId);
    expect(Number(overrides[0].n)).toBe(1);
    await expect(layersRouter.createCaller(context(outsiderId,"editor")).setVisibility({id:groupId,visible:false})).rejects.toMatchObject({code:"FORBIDDEN"});
    passed("personal reader override/upsert/cascade without shared flag mutation");
  });
  it("creates/moves geometry only into same-project leaf and keeps detached geometry visible", async () => {
    await geometryEditor().create({projectId,layerId:leafId,type:"marker",name:"Hierarchy point",coordinates:"[-15,-47]"});
    geometryId = (await geometryEditor().list({projectId})).find(row=>row.name==="Hierarchy point")!.id;
    const client = geometriesRouter.createCaller(context(readerId,"client"));
    expect((await client.list({projectId})).find(row=>row.id===geometryId)).toMatchObject({visible:1,effectiveVisible:false,layerId:leafId});
    expect((await client.list({projectId})).find(row=>row.id===orphanId)?.effectiveVisible).toBe(true);
    await expect(geometryEditor().moveToLayer({id:geometryId,layerId:groupId})).rejects.toMatchObject({code:"BAD_REQUEST"});
    await expect(geometryEditor().moveToLayer({id:geometryId,layerId:foreignLeafId})).rejects.toMatchObject({code:"BAD_REQUEST"});
    await expect(client.moveToLayer({id:geometryId,layerId:null})).rejects.toMatchObject({code:"FORBIDDEN"});
    await geometryEditor().moveToLayer({id:geometryId,layerId:null});
    expect((await client.list({projectId})).find(row=>row.id===geometryId)?.effectiveVisible).toBe(true);
    await geometryEditor().setLayer({id:geometryId,layerId:leafId});
    passed("geometry leaf/same-project/editor guards, detached visibility and setLayer alias");
  });
  it("retains update/delete topology and authorization; rejects invalid batch before partial write", async () => {
    const client = geometriesRouter.createCaller(context(readerId,"client"));
    const outsider = geometriesRouter.createCaller(context(outsiderId,"editor"));
    await expect(client.update({id:geometryId,name:"Denied"})).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(outsider.delete({id:geometryId})).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(geometryEditor().update({id:geometryId,type:"polygon",coordinates:"[[0,0],[1,1],[0,1],[1,0],[0,0]]"})).rejects.toMatchObject({code:"BAD_REQUEST"});
    const before = (await geometryEditor().list({projectId})).length;
    await expect(geometryEditor().importBatch({projectId,layerId:leafId,geometries:[{type:"marker",name:"Valid first",coordinates:"[-15,-47]"},{type:"polygon",name:"Invalid last",coordinates:"[[0,0],[1,1],[0,1],[1,0],[0,0]]"}]})).rejects.toMatchObject({code:"BAD_REQUEST"});
    await expect(geometryEditor().importBatch({projectId,geometries:[{type:"marker",name:"Wrong project",coordinates:"[-15,-47]",layerId:foreignLeafId}]})).rejects.toMatchObject({code:"BAD_REQUEST"});
    expect((await geometryEditor().list({projectId})).length).toBe(before);
    await geometryEditor().update({id:geometryId,name:"Renamed safely"});
    expect((await geometryEditor().list({projectId})).find(row=>row.id===geometryId)).toMatchObject({name:"Renamed safely",layerId:leafId});
    await geometryEditor().importBatch({projectId,layerId:leafId,geometries:[{type:"marker",name:"Valid batch",coordinates:"[-15,-47]"}]});
    const batch = (await geometryEditor().list({projectId})).find(row=>row.name==="Valid batch")!;
    expect(batch.layerId).toBe(leafId);
    await geometryEditor().delete({id:batch.id});
    passed("existing topology/update/delete guards; batch atomic single insert");
  });
  it("filters explicit project ids, selected ids and stale revoked membership; admin requires existence", async () => {
    const selection = selectionRouter.createCaller(context(readerId,"client"));
    expect(await selection.set({projectIds:[projectId,projectId,foreignProjectId,99999999]})).toMatchObject({count:1});
    expect(await selection.get()).toEqual([projectId]);
    const client = geometriesRouter.createCaller(context(readerId,"client"));
    expect((await client.listForProjects({projectIds:[projectId,foreignProjectId,99999999]})).every(row=>row.projectId===projectId)).toBe(true);
    expect((await client.listForProjects()).some(row=>row.id===orphanId)).toBe(true);
    expect(await client.listForProjects({projectIds:[]})).toEqual([]);
    const admin = geometriesRouter.createCaller(context(adminId,"admin"));
    await sql.query("INSERT INTO geometries (projectId,userId,type,name,coordinates) VALUES (?,?,'marker','Foreign point','[-15,-47]')",[foreignProjectId,outsiderId]);
    expect((await admin.listForProjects({projectIds:[foreignProjectId,99999999]})).map(row=>row.projectId)).toEqual([foreignProjectId]);
    await sql.query("DELETE FROM project_members WHERE projectId=? AND userId=?",[projectId,readerId]);
    expect(await selection.get()).toEqual([]);
    expect(await client.listForProjects()).toEqual([]);
    expect(await client.listForProjects({projectIds:[projectId]})).toEqual([]);
    await sql.query("INSERT INTO project_members (projectId,userId,role,addedBy) VALUES (?,?,'viewer',?)",[projectId,readerId,adminId]);
    passed("safe persisted/explicit project selection and revocation filtering; admin existence");
  });
  it("catalog uses only existing active bases and personal overrides, refusing missing/inactive ids", async () => {
    const client = basesRouter.createCaller(context(readerId,"client"));
    const base = (await client.catalog()).find(row=>row.id===baseId)!;
    expect(base).toMatchObject({source:"funai",layerType:"terras_indigenas",userVisible:false,downloadStatus:"pending"});
    await client.setVisibility({id:baseId,visible:true});
    expect((await client.catalog()).find(row=>row.id===baseId)?.userVisible).toBe(true);
    expect((await basesRouter.createCaller(context(editorId,"editor")).catalog()).find(row=>row.id===baseId)?.userVisible).toBe(false);
    expect((await client.catalog()).find(row=>row.id===inactiveBaseId)).toBeUndefined();
    await expect(client.setVisibility({id:inactiveBaseId,visible:true})).rejects.toMatchObject({code:"NOT_FOUND"});
    await expect(client.setVisibility({id:99999999,visible:true})).rejects.toMatchObject({code:"NOT_FOUND"});
    const [rows] = await sql.query<RowDataPacket[]>("SELECT downloadStatus,lastDownloadAt FROM base_layers WHERE id=?",[baseId]);
    expect(rows[0]).toMatchObject({downloadStatus:"pending",lastDownloadAt:null});
    passed("existing bases catalog/personal override; no download/new provider");
  });
  it("matches actual new SQL columns, index and atenaRuns required defaults", async () => {
    const [columns] = await sql.query<RowDataPacket[]>("SHOW COLUMNS FROM atena_runs");
    expect(columns.map(row=>row.Field)).toEqual(["id","projectId","userId","status","requestText","plan","idempotencyKey","codeVersion","skillVersions","inputs","outputs","steps","alerts","errorMessage","artifactKey","artifactCreatedAt","createdAt","startedAt","finishedAt"]);
    const [result] = await sql.execute("INSERT INTO atena_runs (projectId,userId,plan,idempotencyKey,codeVersion) VALUES (?,?,?,?,?)",[projectId,editorId,JSON.stringify({synthetic:true}),"hierarchy-schema-contract","synthetic-13bd34ef"]);
    const insertId = (result as {insertId:number}).insertId;
    const [runs] = await sql.query<RowDataPacket[]>("SELECT status,requestText,createdAt,startedAt,finishedAt FROM atena_runs WHERE id=?",[insertId]);
    expect(runs[0]).toMatchObject({status:"queued",requestText:null,startedAt:null,finishedAt:null});
    expect(runs[0].createdAt).toBeTruthy();
    const [indexes] = await sql.query<RowDataPacket[]>("SHOW INDEX FROM layers WHERE Key_name='layers_project_parent_sort_idx'");
    expect(indexes.map(row=>row.Column_name)).toEqual(["projectId","parentId","sortOrder","id"]);
    evidence.actualAtenaColumns = columns.map(row=>row.Field);
    passed("actual atenaRuns SQL fields/defaults and hierarchy composite index");
  });
});
