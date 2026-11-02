import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { atenaRuns, geometries, layers, userBaseLayerVisibility, userLayerVisibility, userProjectSelection } from "../drizzle/schema";
import { effectiveVisibility, effectiveVisible, wouldCreateCycle, type LayerNode } from "./layerTree";

const nodes: LayerNode[] = [
  { id: 1, parentId: null, isVisible: true },
  { id: 2, parentId: 1, isVisible: true },
  { id: 3, parentId: 2, isVisible: true },
  { id: 4, parentId: null, isVisible: false },
];

describe("layer hierarchy pure/offline rules (not DB evidence)", () => {
  it("allows visible root and nested leaf", () => {
    expect(effectiveVisible(1, nodes)).toBe(true);
    expect(effectiveVisible(3, nodes)).toBe(true);
  });
  it("denies hidden self and hidden ancestors without changing source flags", () => {
    const hidden = nodes.map(node => node.id === 1 ? { ...node, isVisible: false } : node);
    expect(effectiveVisible(3, hidden)).toBe(false);
    expect(hidden[2].isVisible).toBe(true);
    expect(effectiveVisible(4, nodes)).toBe(false);
  });
  it("fails closed for missing nodes, missing parents and duplicate ids", () => {
    expect(effectiveVisible(999, nodes)).toBe(false);
    expect(effectiveVisible(5, [...nodes, { id: 5, parentId: 999, isVisible: true }])).toBe(false);
    expect(effectiveVisible(1, [...nodes, { id: 1, parentId: null, isVisible: true }])).toBe(false);
  });
  it("fails closed for a corrupt cycle and its descendants", () => {
    const cycle = [{ id: 1, parentId: 2, isVisible: true }, { id: 2, parentId: 1, isVisible: true }, { id: 3, parentId: 2, isVisible: true }];
    expect([...effectiveVisibility(cycle).values()]).toEqual([false, false, false]);
  });
  it("refuses self and descendant movement; accepts root and sibling movement", () => {
    expect(wouldCreateCycle(nodes, 1, 1)).toBe(true);
    expect(wouldCreateCycle(nodes, 1, 3)).toBe(true);
    expect(wouldCreateCycle(nodes, 2, 3)).toBe(true);
    expect(wouldCreateCycle(nodes, 3, 1)).toBe(false);
    expect(wouldCreateCycle(nodes, 1, null)).toBe(false);
    expect(wouldCreateCycle(nodes, 2, 4)).toBe(false);
  });
  it("refuses moves into missing or cyclic ancestry", () => {
    expect(wouldCreateCycle(nodes, 1, 999)).toBe(true);
    expect(wouldCreateCycle([{ id: 8, parentId: 9, isVisible: true }, { id: 9, parentId: 8, isVisible: true }], 1, 8)).toBe(true);
  });
  it("handles long chains iteratively (no stack overflow)", () => {
    const deep = Array.from({ length: 12000 }, (_, index) => ({ id: index + 1, parentId: index === 0 ? null : index, isVisible: true }));
    expect(effectiveVisible(12000, deep)).toBe(true);
    expect(wouldCreateCycle(deep, 1, 12000)).toBe(true);
  });
});

describe("additive hierarchy schema contracts (not applied DDL)", () => {
  it("preserves legacy layer payload/file/style/metadata columns", () => {
    const columns = getTableConfig(layers).columns.map(column => column.name);
    for (const name of ["layerData", "metadata", "fileId", "defaultStyle", "parentId", "isGroup", "sortOrder"]) expect(columns).toContain(name);
    expect(layers.isGroup.default).toBe(false);
    expect(layers.sortOrder.default).toBe(0);
    expect(layers.parentId.notNull).toBe(false);
    expect(geometries.layerId.notNull).toBe(false);
  });
  it("keeps exact PR8 atena_runs columns, lengths, nullability and status values", () => {
    const columns = getTableConfig(atenaRuns).columns;
    expect(columns.map(column => column.name)).toEqual([
      "id", "projectId", "userId", "status", "requestText", "plan", "idempotencyKey", "codeVersion", "skillVersions", "inputs", "outputs", "steps", "alerts", "errorMessage", "artifactKey", "artifactCreatedAt", "createdAt", "startedAt", "finishedAt",
    ]);
    expect(atenaRuns.status.enumValues).toEqual(["queued", "running", "completed", "failed", "cancel_requested", "cancelled"]);
    expect(atenaRuns.status.default).toBe("queued");
    expect(atenaRuns.idempotencyKey.getSQLType()).toBe("varchar(64)");
    expect(atenaRuns.codeVersion.getSQLType()).toBe("varchar(40)");
    expect(atenaRuns.artifactKey.getSQLType()).toBe("varchar(500)");
    expect(columns.filter(column => column.notNull).map(column => column.name)).toEqual(["id", "projectId", "userId", "status", "plan", "idempotencyKey", "codeVersion", "createdAt"]);
  });
  it("enforces composite unique override/selection keys", () => {
    for (const table of [userProjectSelection, userLayerVisibility, userBaseLayerVisibility]) {
      const config = getTableConfig(table);
      expect(config.uniqueConstraints).toHaveLength(1);
      expect(config.uniqueConstraints[0].columns[0].name).toBe("userId");
      expect(config.uniqueConstraints[0].columns).toHaveLength(2);
    }
  });
  it("prepares new additive SQL without destructive statements or modifying existing enum", () => {
    const sql = readFileSync(new URL("../infra/sql/0014_hierarchy_atena_candidate.sql", import.meta.url), "utf8").replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|RENAME|DELETE|UPDATE|MODIFY|CHANGE)\b/i);
    for (const name of ["user_project_selection", "user_layer_visibility", "user_base_layer_visibility", "atena_runs"]) expect(sql).toContain(`CREATE TABLE \`${name}\``);
    for (const column of getTableConfig(atenaRuns).columns) expect(sql).toContain(`\`${column.name}\``);
  });
});
