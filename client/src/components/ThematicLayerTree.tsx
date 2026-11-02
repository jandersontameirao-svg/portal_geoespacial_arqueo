import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye, EyeOff, Layers3, MoveDown, MoveUp, Radar } from "lucide-react";

export type ThematicLayerGroup = "own" | "base" | "result";
export type ThematicLayerKind = "drawing" | "vector" | "raster" | "wms" | "wfs" | "analysis";

export type ThematicLayerItem = {
  id: string;
  group: ThematicLayerGroup;
  kind: ThematicLayerKind;
  name: string;
  description: string;
  visible: boolean;
  selectedForAnalysis?: boolean;
  analyzable?: boolean;
  color?: string;
  status?: "healthy" | "degraded" | "unavailable" | "legacy" | "local";
  sourceLabel?: string;
};

const groupLabels: Record<ThematicLayerGroup, { title: string; description: string }> = {
  own: { title: "Camadas próprias", description: "Desenhos, vetores importados e rasters vinculados ao projeto." },
  base: { title: "Bases conectadas", description: "Fontes oficiais e OGC publicados; WMS é visual e WFS é analítico." },
  result: { title: "Resultados", description: "Camadas geradas por análises, preservadas com proveniência." },
};

export function moveThematicItem(order: string[], itemId: string, direction: "up" | "down"): string[] {
  const currentIndex = order.indexOf(itemId);
  if (currentIndex < 0) return order;
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= order.length) return order;
  const next = [...order];
  [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];
  return next;
}

function statusLabel(status: ThematicLayerItem["status"]) {
  if (status === "healthy") return "saudável";
  if (status === "degraded") return "degradada";
  if (status === "unavailable") return "indisponível";
  if (status === "legacy") return "legado";
  if (status === "local") return "local";
  return null;
}

export default function ThematicLayerTree({
  items,
  order,
  disabled = false,
  onVisibilityChange,
  onAnalysisSelectionChange,
  onMove,
}: {
  items: ThematicLayerItem[];
  order: string[];
  disabled?: boolean;
  onVisibilityChange: (item: ThematicLayerItem, visible: boolean) => void;
  onAnalysisSelectionChange?: (item: ThematicLayerItem, selected: boolean) => void;
  onMove: (item: ThematicLayerItem, direction: "up" | "down") => void;
}) {
  const orderedItems = order
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is ThematicLayerItem => Boolean(item));
  const remainingItems = items.filter((item) => !order.includes(item.id));
  const displayItems = [...orderedItems, ...remainingItems];

  return (
    <div className="space-y-4" data-testid="thematic-layer-tree">
      {(Object.keys(groupLabels) as ThematicLayerGroup[]).map((group) => {
        const groupItems = displayItems.filter((item) => item.group === group);
        const label = groupLabels[group];
        return (
          <section key={group} className="rounded-lg border bg-card">
            <div className="border-b bg-muted/35 px-3 py-2">
              <div className="flex items-center gap-2"><Layers3 className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">{label.title}</h3></div>
              <p className="mt-1 text-xs text-muted-foreground">{label.description}</p>
            </div>
            <div className="divide-y">
              {groupItems.length === 0 ? <p className="px-3 py-4 text-xs text-muted-foreground">Nenhuma camada disponível neste grupo.</p> : groupItems.map((item) => {
                const index = groupItems.indexOf(item);
                const labelStatus = statusLabel(item.status);
                return (
                  <div key={item.id} className="space-y-2 px-3 py-3" data-testid={`thematic-layer-${item.id}`}>
                    <div className="flex min-w-0 items-start gap-2">
                      <button
                        type="button"
                        className="mt-0.5 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={disabled || item.status === "unavailable"}
                        aria-label={`${item.visible ? "Ocultar" : "Exibir"} ${item.name}`}
                        title={item.visible ? "Ocultar camada" : "Exibir camada"}
                        onClick={() => onVisibilityChange(item, !item.visible)}
                      >
                        {item.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      </button>
                      <span className="mt-1 h-3 w-3 shrink-0 rounded-full border" style={{ backgroundColor: item.color || "#64748b" }} aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5"><p className="truncate text-sm font-medium">{item.name}</p><Badge variant="outline" className="h-5 px-1.5 text-[10px] uppercase">{item.kind}</Badge>{labelStatus && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{labelStatus}</Badge>}</div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
                        {item.sourceLabel && <p className="mt-0.5 text-[11px] text-muted-foreground">Fonte: {item.sourceLabel}</p>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pl-8">
                      {item.analyzable && onAnalysisSelectionChange && <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"><Checkbox disabled={disabled} checked={Boolean(item.selectedForAnalysis)} onCheckedChange={(checked) => onAnalysisSelectionChange(item, checked === true)} />Usar na análise</label>}
                      {!item.analyzable && item.kind === "wfs" && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Radar className="h-3.5 w-3.5" />Requer importação autorizada para análise</span>}
                      <span className="ml-auto flex items-center gap-1"><Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Subir na ordem visual" disabled={disabled || index === 0} onClick={() => onMove(item, "up")}><MoveUp className="h-3.5 w-3.5" /></Button><Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Descer na ordem visual" disabled={disabled || index === groupItems.length - 1} onClick={() => onMove(item, "down")}><MoveDown className="h-3.5 w-3.5" /></Button></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
