import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { Layers, X } from "lucide-react";
import { trpc } from "@/lib/trpc";

/**
 * Controle "Camadas do mapa" (topo direito) — liga/desliga no próprio mapa as
 * fontes WMS e ArcGIS REST cadastradas (ex.: Sítios do IPHAN SICG, patrimônio
 * estadual, fundiário INCRA, cavidades), organizadas por grupo, sem precisar ir
 * à página de administração. Porte do painel "Camadas do mapa" da prévia do
 * Codex, generalizado para as conexões reais (connections.list/save + groupKey).
 *
 * Fica abaixo dos controles IBGE (.75rem) e de sítios IPHAN (3.75rem).
 */

// Títulos e ordem dos grupos, como o dev organizou na prévia.
const GROUPS: { key: string; title: string }[] = [
  { key: "patrimonio-estadual", title: "Patrimônio cultural estadual" },
  { key: "cavidades", title: "Cavidades naturais" },
  { key: "fundiario", title: "Imóveis rurais e fundiário" },
  { key: "uso-solo", title: "Uso e cobertura do solo" },
  { key: "recursos-hidricos", title: "Recursos hídricos" },
  { key: "relevo", title: "Relevo e topografia" },
  { key: "infraestrutura-eletrica", title: "Infraestrutura elétrica" },
];

export default function ConnectionLayersControl() {
  const map = useMap();
  const utils = trpc.useUtils();
  const controlRef = useRef<HTMLDetailsElement>(null);
  const { data: connections = [] } = trpc.connections.list.useQuery(undefined, {
    refetchOnWindowFocus: true,
  });
  const save = trpc.connections.save.useMutation({
    onSuccess: () => utils.connections.list.invalidate(),
  });

  useEffect(() => {
    const control = controlRef.current;
    if (control) {
      L.DomEvent.disableClickPropagation(control);
      L.DomEvent.disableScrollPropagation(control);
    }
  }, [map]);

  function closePanel() {
    const control = controlRef.current;
    if (!control?.open) return;
    control.open = false;
    control.querySelector("summary")?.focus();
  }

  // Só fontes WMS e ArcGIS REST com camada podem ser exibidas no mapa.
  const displayable = connections.filter((c) => (c.type === "WMS" || c.type === "ArcGIS REST") && c.layer);
  const others = connections.filter((c) => !((c.type === "WMS" || c.type === "ArcGIS REST") && c.layer));

  const ungrouped = displayable.filter((c) => !c.groupKey);
  const grouped = GROUPS.map((group) => ({
    ...group,
    sources: displayable.filter((c) => c.groupKey === group.key),
  })).filter((group) => group.sources.length > 0);

  function toggle(source: (typeof connections)[number], enabled: boolean) {
    save.mutate({
      id: source.id,
      name: source.name,
      type: source.type as "WMS" | "ArcGIS REST",
      address: source.address,
      layer: source.layer ?? "",
      enabled,
      groupKey: source.groupKey ?? null,
    });
  }

  function renderSource(source: (typeof connections)[number]) {
    return (
      <div key={source.id} className="rounded px-2 py-1.5 text-xs hover:bg-slate-50">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={!!source.enabled}
            disabled={save.isPending}
            onChange={(event) => toggle(source, event.target.checked)}
          />
          <span>{source.name}</span>
        </label>
      </div>
    );
  }

  return (
    <details
      ref={controlRef}
      className="preview-ibge-control"
      style={{ top: "6.75rem" }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && event.currentTarget.open) {
          event.stopPropagation();
          closePanel();
        }
      }}
    >
      <summary aria-label="Camadas do mapa" title="Camadas do mapa (IPHAN e outras fontes oficiais)">
        <Layers size={20} aria-hidden="true" />
      </summary>
      <div className="preview-ibge-panel max-h-[70vh] overflow-auto rounded-lg border bg-white p-2 shadow-lg">
        <div className="flex items-center justify-between gap-2 pl-2">
          <h3 className="text-xs font-semibold">Camadas do mapa</h3>
          <button
            type="button"
            onClick={closePanel}
            aria-label="Fechar Camadas do mapa"
            title="Fechar Camadas do mapa"
            className="grid size-7 shrink-0 place-items-center rounded-md text-slate-700 hover:bg-slate-100 focus-visible:outline-2"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {displayable.length === 0 && others.length === 0 && (
          <p className="px-2 py-1 text-[11px] text-slate-600">
            Nenhuma fonte cadastrada. Cadastre em Conexões de mapa.
          </p>
        )}

        {/* Fontes sem grupo (IPHAN, terras indígenas, quilombolas…) no topo. */}
        {ungrouped.map(renderSource)}

        {/* Grupos organizados, colapsáveis. */}
        {grouped.map((group) => (
          <details key={group.key} className="border-t py-1 text-sm">
            <summary className="cursor-pointer px-2 py-1 text-xs font-medium">{group.title}</summary>
            <div className="ml-1">{group.sources.map(renderSource)}</div>
          </details>
        ))}

        {others.length > 0 && (
          <div className="mt-1 border-t pt-1">
            <p className="px-2 pb-1 text-[10px] uppercase tracking-wide text-slate-400">
              Registradas (não exibíveis no mapa)
            </p>
            {others.map((source) => (
              <p key={source.id} className="px-2 py-0.5 text-[11px] text-slate-500">
                {source.name}
              </p>
            ))}
          </div>
        )}

        {save.isError && (
          <p role="alert" className="px-2 pt-1 text-[11px] text-red-700">
            {save.error.message || "Não foi possível alterar a camada."}
          </p>
        )}
      </div>
    </details>
  );
}
