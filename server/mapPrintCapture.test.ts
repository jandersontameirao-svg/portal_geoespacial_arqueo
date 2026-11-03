import { afterEach, describe, expect, it, vi } from "vitest";
import type * as L from "leaflet";
import { captureMapSnapshot, inspectMapPrintTiles, mapPrintMutationAffectsCapture, MapPrintCaptureError } from "../client/src/lib/captureMapSnapshot";

// No jsdom or mocked successful screenshot. Pure DOM-shaped fixtures below test
// readiness only; real rendering, CORS, SVG colors and UI/PDF belong to the browser.
describe("map snapshot early pure guards", () => {
  it("rejects missing browser/map with a useful initialized-map error", async () => {
    await expect(captureMapSnapshot(null as unknown as L.Map)).rejects.toMatchObject({
      code: "MAP_UNINITIALIZED", name: "MapPrintCaptureError",
    });
  });
  it.each([0, -1, Infinity, NaN, 60_001])("rejects invalid timeout %s before allocating capture resources", async timeoutMs => {
    await expect(captureMapSnapshot(null as unknown as L.Map, { timeoutMs })).rejects.toMatchObject({ code: "TIMEOUT_OPTION" });
  });
  it("honors a pre-aborted signal rather than starting a capture", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(captureMapSnapshot(null as unknown as L.Map, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
  it("includes optional diagnostic context only as plain error text", async () => {
    await expect(captureMapSnapshot(null as unknown as L.Map, { label: "Projeto local" })).rejects.toThrow(/Projeto local: Mapa Leaflet/);
  });
  it("exports an error with stable code for interface diagnosis", () => {
    const error = new MapPrintCaptureError("CORS", "Provedor sem permissão");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("CORS");
    expect(error.name).toBe("MapPrintCaptureError");
  });
});

function rectangle(left = 0, top = 0, width = 256, height = 256) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function tileFixture() {
  type FakeElement = ReturnType<typeof element>;
  const document = {
    defaultView: { getComputedStyle: (node: FakeElement) => node.style },
  };
  function element(tagName = "DIV", parentElement: FakeElement | null = null, rect = rectangle()) {
    const children: FakeElement[] = [];
    const classes = new Set<string>();
    const node = {
      tagName, parentElement, children, ownerDocument: document, classes, nodeType: 1,
      isConnected: true, clientWidth: rect.width, clientHeight: rect.height,
      style: { display: "block", visibility: "visible", opacity: "1" },
      classList: { contains: (name: string) => classes.has(name) },
      closest: (_selector: string) => null,
      getBoundingClientRect: () => rect,
      contains(other: FakeElement): boolean { return node === other || children.some(child => child.contains(other)); },
      querySelectorAll<T = FakeElement>(selector: string): T[] {
        return children.flatMap(child => [
          ...(selector === "*" || child.tagName.toLowerCase() === selector ? [child as unknown as T] : []),
          ...child.querySelectorAll<T>(selector),
        ]);
      },
    };
    parentElement?.children.push(node);
    return node;
  }
  const container = element("DIV", null, rectangle(100, 50, 800, 400));
  const group = element("DIV", container);
  const root = element("DIV", group);
  let zoom = 10;
  const layers: unknown[] = [];
  const map = {
    _loaded: true,
    options: { crs: { code: "EPSG:3857" } },
    getContainer: () => container,
    getZoom: () => zoom,
    getSize: () => ({ x: 800, y: 400 }),
    getBounds: () => ({ getNorth: () => 1, getSouth: () => -1, getEast: () => 1, getWest: () => -1 }),
    eachLayer: (visit: (layer: unknown) => void) => layers.forEach(visit),
    on: vi.fn(), off: vi.fn(),
  };
  type Tile = {
    el: FakeElement & { complete?: boolean; naturalWidth?: number; naturalHeight?: number };
    coords: { x: number; y: number; z: number };
    current: boolean;
    loaded?: number;
  };
  const layer = {
    _map: map, _container: root, _tileZoom: 10 as number | undefined,
    _tiles: {} as Record<string, Tile>, options: {} as L.TileLayerOptions,
    isLoading: vi.fn(() => false),
  };
  layers.push(layer);
  function tile(state: "ready" | "pending" | "failed" = "ready", rect = rectangle(110, 60), tagName = "IMG") {
    const el = Object.assign(element(tagName, root, rect), {
      complete: state !== "pending", naturalWidth: state === "ready" ? 256 : 0, naturalHeight: state === "ready" ? 256 : 0,
    });
    if (state === "ready") el.classes.add("leaflet-tile-loaded");
    else { el.style.opacity = "0"; el.style.visibility = "hidden"; }
    const entry: Tile = { el, coords: { x: 372, y: 552, z: 10 }, current: true, ...(state !== "pending" ? { loaded: 123 } : {}) };
    layer._tiles[String(Object.keys(layer._tiles).length)] = entry;
    return entry;
  }
  return {
    map: map as unknown as L.Map, container, group, root, layer, layers, tile, element,
    setZoom: (value: number) => { zoom = value; },
  };
}

function expectTileError(run: () => unknown) {
  expect(run).toThrowError(MapPrintCaptureError);
  try { run(); } catch (error) {
    expect(error).toMatchObject({ code: "TILE_ERROR" });
    expect((error as Error).message).toMatch(/tile.*camada ativa.*z=10.*nenhuma captura parcial/i);
  }
}

describe("active Leaflet grid readiness (read-only DOM fixtures)", () => {
  it("rejects the regression: 15 failed opacity-zero tiles after the layer queue finished", () => {
    const f = tileFixture();
    for (let i = 0; i < 15; i++) f.tile("failed");
    expect(f.layer.isLoading()).toBe(false);
    expectTileError(() => inspectMapPrintTiles(f.map));
  });
  it("rejects a failed WMS grid too, without depending on a TileLayer constructor", () => {
    const f = tileFixture();
    Object.assign(f.layer, { wmsParams: { service: "WMS", request: "GetMap" } });
    f.tile("failed");
    expectTileError(() => inspectMapPrintTiles(f.map));
  });
  it("rejects broken complete images even before Leaflet records loaded", () => {
    const f = tileFixture(); const tile = f.tile("failed"); delete tile.loaded;
    expectTileError(() => inspectMapPrintTiles(f.map));
  });
  it("rejects a completed errorTileUrl fallback without the success class", () => {
    const f = tileFixture(); const tile = f.tile("failed");
    tile.el.naturalWidth = tile.el.naturalHeight = 256;
    expectTileError(() => inspectMapPrintTiles(f.map));
  });
  it.each(["naturalWidth", "naturalHeight"] as const)("rejects ready-class tiles with zero %s", dimension => {
    const f = tileFixture(); const tile = f.tile(); tile.el[dimension] = 0;
    expectTileError(() => inspectMapPrintTiles(f.map));
  });
  it("waits for unloaded opacity-zero images even when isLoading already reports false", () => {
    const f = tileFixture(); const tile = f.tile("pending");
    const state = inspectMapPrintTiles(f.map);
    expect(state.pending).toBe(true);
    expect(state.images.has(tile.el as unknown as HTMLImageElement)).toBe(true);
  });
  it("becomes ready after a pending tile successfully loads, without mutating its style", () => {
    const f = tileFixture(); const tile = f.tile("pending");
    expect(inspectMapPrintTiles(f.map).pending).toBe(true);
    tile.el.complete = true; tile.el.naturalWidth = tile.el.naturalHeight = 256;
    tile.el.classes.add("leaflet-tile-loaded"); tile.loaded = 123;
    expect(inspectMapPrintTiles(f.map).pending).toBe(false);
    expect(tile.el.style).toMatchObject({ opacity: "0", visibility: "hidden" });
    expect(f.map.on).not.toHaveBeenCalled();
  });
  it("keeps a not-yet-complete image pending despite loaded metadata and class", () => {
    const f = tileFixture(); const tile = f.tile(); tile.el.complete = false;
    expect(inspectMapPrintTiles(f.map).pending).toBe(true);
  });
  it.each([
    rectangle(-200, 60), rectangle(900, 60), rectangle(110, -206), rectangle(110, 450),
  ])("ignores failed offscreen/edge-touching buffer tiles at %j", rect => {
    const f = tileFixture(); const tile = f.tile("failed", rect);
    const state = inspectMapPrintTiles(f.map);
    expect(state.pending).toBe(false); expect(state.images.size).toBe(0);
    expect(state.managedImages.has(tile.el as unknown as HTMLImageElement)).toBe(true);
  });
  it("does not wait on the layer-wide queue when only offscreen tiles remain pending", () => {
    const f = tileFixture(); f.tile(); f.tile("pending", rectangle(1200, 60));
    f.layer.isLoading.mockReturnValue(true);
    const state = inspectMapPrintTiles(f.map);
    expect(state.pending).toBe(false); expect(state.images.size).toBe(1);
    expect(f.layer.isLoading).not.toHaveBeenCalled();
  });
  it("rejects a failed tile that intersects the viewport by just one pixel", () => {
    const f = tileFixture(); f.tile("failed", rectangle(899, 60));
    expectTileError(() => inspectMapPrintTiles(f.map));
  });
  it.each(["display", "visibility", "opacity"] as const)("ignores an intentionally hidden group (%s)", property => {
    const f = tileFixture(); f.tile("failed");
    f.group.style[property] = property === "display" ? "none" : property === "visibility" ? "hidden" : "0";
    expect(inspectMapPrintTiles(f.map).pending).toBe(false);
    expect(inspectMapPrintTiles(f.map).images.size).toBe(0);
  });
  it("ignores an intentionally transparent layer container, not a failed tile opacity", () => {
    const f = tileFixture(); f.tile("failed"); f.root.style.opacity = "0";
    expect(inspectMapPrintTiles(f.map).images.size).toBe(0);
  });
  it("ignores removed layers and detached stale tile elements", () => {
    const f = tileFixture(); const tile = f.tile("failed");
    f.root.children.splice(f.root.children.indexOf(tile.el), 1);
    expect(inspectMapPrintTiles(f.map).images.size).toBe(0);
    f.tile("failed"); f.layer._map = {} as typeof f.layer._map;
    expect(inspectMapPrintTiles(f.map).images.size).toBe(0);
  });
  it("ignores non-current retained tiles and old zoom levels intersecting the viewport", () => {
    const f = tileFixture(); f.tile("failed").current = false;
    f.tile("failed").coords.z = 9;
    expect(inspectMapPrintTiles(f.map).pending).toBe(false);
    expect(inspectMapPrintTiles(f.map).images.size).toBe(0);
  });
  it.each([9, 12])("honors native-adjusted tile zoom %s rather than map zoom 10", tileZoom => {
    const f = tileFixture(); f.layer._tileZoom = tileZoom;
    f.layer.options = tileZoom < 10 ? { maxNativeZoom: tileZoom } : { minNativeZoom: tileZoom };
    f.tile("failed").coords.z = tileZoom;
    expect(() => inspectMapPrintTiles(f.map)).toThrowError(/tile.*camada ativa/i);
  });
  it("does not interpret URL zoomOffset as a grid coordinate zoom", () => {
    const f = tileFixture(); f.layer.options.zoomOffset = 1; f.tile("failed");
    expectTileError(() => inspectMapPrintTiles(f.map));
  });
  it.each([8, 12])("ignores a grid outside its configured display zoom (map=%s)", zoom => {
    const f = tileFixture(); f.tile("failed"); f.setZoom(zoom);
    f.layer.options = { minZoom: 9, maxZoom: 11 };
    expect(inspectMapPrintTiles(f.map).images.size).toBe(0);
  });
  it("ignores an inactive undefined tile zoom", () => {
    const f = tileFixture(); f.tile("failed"); f.layer._tileZoom = undefined;
    expect(inspectMapPrintTiles(f.map).images.size).toBe(0);
  });
  it("allows a bounded layer with no tiles in this extent", () => {
    const f = tileFixture();
    expect(inspectMapPrintTiles(f.map)).toMatchObject({ pending: false, images: new Set() });
  });
  it("preserves no-active-grid compatibility for SVG/vector-only or blank maps", () => {
    const f = tileFixture(); f.layers.splice(0); f.layers.push({ getAttribution: () => "SVG" });
    expect(inspectMapPrintTiles(f.map)).toEqual({ pending: false, images: new Set(), managedImages: new Set(), ignoredTiles: new Set() });
  });
  it("also waits for asynchronous canvas GridLayer tiles", () => {
    const f = tileFixture(); const tile = f.tile("pending", rectangle(110, 60), "CANVAS");
    expect(inspectMapPrintTiles(f.map)).toMatchObject({ pending: true, images: new Set() });
    tile.loaded = 123; tile.el.classes.add("leaflet-tile-loaded");
    expect(inspectMapPrintTiles(f.map).pending).toBe(false);
  });
  it("checks image descendants of custom grid tile wrappers", () => {
    const f = tileFixture(); const tile = f.tile("ready", rectangle(110, 60), "DIV");
    Object.assign(f.element("IMG", tile.el), { complete: true, naturalWidth: 0, naturalHeight: 0 });
    expectTileError(() => inspectMapPrintTiles(f.map));
  });
  it("ignores delayed buffer load/style changes and pruning removal from the level", () => {
    const f = tileFixture(); const tile = f.tile("pending", rectangle(1200, 60));
    const { ignoredTiles } = inspectMapPrintTiles(f.map);
    const attributes = { type: "attributes", target: tile.el } as unknown as MutationRecord;
    const removal = { type: "childList", target: f.root, addedNodes: [], removedNodes: [tile.el] } as unknown as MutationRecord;
    expect(mapPrintMutationAffectsCapture(attributes, ignoredTiles)).toBe(false);
    f.root.children.splice(f.root.children.indexOf(tile.el), 1);
    expect(mapPrintMutationAffectsCapture(removal, ignoredTiles)).toBe(false);
  });
  it("does not exempt current tiles, new tiles, group style changes or mixed pruning", () => {
    const f = tileFixture(); const current = f.tile(); const old = f.tile("pending", rectangle(1200, 60));
    const { ignoredTiles } = inspectMapPrintTiles(f.map);
    const attribute = (target: unknown) => ({ type: "attributes", target }) as MutationRecord;
    expect(mapPrintMutationAffectsCapture(attribute(current.el), ignoredTiles)).toBe(true);
    expect(mapPrintMutationAffectsCapture(attribute(f.group), ignoredTiles)).toBe(true);
    expect(mapPrintMutationAffectsCapture({ type: "childList", target: f.root, addedNodes: [f.element("IMG", f.root)], removedNodes: [] } as unknown as MutationRecord, ignoredTiles)).toBe(true);
    expect(mapPrintMutationAffectsCapture({ type: "childList", target: f.root, addedNodes: [], removedNodes: [old.el, current.el] } as unknown as MutationRecord, ignoredTiles)).toBe(true);
  });
});

describe("capture rejects before rendering (minimal DOM, no successful PNG mocked)", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it("fails immediately on a pre-existing failed tile and removes only its map listener", async () => {
    vi.useFakeTimers(); vi.stubGlobal("window", {});
    const f = tileFixture(); f.tile("failed");
    await expect(captureMapSnapshot(f.map)).rejects.toMatchObject({ code: "TILE_ERROR" });
    expect(f.map.off).toHaveBeenCalledWith(f.map.on.mock.calls[0][0], f.map.on.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps hidden pending tiles waiting until the existing total deadline", async () => {
    vi.useFakeTimers(); vi.stubGlobal("window", {});
    const f = tileFixture(); f.tile("pending");
    const result = captureMapSnapshot(f.map, { timeoutMs: 500 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(499);
    expect(f.map.off).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ code: "TIMEOUT" });
    expect(f.map.off).toHaveBeenCalledOnce();
  });
  it("detects a tile failure while waiting instead of timing out or returning a snapshot", async () => {
    vi.useFakeTimers(); vi.stubGlobal("window", {});
    const f = tileFixture(); const tile = f.tile("pending");
    const result = captureMapSnapshot(f.map, { timeoutMs: 1000 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(120);
    tile.el.complete = true; tile.loaded = 123;
    await vi.advanceTimersByTimeAsync(20);
    expect(await result).toMatchObject({ code: "TILE_ERROR" });
    expect(f.map.off).toHaveBeenCalledOnce();
  });
  it("continues after an initially hidden pending tile succeeds (before renderer boundary)", async () => {
    vi.useFakeTimers(); vi.stubGlobal("window", {});
    const reachedFreeze = new Error("TEST_ONLY_RENDER_BOUNDARY");
    vi.stubGlobal("MutationObserver", class { constructor() { throw reachedFreeze; } });
    const f = tileFixture(); const tile = f.tile("pending");
    const result = captureMapSnapshot(f.map, { timeoutMs: 1000 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(120);
    tile.el.complete = true; tile.el.naturalWidth = tile.el.naturalHeight = 256;
    tile.loaded = 123; tile.el.classes.add("leaflet-tile-loaded");
    await vi.advanceTimersByTimeAsync(300);
    expect(await result).toBe(reachedFreeze);
  });
  it("does not stall for an offscreen pending tile even with a loading grid queue", async () => {
    vi.useFakeTimers(); vi.stubGlobal("window", {});
    const reachedFreeze = new Error("TEST_ONLY_RENDER_BOUNDARY");
    vi.stubGlobal("MutationObserver", class { constructor() { throw reachedFreeze; } });
    const f = tileFixture(); f.tile(); f.tile("pending", rectangle(1200, 60));
    f.layer.isLoading.mockReturnValue(true);
    const result = captureMapSnapshot(f.map, { timeoutMs: 1000 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(340);
    expect(await result).toBe(reachedFreeze);
    expect(f.layer.isLoading).not.toHaveBeenCalled();
  });
});
