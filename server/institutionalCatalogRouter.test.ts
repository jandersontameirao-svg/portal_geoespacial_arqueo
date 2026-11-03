import { describe, expect, it, vi } from "vitest";
vi.mock("./db", () => ({ getDb: vi.fn(async () => null) }));
import { institutionalCatalogRouter } from "./institutionalCatalogRouter";
import type { TrpcContext } from "./_core/context";
const context = (role: "admin" | "client" | null) =>
  ({
    user: role ? { id: 42, role, name: "Unit fixture, not OAuth" } : null,
    req: { headers: {} },
    res: {},
  }) as TrpcContext;
describe("institutional router — unit only, database unavailable and no external HTTP", () => {
  it("denies all anonymous procedures", async () => {
    const caller = institutionalCatalogRouter.createCaller(context(null));
    await expect(caller.listSources()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      caller.registerSource({ publisher: "IPHAN" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller.queryViewport({
        variantId: 1,
        bbox: { west: 0, south: 0, east: 1, north: 1 },
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("exposes blocked sources and proved protocol capabilities honestly", async () => {
    const sources = await institutionalCatalogRouter
      .createCaller(context("client"))
      .listSources();
    expect(sources).toHaveLength(3);
    expect(sources.find(s => s.publisher === "IPHAN")).toMatchObject({
      status: "validated",
      supportsWms: true,
      supportsWfs: true,
      registeredTypes: [],
      wmsVersion: "1.1.1",
    });
    for (const publisher of ["FUNAI", "INCRA"])
      expect(sources.find(s => s.publisher === publisher)).toMatchObject({
        status: "blocked",
        supportsWms: false,
        supportsWfs: false,
        registeredTypes: [],
      });
  });
  it("denies readers and refuses admin writes when database unavailable", async () => {
    await expect(
      institutionalCatalogRouter
        .createCaller(context("client"))
        .registerSource({ publisher: "IPHAN" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      institutionalCatalogRouter
        .createCaller(context("admin"))
        .registerSource({ publisher: "IPHAN" })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
  it("rejects arbitrary endpoint input and oversized viewport", async () => {
    const caller = institutionalCatalogRouter.createCaller(context("admin"));
    await expect(
      caller.registerSource({
        publisher: "IPHAN",
        endpoint: "https://evil.test",
      } as any)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.queryViewport({
        variantId: 1,
        bbox: { west: 0, south: 0, east: 3, north: 1 },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
