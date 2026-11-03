import { describe, expect, it, vi } from "vitest";
import { createIndeCatalogRouter } from "./indeCatalogRouter";
import {
  IndeCatalogError,
  type IndeCatalogService,
} from "./indeCatalogService";
import type { TrpcContext } from "./_core/context";

const context = (authenticated: boolean) =>
  ({
    user: authenticated
      ? {
          id: 1,
          openId: "synthetic",
          name: "Synthetic",
          role: "user",
          email: null,
          loginMethod: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastSignedIn: new Date(),
        }
      : null,
    req: { headers: {}, protocol: "https" },
    res: {},
  }) as TrpcContext;
const mapInput = {
  organizationId: "synthetic",
  layerName: "test:layer",
  bounds: [-180, -90, 180, 90] as [number, number, number, number],
  width: 512,
  height: 256,
  crs: "EPSG:4326" as const,
};
function serviceMock() {
  const service = {
    organizations: vi
      .fn()
      .mockReturnValue({
        organizations: [],
        sourceUrl: "https://visualizador.inde.gov.br/api/buscacamada",
        fetchedAt: "date",
        listFetchedAt: "date",
      }),
    layers: vi
      .fn()
      .mockResolvedValue({
        organizationId: "synthetic",
        layers: [],
        version: "1.1.1",
        fetchedAt: "date",
        capabilitySha256: "hash",
        truncated: false,
      }),
    mapImage: vi
      .fn()
      .mockResolvedValue({
        dataUrl: "data:image/png;base64,synthetic",
        crs: "EPSG:4326",
        bounds: mapInput.bounds,
        attribution: "Fonte: sintética — catálogo INDE",
      }),
  };
  return service;
}

describe("INDE protected router", () => {
  it("rejects all unauthenticated queries before service/network access", async () => {
    const service = serviceMock();
    const caller = createIndeCatalogRouter(service).createCaller(
      context(false)
    );
    await expect(caller.organizations()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      caller.layers({ organizationId: "synthetic" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.mapImage(mapInput)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    for (const method of Object.values(service))
      expect(method).not.toHaveBeenCalled();
  });
  it("exposes the stable typed contracts to authenticated users", async () => {
    const service = serviceMock();
    const caller = createIndeCatalogRouter(service).createCaller(context(true));
    expect(await caller.organizations()).toHaveProperty("sourceUrl");
    expect(await caller.layers({ organizationId: "synthetic" })).toHaveProperty(
      "truncated",
      false
    );
    expect(await caller.mapImage(mapInput)).toHaveProperty("dataUrl");
    expect(service.layers).toHaveBeenCalledWith("synthetic");
    expect(service.mapImage).toHaveBeenCalledWith(mapInput);
  });
  it.each([
    { layerName: "a,b" },
    { layerName: "bad\n" },
    { width: 1025 },
    { height: 513 },
    { crs: "EPSG:4674" },
    { bounds: [0, 0, 1] },
    { endpoint: "https://attacker.invalid" },
  ])("rejects malformed renderer input before service: %j", async change => {
    const service = serviceMock();
    const caller = createIndeCatalogRouter(service).createCaller(context(true));
    await expect(
      caller.mapImage({ ...mapInput, ...change } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(service.mapImage).not.toHaveBeenCalled();
  });
  it("does not accept arbitrary endpoint/URL parameters in layers", async () => {
    const service = serviceMock();
    const caller = createIndeCatalogRouter(service).createCaller(context(true));
    await expect(
      caller.layers({
        organizationId: "synthetic",
        url: "https://attacker.invalid",
      } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(service.layers).not.toHaveBeenCalled();
  });
  it("maps safe service errors and hides unexpected internals", async () => {
    const service = serviceMock();
    const caller = createIndeCatalogRouter(service).createCaller(context(true));
    service.layers.mockRejectedValueOnce(
      new IndeCatalogError("FORBIDDEN", "Origem HTTP bloqueada")
    );
    await expect(
      caller.layers({ organizationId: "synthetic" })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Origem HTTP bloqueada",
    });
    service.layers.mockRejectedValueOnce(new Error("secret upstream data"));
    await expect(
      caller.layers({ organizationId: "synthetic" })
    ).rejects.toMatchObject({
      code: "BAD_GATEWAY",
      message: "Não foi possível consultar a origem WMS do catálogo INDE.",
    });
  });
});
