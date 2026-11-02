/** Hierarquia aditiva: a visibilidade efetiva nunca altera o dado original. */
export type LayerNode = { id: number; parentId: number | null; isVisible: boolean };

export function effectiveVisibility(nodes: LayerNode[]): Map<number, boolean> {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const out = new Map<number, boolean>();
  if (byId.size !== nodes.length) return new Map(nodes.map(node => [node.id, false]));
  for (const start of nodes) {
    if (out.has(start.id)) continue;
    const path: number[] = [];
    const seen = new Set<number>();
    let current: LayerNode | undefined = start;
    let visible = true;
    while (current) {
      if (out.has(current.id)) { visible = out.get(current.id)!; break; }
      if (seen.has(current.id) || !current.isVisible) { visible = false; break; }
      seen.add(current.id);
      path.push(current.id);
      if (current.parentId == null) break;
      const parent = byId.get(current.parentId);
      if (!parent) { visible = false; break; }
      current = parent;
    }
    for (const id of path) out.set(id, visible);
    out.set(start.id, visible);
  }
  return out;
}

export function effectiveVisible(id: number, nodes: LayerNode[]): boolean {
  return effectiveVisibility(nodes).get(id) ?? false;
}

/** Também rejeita destino órfão/corrompido; validar grupo/projeto antes desta regra. */
export function wouldCreateCycle(nodes: LayerNode[], movingId: number, newParentId: number | null): boolean {
  if (newParentId == null) return false;
  const byId = new Map(nodes.map(node => [node.id, node]));
  const seen = new Set<number>();
  let id: number | null = newParentId;
  while (id != null) {
    if (id === movingId || seen.has(id)) return true;
    seen.add(id);
    const node = byId.get(id);
    if (!node) return true;
    id = node.parentId;
  }
  return false;
}
