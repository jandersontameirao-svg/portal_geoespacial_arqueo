import { useCallback, useEffect, useRef, useState } from "react";
import { FolderKanban, Layers, Map as MapIcon, X } from "lucide-react";
import { Button } from "./ui/button";
import BasemapQuickSelector from "./BasemapQuickSelector";
import MyProjectsPanel from "./MyProjectsPanel";
import BaseLayersPanel from "./BaseLayersPanel";
import InstitutionalLayersPanel from "./InstitutionalLayersPanel";

type MapPanel = "projects" | "basemap" | "layers";
interface GlobalMapPanelsProps {
  enabledIds: number[];
  onChange: (ids: number[]) => void;
  basemapId: string;
  onBasemapChange: (id: string) => void;
  viewMode: "2d" | "3d";
  onRequest2D?: () => void;
  contextualProjectId?: number;
  selectionReady: boolean;
  selectionPending: boolean;
  selectionError?: string;
  onRetrySelection: () => void;
}
const panelOptions: Array<{
  id: MapPanel;
  label: string;
  icon: typeof FolderKanban;
}> = [
  { id: "projects", label: "Projetos", icon: FolderKanban },
  { id: "basemap", label: "Mapa de fundo", icon: MapIcon },
  { id: "layers", label: "GeoServer", icon: Layers },
];

// Reaproveita a navegação compacta do stage, conservando seções visitadas
// montadas mesmo ao fechar para não perder busca/expansão da árvore.
export default function GlobalMapPanels({
  enabledIds,
  onChange,
  basemapId,
  onBasemapChange,
  viewMode,
  onRequest2D,
  contextualProjectId,
  selectionReady,
  selectionPending,
  selectionError,
  onRetrySelection,
}: GlobalMapPanelsProps) {
  const [activePanel, setActivePanel] = useState<MapPanel | null>(null);
  const [visitedPanels, setVisitedPanels] = useState<Set<MapPanel>>(
    () => new Set()
  );
  const triggerRefs = useRef<Record<MapPanel, HTMLButtonElement | null>>({
    projects: null,
    basemap: null,
    layers: null,
  });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const drawerOpen = activePanel !== null && activePanel !== "basemap";
  const closePanel = useCallback(() => {
    if (!activePanel) return;
    const previous = activePanel;
    setActivePanel(null);
    window.requestAnimationFrame(() => triggerRefs.current[previous]?.focus());
  }, [activePanel]);
  const selectPanel = (panel: MapPanel) => {
    setVisitedPanels(current =>
      current.has(panel) ? current : new Set(current).add(panel)
    );
    setActivePanel(panel);
  };
  useEffect(() => {
    if (!activePanel || activePanel === "basemap") return;
    headingRef.current?.focus();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        closePanel();
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [activePanel, closePanel]);

  return (
    <div
      data-testid="global-map-panels"
      data-html2canvas-ignore="true"
      className="pointer-events-none absolute inset-0 z-[1000] print:hidden"
    >
      <div
        role="group"
        aria-label="Seletores do mapa"
        className="pointer-events-auto absolute left-16 top-3 flex gap-1 rounded-xl border border-border bg-background/95 p-1 text-foreground shadow-lg backdrop-blur"
        style={{ width: "min(21rem, calc(100% - 8rem))" }}
      >
        {panelOptions.map(({ id, label, icon: Icon }) => id === "basemap" ? (
          <BasemapQuickSelector
            key={id}
            basemapId={basemapId}
            onBasemapChange={onBasemapChange}
            viewMode={viewMode}
            onRequest2D={onRequest2D}
            open={activePanel === "basemap"}
            onOpenChange={open => setActivePanel(current => open ? "basemap" : current === "basemap" ? null : current)}
          />
        ) : (
          <Button
            key={id}
            ref={element => {
              triggerRefs.current[id] = element;
            }}
            id={`map-panel-trigger-${id}`}
            type="button"
            variant={activePanel === id ? "default" : "ghost"}
            size="sm"
            onClick={() =>
              activePanel === id ? closePanel() : selectPanel(id)
            }
            aria-label={`${activePanel === id ? "Fechar" : "Abrir"} ${label}`}
            aria-expanded={activePanel === id}
            aria-controls="global-map-panel-drawer"
            data-testid={`map-panel-toggle-${id}`}
            title={label}
            className={`h-10 min-w-0 flex-1 gap-1 px-1 text-[10px] sm:gap-2 sm:px-2 sm:text-xs ${activePanel === id ? "bg-orange-500 text-white hover:bg-orange-600" : ""}`}
          >
            <Icon className="hidden h-4 w-4 shrink-0 sm:block" />
            <span className="truncate">{label}</span>
          </Button>
        ))}
      </div>
      {visitedPanels.size > 0 && (
        <section
          id="global-map-panel-drawer"
          role="region"
          aria-labelledby="global-map-panel-heading"
          hidden={!drawerOpen}
          data-testid="map-panel-drawer"
          className={`pointer-events-auto absolute left-3 top-16 flex-col overflow-hidden rounded-xl border border-border bg-background/95 text-foreground shadow-2xl backdrop-blur sm:left-16 ${drawerOpen ? "flex" : "hidden"}`}
          style={{
            width: "min(23rem, calc(100% - 4.5rem))",
            maxHeight: "min(72vh, calc(100% - 7rem))",
          }}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
            <h2
              id="global-map-panel-heading"
              ref={headingRef}
              tabIndex={-1}
              className="rounded text-sm font-semibold focus-visible:outline-2"
            >
              {activePanel === "layers" ? "Camadas institucionais" : panelOptions.find(panel => panel.id === activePanel)?.label ?? "Painel do mapa"}
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={closePanel}
              aria-label="Fechar painel do mapa"
              className="h-8 w-8 shrink-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain p-2">
            {visitedPanels.has("projects") && (
              <div hidden={activePanel !== "projects"}>
                <MyProjectsPanel
                  enabledIds={enabledIds}
                  onChange={onChange}
                  selectionReady={selectionReady}
                  selectionPending={selectionPending}
                  selectionError={selectionError}
                  onRetrySelection={onRetrySelection}
                  contextualProjectId={contextualProjectId}
                />
              </div>
            )}
            {visitedPanels.has("layers") && (
              <div hidden={activePanel !== "layers"} className="min-w-0 space-y-3">
                <InstitutionalLayersPanel />
                <h3 className="border-t border-border px-2 pt-3 text-sm font-semibold">Bases existentes (cache)</h3>
                <BaseLayersPanel viewMode={viewMode} />
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
