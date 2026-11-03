import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ addresses: [{ address: "8.8.8.8", family: 4 }], status: 200, contentType: "application/json", encoding: "identity", length: undefined as string | undefined, body: Buffer.from('{"success":true}'), tlsError: false, options: null as any, sockets: 0 }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => fake.addresses) }));
vi.mock("node:https", async () => {
  const { EventEmitter } = await import("node:events");
  return { request: vi.fn((_url: unknown, options: unknown, callback: (response: any) => void) => {
    fake.options = options; fake.sockets++;
    const request = new EventEmitter() as any;
    request.destroy = vi.fn();
    request.end = () => queueMicrotask(() => {
      if (fake.tlsError) { request.emit("error", new Error("certificate invalid")); return; }
      const response = new EventEmitter() as any;
      response.statusCode = fake.status;
      response.headers = { "content-type": fake.contentType, "content-encoding": fake.encoding, ...(fake.length ? { "content-length": fake.length } : {}) };
      response.destroy = vi.fn(); callback(response);
      response.emit("data", fake.body); response.emit("end");
    });
    return request;
  }) };
});
import { buildAneelSigaUrl, requestAneelSiga } from "./aneelSigaService";
beforeEach(() => Object.assign(fake, { addresses: [{ address: "8.8.8.8", family: 4 }], status: 200, contentType: "application/json", encoding: "identity", length: undefined, body: Buffer.from('{"success":true}'), tlsError: false, options: null, sockets: 0 }));
describe("ANEEL pinned socket", () => {
  it("uses HTTPS GET, strict certificates, JSON Accept, no reusable agent and pinned DNS", async () => {
    const r = await requestAneelSiga(buildAneelSigaUrl({ limit: 1 }));
    expect(r.status).toBe(200); expect(r.contentType).toBe("application/json");
    expect(fake.options).toMatchObject({ method: "GET", rejectUnauthorized: true, agent: false, servername: "dadosabertos.aneel.gov.br", headers: { Accept: "application/json", "Accept-Encoding": "identity" } });
    expect(typeof fake.options.lookup).toBe("function");
    fake.options.lookup("ignored", {}, (error: any, address: string, family: number) => { expect(error).toBeNull(); expect(address).toBe("8.8.8.8"); expect(family).toBe(4); });
  });
  it("blocks a private DNS address before opening a socket", async () => {
    fake.addresses = [{ address: "127.0.0.1", family: 4 }];
    await expect(requestAneelSiga(buildAneelSigaUrl({}))).rejects.toBeDefined(); expect(fake.sockets).toBe(0);
  });
  it("blocks a mixed public/private DNS answer", async () => {
    fake.addresses.push({ address: "10.1.2.3", family: 4 });
    await expect(requestAneelSiga(buildAneelSigaUrl({}))).rejects.toBeDefined(); expect(fake.sockets).toBe(0);
  });
  it.each([301, 302, 403, 500])("does not follow redirects or accept HTTP %i", async status => {
    fake.status = status; await expect(requestAneelSiga(buildAneelSigaUrl({}))).rejects.toMatchObject({ code: "BAD_GATEWAY" }); expect(fake.sockets).toBe(1);
  });
  it("rejects HTML instead of treating HTTP 200 as a JSON success", async () => {
    fake.contentType = "text/html"; await expect(requestAneelSiga(buildAneelSigaUrl({}))).rejects.toMatchObject({ code: "BAD_GATEWAY" });
  });
  it("rejects compressed content", async () => {
    fake.encoding = "gzip"; await expect(requestAneelSiga(buildAneelSigaUrl({}))).rejects.toMatchObject({ code: "BAD_GATEWAY" });
  });
  it("rejects excessive content-length before reading", async () => {
    fake.length = String(1024 * 1024 + 1); await expect(requestAneelSiga(buildAneelSigaUrl({}))).rejects.toMatchObject({ code: "BAD_GATEWAY" });
  });
  it("enforces streaming size even without content-length", async () => {
    fake.body = Buffer.alloc(1024 * 1024 + 1); await expect(requestAneelSiga(buildAneelSigaUrl({}))).rejects.toMatchObject({ code: "BAD_GATEWAY" });
  });
  it("reports TLS failure without bypassing validation or retrying", async () => {
    fake.tlsError = true; await expect(requestAneelSiga(buildAneelSigaUrl({}))).rejects.toMatchObject({ code: "BAD_GATEWAY", message: "Falha HTTPS/TLS na ANEEL; certificado estrito obrigatório." }); expect(fake.sockets).toBe(1);
  });
});
