import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCapabilitiesUrl, normalizeOgcEndpoint, parseCapabilities, probeOgcCapabilities, selectOgcVariant } from "./ogcCatalogService";

let server: ReturnType<typeof createServer>;
let port: number;

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url?.startsWith("/wms")) {
      response.writeHead(200, { "content-type": "text/xml" });
      response.end("<?xml version='1.0'?><WMS_Capabilities><Capability><Layer><Name>demo_municipios</Name></Layer></Capability></WMS_Capabilities>");
      return;
    }
    if (request.url?.startsWith("/large")) {
      response.writeHead(200, { "content-type": "text/xml" });
      response.end("<WMS_Capabilities>" + "x".repeat(2 * 1024 * 1024 + 10) + "</WMS_Capabilities>");
      return;
    }
    response.writeHead(302, { location: "/wms" }); response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

describe("catálogo OGC seguro", () => {
  const testPolicy = { allowedHosts: [], allowTestHttp: true, allowTestLoopback: true } as const;

  it("normaliza somente endpoint HTTPS em host aprovado fora de testes", () => {
    const endpoint = normalizeOgcEndpoint("https://geoservicos.inde.gov.br/geoserver/ICMBio/ows", { allowedHosts: ["geoservicos.inde.gov.br"] });
    expect(buildCapabilitiesUrl(endpoint, "wms").toString()).toContain("SERVICE=WMS");
    expect(() => normalizeOgcEndpoint("http://geoservicos.inde.gov.br/ows", { allowedHosts: ["geoservicos.inde.gov.br"] })).toThrow("HTTPS");
    expect(() => normalizeOgcEndpoint("https://127.0.0.1/ows", { allowedHosts: [] })).toThrow("Host local");
    expect(() => normalizeOgcEndpoint("https://evil.example/ows?x=1", { allowedHosts: ["evil.example"] })).toThrow("query");
  });

  it("verifica WMS mockado sem permitir redirect ou corpo excessivo", async () => {
    const healthy = await probeOgcCapabilities(`http://127.0.0.1:${port}/wms`, "wms", testPolicy);
    expect(healthy.health).toBe("healthy");
    expect(healthy.capabilities?.remoteLayers).toContain("demo_municipios");
    const redirected = await probeOgcCapabilities(`http://127.0.0.1:${port}/redirect`, "wms", testPolicy);
    expect(redirected.health).toBe("http_error");
    const oversized = await probeOgcCapabilities(`http://127.0.0.1:${port}/large`, "wms", testPolicy);
    expect(oversized.health).toBe("invalid_capabilities");
  });

  it("rejeita DTD e seleciona fallback declarado de forma explícita", () => {
    expect(() => parseCapabilities("<!DOCTYPE a><WMS_Capabilities/>", "wms")).toThrow("DTD");
    const result = selectOgcVariant([
      { id: 1, logicalLayerId: 7, role: "primary", priority: 1, serviceType: "wms", endpoint: "https://a.example/ows", remoteLayer: "a", enabled: true, health: "tls_error" },
      { id: 2, logicalLayerId: 7, role: "fallback", priority: 2, serviceType: "wms", endpoint: "https://b.example/ows", remoteLayer: "b", enabled: true, health: "healthy" },
    ]);
    expect(result.selected?.id).toBe(2);
    expect(result.isFallback).toBe(true);
    expect(result.reason).toContain("tls_error");
  });
});
