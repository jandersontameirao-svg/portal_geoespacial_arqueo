import { describe, expect, it } from "vitest";
import { isWorkspaceFeatureCollection, standaloneWorkspaceGeometry, workspaceLayerVisible } from "../shared/workspaceHierarchy";

const collection = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-47, -15] } }] };

describe("workspace hierarchy presentation bridge (pure, no database)", () => {
  it("keeps the fallback for a legacy or not-yet-loaded layer", () => {
    expect(workspaceLayerVisible(1, true, [])).toBe(true);
    expect(workspaceLayerVisible(1, false, [])).toBe(false);
  });
  it("applies cascade-hidden layers even if the old presentation is visible", () => {
    expect(workspaceLayerVisible(1, true, [{ id: 1, effectiveVisible: false }])).toBe(false);
  });
  it("honors a personal visible override returned by the authorized router", () => {
    expect(workspaceLayerVisible(1, false, [{ id: 1, effectiveVisible: true }])).toBe(true);
  });
  it("does not render a group as if it were a data layer", () => {
    expect(workspaceLayerVisible(1, true, [{ id: 1, isGroup: true, effectiveVisible: true }])).toBe(false);
  });
  it("preserves legacy drawings that are not assigned to layers", () => {
    expect(standaloneWorkspaceGeometry({}, [])).toBe(true);
    expect(standaloneWorkspaceGeometry({ layerId: null }, [])).toBe(true);
  });
  it("preserves geometry-row-only layers and data not yet in the layer query", () => {
    expect(standaloneWorkspaceGeometry({ layerId: 1 }, [])).toBe(true);
    expect(standaloneWorkspaceGeometry({ layerId: 1 }, [{ id: 1, layerType: "vector", layerData: null }])).toBe(true);
  });
  it("does not duplicate Atena or imported data present in both FC and geometry rows", () => {
    expect(standaloneWorkspaceGeometry({ layerId: 1 }, [{ id: 1, layerType: "vector", layerData: collection }])).toBe(false);
  });
  it("does not hide geometry rows merely because an empty FC exists", () => {
    expect(standaloneWorkspaceGeometry({ layerId: 1 }, [{ id: 1, layerType: "vector", layerData: { type: "FeatureCollection", features: [] } }])).toBe(true);
  });
  it("only accepts an actual FeatureCollection envelope for presentation", () => {
    expect(isWorkspaceFeatureCollection(collection)).toBe(true);
    for (const value of [null, "{}", [], { type: "Feature" }, { type: "FeatureCollection", features: null }]) expect(isWorkspaceFeatureCollection(value)).toBe(false);
  });
});
