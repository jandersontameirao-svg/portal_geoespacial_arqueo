import { describe, expect, it, vi } from "vitest";
import { ANEEL_SIGA_RESOURCE_ID, ANEEL_SIGA_ENDPOINT } from "../shared/aneelSiga";
import { buildAneelSigaUrl, createAneelSigaService, parseSigaDecimal, parseSigaResponse, requestAneelSiga } from "./aneelSigaService";
import { createAneelSigaRouter } from "./aneelSigaRouter";
import type { TrpcContext } from "./_core/context";
const fields = ["_id", "NomEmpreendimento", "CodCEG", "SigUFPrincipal", "DscFaseUsina", "DatGeracaoConjuntoDados", "NumCoordNEmpreendimento", "NumCoordEEmpreendimento"];
function row(id = 1) { return { _id: id, NomEmpreendimento: "Usina sintética", CodCEG: "PCH.PH.MG.000001-0.1", SigUFPrincipal: "MG", DscFaseUsina: "Operação", DscTipoOutorga: "Autorização", DatGeracaoConjuntoDados: "2026-11-02", NumCoordNEmpreendimento: "-20,123", NumCoordEEmpreendimento: "-43,456", MdaPotenciaOutorgadaKw: "1200,5", MdaPotenciaFiscalizadaKw: "1000,0" }; }
function payload(records = [row()]) { return { success: true, result: { resource_id: ANEEL_SIGA_RESOURCE_ID, total: 25046, fields: fields.map(id => ({ id, type: id === "_id" ? "int" : "text" })), records } }; }
const bytes = (data: unknown) => Buffer.from(JSON.stringify(data));
const response = () => ({ status: 200, contentType: "application/json; charset=utf-8", body: bytes(payload()) });
const ctx = (authenticated: boolean) => ({ user: authenticated ? { id: 1, role: "user", openId: "synthetic" } : null, req: { headers: {} }, res: {} }) as TrpcContext;

