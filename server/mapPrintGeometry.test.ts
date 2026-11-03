import { describe, expect, it } from "vitest";
import {
  assertMapPrintBounds, assertMapPrintSize, geographicToPrintPosition, getGeographicGrid,
  getPrintGeometry, inverseMercatorNorthing, MAP_PRINT_MAX_PIXELS,
  mercatorNorthing, WEB_MERCATOR_MAX_LATITUDE, type MapPrintBounds, type MapPrintSnapshot,
} from "../shared/mapPrint";

const bounds: MapPrintBounds = { north: 20, south: 0, east: -40, west: -60 };
const snapshot: MapPrintSnapshot = {
  imageDataUrl: "data:image/png;base64,fixture", width: 1200, height: 600,
  bounds, capturedAt: "2026-11-02T22:00:00.000Z", crs: "EPSG:3857",
  attributions: ["Fixture"], legend: [], warnings: [],
};

describe("map print capture bounds and resource guards (pure)", () => {
  it("accepts a local Brazilian viewport", () => {
    expect(() => assertMapPrintBounds({ north: -13, south: -15, east: -47, west: -49 })).not.toThrow();
  });
  it.each([NaN, Infinity, -Infinity])("rejects nonfinite bounds %s", value => {
    expect(() => assertMapPrintBounds({ ...bounds, north: value })).toThrow(/finitos/);
  });
  it.each([
    { ...bounds, north: 0 }, { ...bounds, east: -60 },
    { north: 10, south: -10, west: 170, east: -170 },
  ])("rejects empty/inverted or dateline bounds %#", value => {
    expect(() => assertMapPrintBounds(value)).toThrow(/antimeridiano/);
  });
  it.each([
    { north: 10, south: -10, west: 170, east: 190 },
    { north: 10, south: -10, west: -190, east: -170 },
  ])("rejects unwrapped antimeridian and repeated worlds %#", value => {
    expect(() => assertMapPrintBounds(value)).toThrow(/antimeridiano/);
  });
  it.each([
    { north: 20, south: -20, east: 160, west: -160 },
    { north: 80, south: -80, east: 30, west: -30 },
  ])("explicitly rejects broad world view %#", value => {
    expect(() => assertMapPrintBounds(value)).toThrow(/mundial/);
  });
  it("rejects polar extents rather than clamping and falsifying bounds", () => {
    expect(() => assertMapPrintBounds({ ...bounds, north: 89 })).toThrow(/EPSG:3857/);
  });
  it("accepts exactly the physical pixel ceiling", () => {
    expect(() => assertMapPrintSize(4000, 3000)).not.toThrow();
    expect(MAP_PRINT_MAX_PIXELS).toBe(12_000_000);
  });
  it.each([[0, 100], [1.5, 10], [10, Infinity], [4001, 3000], [8193, 2]])("rejects invalid/oversized size %s×%s", (width, height) => {
    expect(() => assertMapPrintSize(width, height)).toThrow();
  });
  it("caller may lower but cannot bypass the hard ceiling", () => {
    expect(() => assertMapPrintSize(1000, 1000, 500_000)).toThrow();
    expect(() => assertMapPrintSize(1000, 1000, 24_000_000)).toThrow();
  });
});

