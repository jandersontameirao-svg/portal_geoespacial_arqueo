import { describe, expect, it } from "vitest";
import { effectiveUploadMime, isTiffMime, rasterNameFromFilename, resolveTiffUpload, TIFF_MIME_TYPES } from "../shared/tiffUploadPolicy";

describe("F2 explicit TIFF upload policy", () => {
  it.each(TIFF_MIME_TYPES)("preserves %s in raster and explicitly normalizes original-only to baseline image/tiff", (type) => {
    const file = { name: "a.tif", type };
    expect(resolveTiffUpload(file, "raster")).toMatchObject({ mime: type, isTiff: true, route: "raster", rasterName: "a.tif" });
    expect(resolveTiffUpload(file, "original")).toMatchObject({ route: "generic", genericMime: "image/tiff", isTiff: true });
    expect(file).toEqual({ name: "a.tif", type });
  });
  it.each(["a.tif", "A.TIFF"])("infers absent browser MIME only for TIFF extension %s", (name) => {
    expect(effectiveUploadMime({ name, type: "" })).toBe("image/tiff");
    expect(resolveTiffUpload({ name, type: "" }, "raster").route).toBe("raster");
  });
  it("does not override conflicting MIME or recognize arbitrary bytes by extension", () => {
    const file = { name: "malware.tif", type: "application/x-msdownload" };
    expect(effectiveUploadMime(file)).toBe(file.type);
    expect(isTiffMime(effectiveUploadMime(file))).toBe(false);
  });
  it.each(["a.tif", ".tif", "a", "", "mapa.tif", `${"a".repeat(300)}.tif`])("derives bounded raster name from %s without changing filename", (name) => {
    const result = rasterNameFromFilename(name);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.length).toBeLessThanOrEqual(255);
    if (name === "mapa.tif") expect(result).toBe("mapa");
  });
  it.each(["application/pdf", "image/png", "application/vnd.google-earth.kmz"])("does not reroute previous non-TIFF MIME %s", (type) => {
    expect(resolveTiffUpload({ name: "file", type }, "original")).toMatchObject({ route: "generic", genericMime: type, isTiff: false });
    expect(resolveTiffUpload({ name: "file", type }, "raster").route).toBe("generic");
  });
  it("preserves existing JSON extension inference", () => {
    expect(effectiveUploadMime({ name: "data.geojson", type: "" })).toBe("application/geo+json");
    expect(effectiveUploadMime({ name: "data.json", type: "" })).toBe("application/json");
    expect(effectiveUploadMime({ name: "data.pdf", type: "" })).toBe("");
  });
});