describe("ANEEL fixed query and decimals", () => {
  it("pins endpoint/resource and uses validated UF and stable record ordering", () => {
    const url = buildAneelSigaUrl({ limit: 20, offset: 40, uf: "BA" });
    expect(url.origin + url.pathname).toBe(ANEEL_SIGA_ENDPOINT);
    expect(url.searchParams.get("resource_id")).toBe(ANEEL_SIGA_RESOURCE_ID);
    expect(url.searchParams.get("filters")).toBe('{"SigUFPrincipal":"BA"}');
    expect(url.searchParams.get("sort")).toBe("_id asc");
  });
  it.each([{ offset: -1 }, { offset: 1.5 }, { offset: 1000001 }, { limit: 0 }, { limit: 51 }, { limit: 1.2 }, { uf: "XX" }, { uf: "ba" }, { uf: "BA' OR 1=1" }])("rejects invalid limits or UF %j", input => {
    expect(() => buildAneelSigaUrl(input)).toThrow();
  });
  it.each([["-20,123", -20.123], ["1200.5", 1200.5], [" 0 ", 0], ["", null], ["1.000,5", null], ["12abc", null], ["Infinity", null], [null, null]])("parses decimal %j", (value, expected) => expect(parseSigaDecimal(value)).toBe(expected));
  it("does not request an arbitrary or credentialed URL", async () => {
    await expect(requestAneelSiga(new URL("https://127.0.0.1/private"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requestAneelSiga(new URL("https://u:p@dadosabertos.aneel.gov.br/api/3/action/datastore_search?resource_id=" + ANEEL_SIGA_RESOURCE_ID))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("ANEEL response validation", () => {
  it("returns selected fields and provenance without geometry or claimed CRS", () => {
    const p = parseSigaResponse(bytes(payload()), {}, new Date("2026-11-03T03:00:00Z"));
    expect(p.totalRecords).toBe(25046); expect(p.queriedAt).toBe("2026-11-03T03:00:00.000Z");
    expect(p.attribution).toBe("Fonte: ANEEL — SIGA"); expect(p.license).toBe("ODbL");
    expect(p.rows[0].authorizedPowerKw).toBe(1200.5); expect(p.rows[0].centroid.crs).toBeNull();
    expect(p.preciseMapAvailable).toBe(false); expect(p.rows[0]).not.toHaveProperty("geometry");
  });
  it("preserves different records with the same CEG and does not total their power", () => {
    const p = parseSigaResponse(bytes(payload([row(1), { ...row(2), DscTipoOutorga: "Registro" }])), {});
    expect(p.rows).toHaveLength(2); expect(p.rows[0].ceg).toBe(p.rows[1].ceg); expect(p).not.toHaveProperty("totalPowerKw");
  });
  it("rejects duplicate record identifiers rather than silently merging", () => expect(() => parseSigaResponse(bytes(payload([row(1), row(1)])), {})).toThrow());
  it("nulls an invalid pair of coordinates and a negative power", () => {
    const r = { ...row(), NumCoordNEmpreendimento: "91", MdaPotenciaOutorgadaKw: "-10" };
    const p = parseSigaResponse(bytes(payload([r])), {}); expect(p.rows[0].centroid.latitude).toBeNull(); expect(p.rows[0].centroid.longitude).toBeNull(); expect(p.rows[0].authorizedPowerKw).toBeNull();
  });
  it("blocks an unrelated resource response", () => {
    const d = payload(); d.result.resource_id = "other"; expect(() => parseSigaResponse(bytes(d), {})).toThrow();
  });
  it("blocks a changed required schema", () => {
    const d = payload(); d.result.fields.pop(); expect(() => parseSigaResponse(bytes(d), {})).toThrow();
  });
  it("blocks logical CKAN failure, HTML and oversized response", () => {
    expect(() => parseSigaResponse(bytes({ success: false }), {})).toThrow();
    expect(() => parseSigaResponse(Buffer.from("<html>200</html>"), {})).toThrow();
    expect(() => parseSigaResponse(Buffer.alloc(1024 * 1024 + 1), {})).toThrow();
  });
  it("blocks more rows than requested", () => expect(() => parseSigaResponse(bytes(payload([row(1), row(2)])), { limit: 1 })).toThrow());
  it("allows an empty last page without looping", () => {
    const p = parseSigaResponse(bytes(payload([])), { offset: 25046 }); expect(p.rows).toHaveLength(0); expect(p.hasNext).toBe(false);
  });
  it("rejects excessive or non-text names", () => {
    expect(() => parseSigaResponse(bytes(payload([{ ...row(), NomEmpreendimento: "x".repeat(1025) }])), {})).toThrow();
  });
});

describe("ANEEL service safety and manual refresh", () => {
  it("performs a fresh bounded GET for each manual query, without persistent cache", async () => {
    const transport = vi.fn().mockResolvedValue(response()); const service = createAneelSigaService(transport);
    await service.query({ uf: "MG", limit: 1 }); await service.query({ uf: "MG", limit: 1 });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it.each([302, 403, 500])("rejects HTTP %i even if a valid JSON body exists", async status => {
    const service = createAneelSigaService(async () => ({ ...response(), status })); await expect(service.query()).rejects.toMatchObject({ code: "BAD_GATEWAY" });
  });
  it("rejects a non-JSON MIME instead of displaying it as ready", async () => {
    const service = createAneelSigaService(async () => ({ ...response(), contentType: "text/html" })); await expect(service.query()).rejects.toMatchObject({ code: "BAD_GATEWAY" });
  });
  it("does not expose arbitrary transport errors or external content", async () => {
    const service = createAneelSigaService(async () => { throw new Error("sensitive remote body"); });
    await expect(service.query()).rejects.toMatchObject({ message: "Não foi possível consultar os dados oficiais ANEEL/SIGA." });
  });
  it("limits pending requests and releases the budget after completion", async () => {
    let finish!: () => void; const gate = new Promise<void>(resolve => { finish = resolve; });
    const service = createAneelSigaService(async () => { await gate; return response(); });
    const pending = Array.from({ length: 4 }, () => service.query());
    await expect(service.query()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" }); finish(); await Promise.all(pending); await service.query();
  });
});

describe("ANEEL protected tRPC", () => {
  it("blocks an unauthenticated caller before network access", async () => {
    const query = vi.fn(); const caller = createAneelSigaRouter({ query }).createCaller(ctx(false));
    await expect(caller.query({})).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(query).not.toHaveBeenCalled();
  });
  it("allows bounded read-only consultation by the existing authenticated user role", async () => {
    const query = vi.fn().mockResolvedValue(parseSigaResponse(bytes(payload()), {}));
    const caller = createAneelSigaRouter({ query }).createCaller(ctx(true));
    expect((await caller.query({ uf: "MG" })).attribution).toBe("Fonte: ANEEL — SIGA"); expect(query).toHaveBeenCalledWith({ limit: 20, offset: 0, uf: "MG" });
  });
  it.each([{ endpoint: "https://127.0.0.1/" }, { resource_id: "other" }, { sql: "select *" }, { uf: "XX" }, { limit: 51 }])("rejects untrusted route payload %j", async input => {
    const query = vi.fn(); const caller = createAneelSigaRouter({ query }).createCaller(ctx(true));
    await expect(caller.query(input as any)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(query).not.toHaveBeenCalled();
  });
});