describe("map print physical geometry (pure)", () => {
  it("letterboxes wide actual pixels in a square frame without stretching", () => {
    const result = getPrintGeometry(snapshot, 200, 200);
    expect(result.image).toEqual({ xMm: 0, yMm: 50, widthMm: 200, heightMm: 100 });
    expect(result.image.widthMm / result.image.heightMm).toBe(snapshot.width / snapshot.height);
    expect(result.effectiveDpi).toBeCloseTo(152.4, 8);
  });
  it("letterboxes a tall image horizontally", () => {
    const result = getPrintGeometry({ ...snapshot, width: 600, height: 1200 }, 200, 200);
    expect(result.image).toEqual({ xMm: 50, yMm: 0, widthMm: 100, heightMm: 200 });
  });
  it("doubling the physical frame halves the scale denominator and source DPI", () => {
    const small = getPrintGeometry(snapshot, 100, 100), large = getPrintGeometry(snapshot, 200, 200);
    expect(small.scaleDenominatorApprox).toBeCloseTo(large.scaleDenominatorApprox * 2, 8);
    expect(small.effectiveDpi).toBeCloseTo(large.effectiveDpi * 2, 8);
    expect(large.approximate).toBe(true);
    expect(large.warnings.join(" ")).toMatch(/NBR/);
  });
  it("uses actual extent and local Mercator ground scale at center", () => {
    const equator = getPrintGeometry({ ...snapshot, bounds: { north: 1, south: -1, east: 1, west: 0 } }, 200, 100);
    expect(equator.center.latitude).toBeCloseTo(0, 10);
    expect(equator.groundWidthMetersApprox).toBeCloseTo(111319.49079327357, 5);
    expect(equator.scaleDenominatorApprox).toBeCloseTo(556597.4539663678, 5);
    const high = getPrintGeometry({ ...snapshot, bounds: { north: 61, south: 59, east: 1, west: 0 } }, 200, 100);
    expect(high.groundWidthMetersApprox).toBeGreaterThan(equator.groundWidthMetersApprox * .49);
    expect(high.groundWidthMetersApprox).toBeLessThan(equator.groundWidthMetersApprox * .51);
  });
  it("takes center in projected space, not arithmetic latitude", () => {
    const result = getPrintGeometry({ ...snapshot, bounds: { north: 80, south: 0, east: 1, west: 0 } }, 200, 100);
    expect(result.center.latitude).toBeCloseTo(57.04516467328687, 6);
    expect(result.center.latitude).not.toBeCloseTo(40, 1);
  });
  it.each([[0, 10], [-1, 10], [10, NaN], [10, Infinity]])("rejects invalid physical frame %s %s", (w, h) => {
    expect(() => getPrintGeometry(snapshot, w, h)).toThrow(/milímetros/);
  });
  it("does not claim a CRS other than the captured real one", () => {
    expect(() => getPrintGeometry({ ...snapshot, crs: "EPSG:4326" as "EPSG:3857" }, 200, 100)).toThrow(/EPSG:3857/);
  });
});

describe("geographic graticule is positioned in Mercator, never fake UTM (pure)", () => {
  const highBounds = { north: 80, south: 0, east: 20, west: 0 };
  it.each([-80, -45, 0, 45, 80])("Mercator round trip %s", latitude => {
    expect(inverseMercatorNorthing(mercatorNorthing(latitude))).toBeCloseTo(latitude, 10);
  });
  it("maps edges and projected center to exact image fractions", () => {
    expect(geographicToPrintPosition(highBounds, 80, 0).x).toBe(0);
    expect(geographicToPrintPosition(highBounds, 80, 0).y).toBe(0);
    expect(geographicToPrintPosition(highBounds, 0, 20)).toEqual({ x: 1, y: 1 });
    expect(geographicToPrintPosition(highBounds, inverseMercatorNorthing(mercatorNorthing(80) / 2), 10).y).toBeCloseTo(.5, 10);
  });
  it("does not pretend latitude 40° is halfway between 0° and 80° on Mercator", () => {
    const point = geographicToPrintPosition(highBounds, 40, 10);
    expect(point.x).toBe(.5);
    expect(point.y).toBeGreaterThan(.68);
    expect(point.y).toBeLessThan(.70);
  });
  it("returns real geographic values and nonlinear northing positions", () => {
    const grid = getGeographicGrid(highBounds, 4);
    expect(grid).toHaveLength(6);
    expect(grid.filter(line => line.axis === "longitude").map(line => line.value)).toEqual([5, 10, 15]);
    expect(grid.filter(line => line.axis === "latitude").map(line => line.value)).toEqual([20, 40, 60]);
    expect(grid.find(line => line.axis === "latitude" && line.value === 40)?.position).not.toBe(.5);
    expect(grid.every(line => line.position > 0 && line.position < 1)).toBe(true);
  });
  it.each([0, 1, 21, 2.5, NaN])("rejects excessive/invalid grid divisions %s", divisions => {
    expect(() => getGeographicGrid(bounds, divisions)).toThrow();
  });
  it("rejects poles/nonfinite coordinates explicitly", () => {
    expect(() => mercatorNorthing(90)).toThrow();
    expect(() => mercatorNorthing(WEB_MERCATOR_MAX_LATITUDE + .1)).toThrow();
    expect(() => inverseMercatorNorthing(Infinity)).toThrow();
    expect(() => geographicToPrintPosition(bounds, 10, NaN)).toThrow();
  });
});
