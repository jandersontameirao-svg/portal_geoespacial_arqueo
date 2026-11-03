import { afterEach, describe, expect, it, vi } from "vitest";
import * as config from "../shared/institutionalOgc";
import {
  assertInstitutionalEndpoint,
  buildInstitutionalWfsUrl,
  decodeInstitutionalCollection,
  probeInstitutionalSource,
  queryInstitutionalRemote,
  validateInstitutionalBounds,
} from "./institutionalOgcRemote";
const bounds = { west: -48, south: -16, east: -47.99, north: -15.99 };
const fixture: config.InstitutionalSource = {
  publisher: "IPHAN",
  label: "TEST ONLY",
  title: "Synthetic source",
  edition: "synthetic",
  presetId: "test-only",
  stableTheme: "test",
  attribution: "Fonte sintética",
  sourceCrs: "EPSG:4674",
  remoteLayer: "synthetic:point",
  disabled: false,
  blocker: null,
  probeBounds: bounds,
  provenance: ["synthetic-test-only"],
  protocols: {
    wfs: {
      endpoint: "https://geoserver.iphan.gov.br/geoserver/ows",
      version: "2.0.0",
      verified: true,
      axisOrder: "longitude,latitude",
      displayCrs: "EPSG:4674",
    },
  },
};
const feature = {
  type: "Feature",
  properties: { name: "<script>not HTML</script>" },
  geometry: { type: "Point", coordinates: [-48, -16] },
};
const raw = (
  features: any[] = [feature],
  extra: Record<string, unknown> = {}
) =>
  Buffer.from(
    JSON.stringify({ type: "FeatureCollection", features, ...extra })
  );
function enabled() {
  vi.spyOn(config, "getInstitutionalSource").mockReturnValue(fixture);
}
const fakeFetch = (
  body: Buffer,
  headers: Record<string, string> = { "content-type": "application/json" }
) =>
  vi.fn(
    async () => new Response(new Uint8Array(body), { headers })
  ) as unknown as typeof fetch;
afterEach(() => vi.restoreAllMocks());
describe("institutional remote — synthetic HTTP fixtures only; no database", () => {
  it("keeps unproven registry entries blocked and never probes network", async () => {
    const fetchMock = vi.fn();
    expect(config.INSTITUTIONAL_SOURCES).toHaveLength(3);
    for (const source of config.INSTITUTIONAL_SOURCES.filter(s => s.disabled)) {
      expect(source.disabled).toBe(true);
      await expect(
        probeInstitutionalSource(source.publisher, fetchMock)
      ).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects arbitrary URLs, credentials, queries and paths", () => {
    for (const url of [
      "http://geoserver.iphan.gov.br/geoserver/ows",
      "https://evil.test/ows",
      "https://geoserver.iphan.gov.br/geoserver/ows?x=1",
      "https://u:p@geoserver.iphan.gov.br/geoserver/ows",
    ])
      expect(() => assertInstitutionalEndpoint("IPHAN", "wfs", url)).toThrow();
  });
  it("rejects excessive viewport and antimeridian", () => {
    for (const b of [
      { ...bounds, east: -40 },
      { ...bounds, north: 0 },
      { ...bounds, west: 179, east: -179 },
      { ...bounds, west: NaN },
    ])
      expect(() => validateInstitutionalBounds(b)).toThrow();
  });
  it("uses fixed WFS2 layer, verified XY CRS and max+1", () => {
    enabled();
    const url = buildInstitutionalWfsUrl("IPHAN", bounds, 51);
    expect(url.searchParams.get("count")).toBe("51");
    expect(url.searchParams.get("typeNames")).toBe("synthetic:point");
    expect(url.searchParams.get("bbox")).toBe(
      "-48,-16,-47.99,-15.99,EPSG:4674"
    );
  });
  it("supports safe geometry types and preserves plain text (UI must escape)", () => {
    const geometries = [
      feature.geometry,
      { type: "MultiPoint", coordinates: [[-48, -16]] },
      {
        type: "LineString",
        coordinates: [
          [-48, -16],
          [-47.99, -15.99],
        ],
      },
      {
        type: "MultiLineString",
        coordinates: [
          [
            [-48, -16],
            [-47.99, -15.99],
          ],
        ],
      },
      {
        type: "Polygon",
        coordinates: [
          [
            [-48, -16],
            [-47.99, -16],
            [-47.99, -15.99],
            [-48, -16],
          ],
        ],
      },
      {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [-48, -16],
              [-47.99, -16],
              [-47.99, -15.99],
              [-48, -16],
            ],
          ],
        ],
      },
      { type: "GeometryCollection", geometries: [feature.geometry] },
    ];
    for (const geometry of geometries) {
      const result = decodeInstitutionalCollection(
        raw([{ ...feature, geometry }]),
        "EPSG:4674"
      );
      expect(result.collection.features[0].geometry.type).toBe(geometry.type);
      expect(result.collection.features[0].properties?.name).toContain(
        "<script>"
      );
    }
  });
  it("rejects unsafe coordinates, rings, CRS, counts and prototype keys", () => {
    const bad = [
      raw([{ ...feature, geometry: { type: "Point", coordinates: [181, 0] } }]),
      raw([
        {
          ...feature,
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
              ],
            ],
          },
        },
      ]),
      raw([feature], {
        crs: { type: "name", properties: { name: "EPSG:3857" } },
      }),
      raw([feature], { numberMatched: 0 }),
      Buffer.from(
        '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"__proto__":{}},"geometry":{"type":"Point","coordinates":[0,0]}}]}'
      ),
    ];
    for (const body of bad)
      expect(() => decodeInstitutionalCollection(body, "EPSG:4674")).toThrow();
  });
  it("enforces TLS defaults, redirect:error, 10s and complete bounded response", async () => {
    enabled();
    const fetchMock = fakeFetch(raw());
    const result = await queryInstitutionalRemote(
      { publisher: "IPHAN", bounds, limit: 50 },
      fetchMock
    );
    expect(result.complete).toBe(true);
    expect(result.featureCount).toBe(1);
    expect(result.metadata.persistence).toBe("none");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        redirect: "error",
        signal: expect.any(AbortSignal),
      })
    );
    await expect(
      queryInstitutionalRemote(
        { publisher: "IPHAN", bounds, limit: 1 },
        fakeFetch(raw([feature, feature]))
      )
    ).rejects.toThrow(/truncada/);
    await expect(
      queryInstitutionalRemote(
        { publisher: "IPHAN", bounds },
        fakeFetch(raw([feature], { numberMatched: 2 }))
      )
    ).rejects.toThrow(/truncada/);
    await expect(
      queryInstitutionalRemote(
        { publisher: "IPHAN", bounds },
        fakeFetch(raw(), {
          "content-type": "application/json",
          "content-length": "4194305",
        })
      )
    ).rejects.toThrow(/4 MiB/);
    await expect(
      queryInstitutionalRemote(
        { publisher: "IPHAN", bounds },
        vi.fn(async () => new Response("unavailable", { status: 503 })) as any
      )
    ).rejects.toThrow("503");
  });
});
