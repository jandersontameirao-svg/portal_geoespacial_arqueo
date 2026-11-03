import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IBGE_MAX_BYTES,
  IBGE_PRESETS,
  IBGE_PROBE_BOUNDS,
  IBGE_REMOTE_LAYER,
} from "../shared/ibge";
import {
  assertIbgeEndpoint,
  buildIbgeWfsUrl,
  buildIbgeWmsProbeUrl,
  decodeIbgeCollection,
  probeIbgePreset,
  queryIbgeRemote,
} from "./ibgeRemote";
import { selectOgcVariant, type CatalogVariant } from "./ogcCatalogService";

// UNIT ONLY: responses are synthetic HTTP mocks. No DB, driver, upstream network or real IBGE proof.
const municipalFeature = {
  type: "Feature",
  properties: { CodMunic: "5300108" },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-48, -16],
        [-47, -16],
        [-47, -15],
        [-48, -16],
      ],
    ],
  },
};
const collection = (n = 1, matched: number | undefined = n) => ({
  type: "FeatureCollection",
  ...(matched === undefined ? {} : { totalFeatures: matched }),
  features: Array.from({ length: n }, () => municipalFeature),
});
function pngHeader() {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.write("IHDR", 12);
  png.writeUInt32BE(128, 16);
  png.writeUInt32BE(128, 20);
  return png;
}
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
function directedMock() {
  return vi.fn<typeof fetch>(async (url, init) => {
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const u = new URL(String(url));
    expect(u.hostname).toBe("geoservicos.ibge.gov.br");
    expect(
      u.searchParams.get("REQUEST") ?? u.searchParams.get("request")
    ).not.toBe("GetCapabilities");
    return u.pathname.endsWith("/wms")
      ? new Response(new Uint8Array(pngHeader()), {
          headers: { "content-type": "image/png" },
        })
      : json(collection());
  });
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("IBGE remote — unit HTTP mocks, no DB driver", () => {
  it("allows only exact fixed HTTPS endpoints, not query, www, arbitrary paths or protocols", () => {
    expect(assertIbgeEndpoint(IBGE_PRESETS[0].endpoint, "wms").protocol).toBe(
      "https:"
    );
    for (const endpoint of [
      IBGE_PRESETS[0].endpoint + "?x=1",
      "https://www.geoservicos.ibge.gov.br/geoserver/wms",
      "https://geoservicos.ibge.gov.br/other",
      "http://geoservicos.ibge.gov.br/geoserver/wms",
      IBGE_PRESETS[1].endpoint,
    ])
      expect(() => assertIbgeEndpoint(endpoint, "wms")).toThrow("preset");
  });
  it("uses WFS 1.0 lon/lat BBOX with EPSG suffix and no WFS 2 paging", () => {
    const u = buildIbgeWfsUrl(IBGE_PROBE_BOUNDS, 2);
    expect(u.searchParams.get("version")).toBe("1.0.0");
    expect(u.searchParams.get("typeName")).toBe(IBGE_REMOTE_LAYER);
    expect(u.searchParams.get("bbox")).toBe(
      "-47.89,-15.8,-47.88,-15.79,EPSG:4674"
    );
    expect(u.searchParams.get("maxFeatures")).toBe("2");
    expect(u.searchParams.has("count")).toBe(false);
    expect(buildIbgeWmsProbeUrl().searchParams.get("CRS")).toBe("EPSG:3857");
    expect(() =>
      buildIbgeWfsUrl({ west: 2, east: 1, south: 0, north: 1 }, 2)
    ).toThrow("Viewport");
  });
  it("records distinct targeted evidence, PNG signature/dimensions and one Brasília feature", async () => {
    const fetchMock = directedMock();
    const proof = await probeIbgePreset(fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(proof.healthCheck).toBe("targeted-layer-probe");
    expect(proof.wms.pngSignatureVerified).toBe(true);
    expect(proof.wfs.featureCount).toBe(1);
    expect(proof.wfs.municipalityCode).toBe("5300108");
    expect(proof.maxBytesPerResponse).toBe(4 * 1024 * 1024);
    expect(proof.strictTls).toBe(true);
  });
  it("rejects an HTML/error response masquerading as PNG", async () => {
    await expect(
      probeIbgePreset(
        vi.fn<typeof fetch>(async u =>
          String(u).includes("/wms?")
            ? new Response("not png", {
                headers: { "content-type": "image/png" },
              })
            : json(collection())
        )
      )
    ).rejects.toThrow("PNG");
  });
  it("does not approve failed HTTP, invalid GeoJSON or a different municipality", async () => {
    await expect(
      probeIbgePreset(
        vi.fn<typeof fetch>(
          async () => new Response("unavailable", { status: 503 })
        )
      )
    ).rejects.toThrow("503");
    expect(() =>
      decodeIbgeCollection(
        Buffer.from('{"type":"FeatureCollection","features":[{}]}')
      )
    ).toThrow("Feição");
    const wrong = {
      ...collection(),
      features: [{ ...municipalFeature, properties: { CodMunic: "1" } }],
    };
    await expect(
      probeIbgePreset(
        vi.fn<typeof fetch>(async u =>
          String(u).includes("/wms?")
            ? new Response(new Uint8Array(pngHeader()), {
                headers: { "content-type": "image/png" },
              })
            : json(wrong)
        )
      )
    ).rejects.toThrow("Brasília");
  });
  it("rejects advertised or streamed payloads exceeding 4 MiB", async () => {
    const oversized = vi.fn<typeof fetch>(
      async () =>
        new Response("x", {
          headers: { "content-length": String(IBGE_MAX_BYTES + 1) },
        })
    );
    await expect(
      queryIbgeRemote(
        { bounds: IBGE_PROBE_BOUNDS, decodeRemote: true },
        oversized
      )
    ).rejects.toThrow("4 MiB");
    const stream = vi.fn<typeof fetch>(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(IBGE_MAX_BYTES));
              c.enqueue(new Uint8Array(1));
              c.close();
            },
          }),
          { headers: { "content-type": "application/json" } }
        )
    );
    await expect(
      queryIbgeRemote({ bounds: IBGE_PROBE_BOUNDS, decodeRemote: true }, stream)
    ).rejects.toThrow("4 MiB");
  });
  it("uses an explicit temporary memory decode contract and limit+1 sentinel", async () => {
    const f = directedMock();
    const result = await queryIbgeRemote(
      { bounds: IBGE_PROBE_BOUNDS, decodeRemote: true },
      f
    );
    expect(
      new URL(String(f.mock.calls[0][0])).searchParams.get("maxFeatures")
    ).toBe("51");
    expect(result).toMatchObject({
      complete: true,
      matched: 1,
      truncated: false,
      attribution: "Fonte: IBGE",
    });
    expect(result.features[0].geometry).toEqual(municipalFeature.geometry);
    expect(result.metadata.persistence).toBe("none");
    await expect(
      queryIbgeRemote(
        { bounds: IBGE_PROBE_BOUNDS, decodeRemote: false as any },
        f
      )
    ).rejects.toThrow("decodeRemote");
    await expect(
      queryIbgeRemote(
        { bounds: IBGE_PROBE_BOUNDS, decodeRemote: true, limit: 201 },
        f
      )
    ).rejects.toThrow("entre 1 e 200");
  });
  it("rejects overflow and remote truncation rather than returning partial geometries", async () => {
    const run = (value: unknown) =>
      queryIbgeRemote(
        { bounds: IBGE_PROBE_BOUNDS, decodeRemote: true, limit: 1 },
        vi.fn<typeof fetch>(async () => json(value))
      );
    await expect(run(collection(2))).rejects.toThrow("truncada");
    await expect(run(collection(1, 50))).rejects.toThrow("truncada");
    expect(() =>
      decodeIbgeCollection(
        Buffer.from(JSON.stringify({ ...collection(), numberReturned: 2 }))
      )
    ).toThrow("incompleta");
  });
  it("rejects contradictory CRS and out-of-range longitude/latitude", () => {
    expect(() =>
      decodeIbgeCollection(
        Buffer.from(
          JSON.stringify({
            ...collection(),
            crs: { type: "name", properties: { name: "EPSG:3857" } },
          })
        )
      )
    ).toThrow("CRS");
    const bad = {
      ...collection(),
      features: [
        {
          ...municipalFeature,
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [181, 0],
                [182, 0],
                [182, 1],
                [181, 0],
              ],
            ],
          },
        },
      ],
    };
    expect(() =>
      decodeIbgeCollection(Buffer.from(JSON.stringify(bad)))
    ).toThrow("Geometria");
  });
  it("refuses operation when process TLS verification is disabled", async () => {
    vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0");
    const f = directedMock();
    await expect(
      queryIbgeRemote({ bounds: IBGE_PROBE_BOUNDS, decodeRemote: true }, f)
    ).rejects.toThrow("TLS estrito");
    expect(f).not.toHaveBeenCalled();
  });
  it("does not select a WFS fallback for a failed WMS primary", () => {
    const base: CatalogVariant = {
      id: 1,
      logicalLayerId: 1,
      role: "primary",
      priority: 1,
      serviceType: "wms",
      endpoint: "https://example.test/wms",
      remoteLayer: "test",
      enabled: true,
      health: "http_error",
    };
    expect(
      selectOgcVariant([
        base,
        {
          ...base,
          id: 2,
          role: "fallback",
          priority: 2,
          serviceType: "wfs",
          health: "healthy",
        },
      ]).selected
    ).toBeNull();
  });
});
