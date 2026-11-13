import { useEffect, useRef, useState } from "react";
import { GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import { MapPinned, X } from "lucide-react";
import type { FeatureCollection } from "geojson";
import { trpc } from "@/lib/trpc";

const LAYERS = [
  { id: "estados", label: "Estados", color: "#6366f1", zoom: 0 },
  { id: "municipios", label: "Municípios", color: "#0891b2", zoom: 7 },
  { id: "localidades", label: "Localidades", color: "#f97316", zoom: 10 },
] as const;

function OfficialLayer({ layer, projectBounds }: { layer: typeof LAYERS[number]; projectBounds?: string }) {
  const map = useMap();
  const utils = trpc.useUtils();
  const [result, setResult] = useState<FeatureCollection>();
  const [status, setStatus] = useState("");
  const [showNames, setShowNames] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const update = async () => {
      setShowNames(layer.id === "municipios" && map.getZoom() >= (projectBounds ? 7 : 8));
      if (layer.id === "municipios" && projectBounds === "") {
        setResult(undefined);
        setStatus("Adicione uma camada geográfica para localizar o projeto");
        return;
      }
      if (map.getZoom() < layer.zoom) {
        setResult(undefined);
        setStatus("Aproxime o mapa");
        return;
      }
      setStatus("Carregando…");
      try {
        const data = await utils.ibgeLocal.layer.fetch({
          id: layer.id,
          bbox: map.getBounds().toBBoxString(),
          projeto: layer.id === "municipios" && projectBounds ? projectBounds : undefined,
        });
        if (cancelled) return;
        if (!data) { setResult(undefined); setStatus("Base indisponível"); return; }
        const collection = data as unknown as FeatureCollection & { zoomRequired?: boolean };
        setResult(collection);
        setStatus(collection.zoomRequired ? "Aproxime o mapa" : collection.features.length ? "" : "Sem feições nesta vista");
      } catch {
        if (!cancelled) { setResult(undefined); setStatus("Base indisponível"); }
      }
    };
    void update();
    map.on("moveend", update);
    return () => { cancelled = true; map.off("moveend", update); };
  }, [layer, map, projectBounds, utils]);

  return (
    <>
      {status && <span className="block text-[11px] text-slate-600" role="status">{status}</span>}
      {result && (
        <GeoJSON
          key={String(showNames) + JSON.stringify(result.features.map((feature) => feature.properties?.codigo))}
          data={result}
          style={{ color: layer.color, weight: layer.id === "estados" ? 2 : 1, fillOpacity: 0 }}
          pointToLayer={(_, point) => L.circleMarker(point, { radius: 3, color: layer.color, fillOpacity: 0.9 })}
          onEachFeature={(feature, item) => {
            const label = document.createElement("span");
            label.textContent = [feature.properties?.nome, feature.properties?.uf].filter(Boolean).join(" · ");
            if (showNames && feature.properties?.rotulo) {
              item.bindTooltip(label, { permanent: true, direction: "center", className: "municipio-ibge-label" });
              const [lon, lat] = feature.properties.rotulo;
              item.getTooltip()?.setLatLng([lat, lon]);
            } else item.bindTooltip(label, { sticky: true });
            const popup = document.createElement("span");
            popup.textContent = label.textContent + " — IBGE " + (layer.id === "localidades" ? "2022" : "2024");
            item.bindPopup(popup);
          }}
        />
      )}
    </>
  );
}

export default function IbgeLocalLayers({ projectBounds }: { projectBounds?: string }) {
  const map = useMap();
  const controlRef = useRef<HTMLDetailsElement>(null);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({ municipios: true });

  useEffect(() => {
    const control = controlRef.current;
    if (control) { L.DomEvent.disableClickPropagation(control); L.DomEvent.disableScrollPropagation(control); }
  }, [map]);

  function closePanel() {
    const control = controlRef.current;
    if (!control?.open) return;
    control.open = false;
    control.querySelector("summary")?.focus();
  }

  return (
    <details ref={controlRef} className="preview-ibge-control" onKeyDown={(event) => {
      if (event.key === "Escape" && event.currentTarget.open) { event.stopPropagation(); closePanel(); }
    }}>
      <summary aria-label="Camadas IBGE" title="Camadas IBGE">
        <MapPinned size={20} aria-hidden="true" />
      </summary>
      <div className="preview-ibge-panel rounded-lg border bg-white p-2 shadow-lg">
        <div className="flex items-center justify-between gap-2 pl-2">
          <h3 className="text-xs font-semibold">Camadas IBGE</h3>
          <button type="button" onClick={closePanel} aria-label="Fechar Camadas IBGE" title="Fechar Camadas IBGE"
            className="grid size-7 shrink-0 place-items-center rounded-md text-slate-700 hover:bg-slate-100 focus-visible:outline-2">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {LAYERS.map((layer) => (
          <div key={layer.id} className="rounded px-2 py-1.5 text-xs hover:bg-slate-50">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={!!enabled[layer.id]} onChange={(event) => {
                const checked = event.target.checked;
                setEnabled((current) => ({ ...current, [layer.id]: checked }));
              }} />
              <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: layer.color }} />
              {layer.label}
            </label>
            {enabled[layer.id] && <OfficialLayer layer={layer} projectBounds={projectBounds} />}
          </div>
        ))}
      </div>
    </details>
  );
}
