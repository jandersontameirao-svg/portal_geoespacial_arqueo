import { useMemo } from "react";
import { useIndeCatalog } from "./IndeCatalogLayers";
import InstitutionalGlobeOverlays from "./InstitutionalGlobeOverlays";

/** Ponte do estado federado para a cena real. Não altera câmera, base ou dados do projeto. */
export default function IndeGlobeLayers({
  globeRef,
  readyRevision,
}: {
  globeRef: { current: any };
  /** onGlobeReady incrementa esta revisão: refs isoladas não provocam render React. */
  readyRevision: number;
}) {
  const { selected, loadGlobeImage, report, statuses, viewMode } = useIndeCatalog();
  const layers = useMemo(
    () => selected.map(({ id, title, attribution }) => ({ id, title, attribution })),
    [selected],
  );
  if (viewMode !== "3d" || readyRevision < 1) return null;
  const ready = selected.filter(layer => statuses[layer.id]?.state === "ready");
  return <>
    <InstitutionalGlobeOverlays
      globeRef={globeRef}
      layers={layers}
      loadImage={loadGlobeImage}
      onStatus={report}
    />
    {ready.length > 0 && <div
      data-testid="inde-globe-attribution"
      className="pointer-events-none absolute bottom-14 right-2 z-10 max-w-[min(28rem,calc(100%-1rem))] rounded bg-white/90 px-2 py-1 text-right text-[10px] leading-tight text-slate-800 shadow print:hidden"
      aria-label="Fontes das camadas institucionais no globo"
    >
      {ready.map(layer => <p key={layer.id} className="[overflow-wrap:anywhere]">Fonte: {layer.attribution}</p>)}
      <p>Visualização WMS global · EPSG:4326 · catálogo INDE</p>
    </div>}
  </>;
}
