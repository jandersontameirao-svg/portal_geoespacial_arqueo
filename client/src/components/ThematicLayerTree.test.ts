import { describe, expect, it } from "vitest";
import { moveThematicItem } from "./ThematicLayerTree";

describe("ordem da árvore temática", () => {
  it("move somente o item solicitado uma posição", () => {
    expect(moveThematicItem(["drawing-1", "vector-2", "raster-3"], "vector-2", "up")).toEqual(["vector-2", "drawing-1", "raster-3"]);
    expect(moveThematicItem(["drawing-1", "vector-2", "raster-3"], "vector-2", "down")).toEqual(["drawing-1", "raster-3", "vector-2"]);
  });

  it("preserva a ordem nos limites e para identificador inexistente", () => {
    const order = ["drawing-1", "vector-2"];
    expect(moveThematicItem(order, "drawing-1", "up")).toEqual(order);
    expect(moveThematicItem(order, "vector-2", "down")).toEqual(order);
    expect(moveThematicItem(order, "missing", "down")).toEqual(order);
  });
});
