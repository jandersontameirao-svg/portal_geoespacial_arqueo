import { useMemo, useState, type ReactElement } from "react";
import { ChevronDown, ChevronRight, Folder, Layers as LayersIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { toast } from "sonner";

export type LayersTreeProps = {
  projectId?: number;
  /** Read-only unless the parent explicitly grants editing; server always rechecks. */
  canEdit?: boolean;
  onChanged?: () => void;
};

function droppedId(raw: string): number | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    const value = typeof parsed === "number" ? parsed : (parsed as { id?: unknown } | null)?.id;
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
  } catch { return null; }
}

/** Arbitrary hierarchy; personal visibility is available even to project readers. */
export default function LayersTree({ projectId, canEdit = false, onChanged }: LayersTreeProps) {
  const { data: rows, isLoading, isError, error } = trpc.layers.list.useQuery(
    { projectId: projectId! }, { enabled: !!projectId },
  );
  const [name, setName] = useState("");
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const utils = trpc.useUtils();
  const changed = async () => {
    await Promise.all([
      utils.layers.list.invalidate(), utils.geometries.list.invalidate(),
      utils.geometries.listForProjects.invalidate(), utils.gisAnalysis.list.invalidate(),
      utils.raster.listForMap.invalidate(),
    ]);
    onChanged?.();
  };
  const onError = (cause: { message: string }) => toast.error(cause.message || "Não foi possível alterar a camada");
  const moveNode = trpc.layers.move.useMutation({ onSuccess: changed, onError });
  const moveGeometry = trpc.geometries.moveToLayer.useMutation({ onSuccess: changed, onError });
  const setVisibility = trpc.layers.setVisibility.useMutation({ onSuccess: changed, onError });
  const created = async () => { setName(""); await changed(); };
  const createGroup = trpc.layers.createGroup.useMutation({ onSuccess: created, onError });
  const createLayer = trpc.layers.createLayer.useMutation({ onSuccess: created, onError });
  const pending = moveNode.isPending || moveGeometry.isPending || createGroup.isPending || createLayer.isPending;

  const childrenOf = useMemo(() => {
    const map = new Map<number | null, NonNullable<typeof rows>>();
    const ids = new Set((rows ?? []).map(row => row.id));
    for (const row of rows ?? []) {
      const key = row.parentId != null && ids.has(row.parentId) && row.parentId !== row.id ? row.parentId : null;
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return map;
  }, [rows]);

  if (!projectId) return null;
  const toggleCollapsed = (id: number) => setCollapsed(previous => {
    const next = new Set(previous);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const nameValid = name.trim().length > 0 && name.trim().length <= 255;

  const renderNodes = (parentId: number | null, ancestors: Set<number>): ReactElement[] =>
    (childrenOf.get(parentId) ?? []).flatMap(node => {
      if (ancestors.has(node.id)) return [];
      const path = new Set(ancestors).add(node.id);
      const isCollapsed = collapsed.has(node.id);
      const hasKids = (childrenOf.get(node.id) ?? []).length > 0;
      const line = (
        <div key={node.id} role="treeitem" aria-level={ancestors.size + 1}
          aria-expanded={node.isGroup ? !isCollapsed : undefined}
          draggable={canEdit && !pending}
          onDragStart={event => {
            if (!canEdit) return;
            event.stopPropagation();
            event.dataTransfer.setData("application/x-layer-node", JSON.stringify({ id: node.id }));
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={event => {
            if (!canEdit || pending) return;
            event.stopPropagation();
            const types = Array.from(event.dataTransfer.types);
            if (node.isGroup ? types.includes("application/x-layer-node") : types.includes("application/x-geometry")) {
              event.preventDefault(); setDragOverId(node.id);
            }
          }}
          onDragLeave={() => setDragOverId(null)}
          onDrop={event => {
            event.preventDefault(); event.stopPropagation(); setDragOverId(null);
            if (!canEdit || pending) return;
            const id = droppedId(event.dataTransfer.getData(node.isGroup ? "application/x-layer-node" : "application/x-geometry"));
            if (id == null) return;
            if (node.isGroup && id !== node.id) moveNode.mutate({ id, parentId: node.id, sortOrder: 0 });
            if (!node.isGroup) moveGeometry.mutate({ id, layerId: node.id });
          }}
          className={`flex flex-wrap items-center gap-2 rounded py-1 text-sm ${dragOverId === node.id ? "bg-accent/40" : ""}`}
          style={{ paddingLeft: Math.min(ancestors.size, 12) * 16 }}>
          {node.isGroup ? (
            <button type="button" aria-label={isCollapsed ? `Expandir ${node.name}` : `Recolher ${node.name}`}
              onClick={() => toggleCollapsed(node.id)} disabled={!hasKids} className="w-4 text-muted-foreground">
              {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          ) : <span className="w-4" />}
          <Checkbox checked={node.userVisible} disabled={setVisibility.isPending}
            onCheckedChange={checked => setVisibility.mutate({ id: node.id, visible: checked === true })}
            aria-label={`Mostrar ${node.name} somente para mim`} />
          {node.isGroup ? <Folder className="h-4 w-4 shrink-0" /> : <LayersIcon className="h-4 w-4 shrink-0" />}
          <span className={`min-w-0 break-words ${node.effectiveVisible ? "" : "text-muted-foreground line-through"}`}>{node.name}</span>
          {node.userVisible && !node.effectiveVisible && <span className="text-xs text-muted-foreground">(oculta pela hierarquia)</span>}
          {canEdit && (
            <select aria-label={`Mover ${node.name} para grupo`} value={node.parentId ?? ""} disabled={pending}
              className="ml-auto max-w-full rounded border bg-background text-xs"
              onChange={event => moveNode.mutate({ id: node.id, parentId: event.target.value === "" ? null : Number(event.target.value), sortOrder: node.sortOrder })}>
              <option value="">Raiz</option>
              {(rows ?? []).filter(row => row.isGroup && row.id !== node.id).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          )}
          {canEdit && node.isGroup && nameValid && (
            <span className="flex gap-2 text-xs">
              <button type="button" className="underline" disabled={pending}
                onClick={() => createGroup.mutate({ projectId, name: name.trim(), parentId: node.id })}>+ grupo</button>
              <button type="button" className="underline" disabled={pending}
                onClick={() => createLayer.mutate({ projectId, name: name.trim(), parentId: node.id })}>+ camada</button>
            </span>
          )}
        </div>
      );
      return !isCollapsed ? [line, ...renderNodes(node.id, path)] : [line];
    });

  return (
    <section className="mb-4 space-y-2" aria-label="Árvore de camadas">
      <div className="text-xs font-medium text-muted-foreground">Árvore de camadas · visibilidade pessoal</div>
      {isLoading ? <p role="status" className="text-sm">Carregando camadas…</p>
        : isError ? <p role="alert" className="text-sm text-destructive">{error.message || "Não foi possível listar camadas"}</p>
        : rows?.length ? <div role="tree" aria-label="Camadas do projeto">{renderNodes(null, new Set())}</div>
        : <p className="text-sm text-muted-foreground">Nenhuma camada criada ainda</p>}
      {canEdit && (
        <>
          <div onDragOver={event => {
            if (!pending && Array.from(event.dataTransfer.types).includes("application/x-layer-node")) { event.preventDefault(); setDragOverId(-1); }
          }} onDragLeave={() => setDragOverId(null)} onDrop={event => {
            event.preventDefault(); setDragOverId(null);
            const id = droppedId(event.dataTransfer.getData("application/x-layer-node"));
            if (id != null && !pending) moveNode.mutate({ id, parentId: null, sortOrder: 0 });
          }} className={`rounded border border-dashed px-2 py-1 text-xs text-muted-foreground ${dragOverId === -1 ? "bg-accent/40" : ""}`}>
            Solte aqui para mover para a raiz (ou use o seletor de grupo)
          </div>
          <div className="flex gap-2">
            <input value={name} onChange={event => setName(event.target.value)} maxLength={255} placeholder="Nome"
              className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm" aria-label="Nome do novo grupo ou camada" />
            <Button size="sm" variant="outline" disabled={!nameValid || pending} onClick={() => createGroup.mutate({ projectId, name: name.trim() })}>Grupo</Button>
            <Button size="sm" variant="outline" disabled={!nameValid || pending} onClick={() => createLayer.mutate({ projectId, name: name.trim() })}>Camada</Button>
          </div>
        </>
      )}
    </section>
  );
}
