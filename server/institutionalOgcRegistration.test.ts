import { afterEach, describe, expect, it, vi } from "vitest";
import * as config from "../shared/institutionalOgc";
import {
  isExactInstitutionalPair,
  isInstitutionalCatalogEntry,
  registerInstitutionalSource,
} from "./institutionalOgcRegistration";
import { fingerprintOgcEndpoint } from "./ogcEndpointIdentity";
const source: config.InstitutionalSource = {
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
  probeBounds: { west: -48, south: -16, east: -47.99, north: -15.99 },
  provenance: ["synthetic-test-only"],
  protocols: {
    wms: {
      endpoint: "https://geoserver.iphan.gov.br/geoserver/ows",
      version: "1.1.1",
      verified: true,
      axisOrder: "longitude,latitude",
      displayCrs: "EPSG:3857",
    },
  },
};
const actor = { id: 42, role: "admin", name: "Synthetic real actor argument" };
const proof = {
  publisher: "IPHAN",
  presetId: source.presetId,
  edition: source.edition,
  remoteLayer: source.remoteLayer,
  healthy: true,
  healthCheck: "targeted-layer-probe",
  strictTls: true,
  redirect: "error",
  probedAt: new Date().toISOString(),
  protocols: {
    wms: {
      httpStatus: 200,
      crs: "EPSG:3857",
      axisOrder: "longitude,latitude",
      version: "1.1.1",
    },
  },
} as const;
function db(services: any[] = [], variants: any[] = []) {
  let reads = 0;
  let id = 10;
  const writes: any[] = [];
  const tx = {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          for: vi.fn(async () => (++reads === 1 ? services : variants)),
        }),
      }),
    })),
    insert: vi.fn(table => ({
      values: vi.fn(async values => {
        writes.push({ table, values });
        return [{ insertId: id++ }];
      }),
    })),
  };
  const database = { transaction: vi.fn(async callback => callback(tx)) };
  return { database: database as any, tx, writes };
}
afterEach(() => vi.restoreAllMocks());
describe("institutional registration — unit fixtures only, no database or external HTTP", () => {
  it("denies non-admin actor before probe or transaction", async () => {
    const d = db();
    const probe = vi.fn();
    await expect(
      registerInstitutionalSource({
        database: d.database,
        actor: { ...actor, role: "client" },
        publisher: "IPHAN",
        probe,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(probe).not.toHaveBeenCalled();
    expect(d.database.transaction).not.toHaveBeenCalled();
  });
  it("blocks all unproven registry sources without DB reads/writes", async () => {
    const d = db();
    const probe = vi.fn();
    for (const publisher of ["FUNAI", "INCRA"] as const)
      await expect(
        registerInstitutionalSource({
          database: d.database,
          actor,
          publisher,
          probe,
        })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(d.database.transaction).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  });
  it("rejects repeated WMS/WFS endpoint identities without silently changing hash", async () => {
    vi.spyOn(config, "getInstitutionalSource").mockReturnValue({
      ...source,
      protocols: {
        ...source.protocols,
        wfs: { ...source.protocols.wms!, version: "2.0.0" },
      },
    });
    const d = db();
    await expect(
      registerInstitutionalSource({
        database: d.database,
        actor,
        publisher: "IPHAN",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(d.database.transaction).not.toHaveBeenCalled();
  });
  it("does not insert on current probe failure or invalid proof", async () => {
    vi.spyOn(config, "getInstitutionalSource").mockReturnValue(source);
    for (const probe of [
      vi.fn(async () => {
        throw Error("HTTP 503");
      }),
      vi.fn(async () => ({ ...proof, healthy: false }) as any),
    ]) {
      const d = db();
      await expect(
        registerInstitutionalSource({
          database: d.database,
          actor,
          publisher: "IPHAN",
          probe,
        })
      ).rejects.toThrow();
      expect(d.writes).toHaveLength(0);
    }
  });
  it("writes only service, variant and audits inside a default transaction", async () => {
    vi.spyOn(config, "getInstitutionalSource").mockReturnValue(source);
    const d = db();
    const probe = vi.fn(async () => proof as any);
    const result = await registerInstitutionalSource({
      database: d.database,
      actor,
      publisher: "IPHAN",
      probe,
    });
    expect(result.idempotent).toBe(false);
    expect(probe).toHaveBeenCalledOnce();
    expect(d.database.transaction.mock.calls[0]).toHaveLength(1);
    expect(d.writes).toHaveLength(4);
    expect(d.writes[0].values.createdBy).toBe(42);
    expect(d.writes[0].values.endpointHash).toBe(
      fingerprintOgcEndpoint(source.protocols.wms!.endpoint)
    );
    expect(d.writes[2].values.userId).toBe(42);
  });
  it("returns exact existing pair idempotently but conflicts on mutated metadata", async () => {
    vi.spyOn(config, "getInstitutionalSource").mockReturnValue(source);
    const service = {
      id: 10,
      name: `${source.label} — ${source.title} (WMS)`,
      endpoint: source.protocols.wms!.endpoint,
      endpointHash: fingerprintOgcEndpoint(source.protocols.wms!.endpoint),
      publisher: "IPHAN",
      serviceType: "wms",
      sourceClass: "official",
      status: "published",
      enabled: true,
      health: "healthy",
      capabilities: {
        presetId: source.presetId,
        edition: source.edition,
        healthCheck: "targeted-layer-probe",
        sourceCrs: source.sourceCrs,
        axisOrder: "longitude,latitude",
        version: "1.1.1",
      },
    };
    const variant = {
      id: 11,
      serviceId: 10,
      logicalLayer: "iphan:test:wms",
      remoteLayer: source.remoteLayer,
      role: "primary",
      priority: 1,
      displayCrs: "EPSG:3857",
      attribution: source.attribution,
      enabled: true,
    };
    expect(
      isExactInstitutionalPair(service as any, variant as any, source)
    ).toBe(true);
    const d = db([service], [variant]);
    expect(
      (
        await registerInstitutionalSource({
          database: d.database,
          actor,
          publisher: "IPHAN",
          probe: async () => proof as any,
        })
      ).idempotent
    ).toBe(true);
    expect(d.writes).toHaveLength(0);
    const bad = db([{ ...service, health: "http_error" }], [variant]);
    await expect(
      registerInstitutionalSource({
        database: bad.database,
        actor,
        publisher: "IPHAN",
        probe: async () => proof as any,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(bad.writes).toHaveLength(0);
  });
  it("classifies known sources for import denial even when records are malformed", () => {
    expect(
      isInstitutionalCatalogEntry({
        endpoint: "https://evil.test",
        publisher: "FUNAI",
      })
    ).toBe(true);
    expect(
      isInstitutionalCatalogEntry({
        endpoint: "https://geoserver.iphan.gov.br/geoserver/ows",
      })
    ).toBe(true);
    expect(
      isInstitutionalCatalogEntry(
        { endpoint: "https://other.test" },
        { remoteLayer: "x", logicalLayer: "incra:territorios-quilombolas:wfs" }
      )
    ).toBe(true);
    expect(
      isInstitutionalCatalogEntry({
        endpoint: "https://other.test",
        publisher: "CUSTOM",
      })
    ).toBe(false);
  });
});
