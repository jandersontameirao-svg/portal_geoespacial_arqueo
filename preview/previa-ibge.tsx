import { useEffect, useRef, useState } from "react";
import { GeoJSON, WMSTileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { MapPinned, X } from "lucide-react";
import type { FeatureCollection } from "geojson";

const layers = [
  { id: "estados", label: "Estados", color: "#6366f1", zoom: 0 },
  { id: "municipios", label: "Municípios", color: "#0891b2", zoom: 7 },
  { id: "localidades", label: "Localidades", color: "#f97316", zoom: 10 },
] as const;

function OfficialLayer({ layer, projectBounds }: { layer: typeof layers[number]; projectBounds?: string }) {
  const map = useMap();
  const [result, setResult] = useState<FeatureCollection>();
  const [status, setStatus] = useState("");
  const [showNames, setShowNames] = useState(false);
  useEffect(() => {
    let controller: AbortController;
    const update = () => {
      controller?.abort();
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
      controller = new AbortController();
      const { signal } = controller;
      setStatus("Carregando…");
      const query = new URLSearchParams({ bbox: map.getBounds().toBBoxString() });
      if (layer.id === "municipios" && projectBounds) query.set("projeto", projectBounds);
      fetch("/previa/ibge/" + layer.id + "?" + query, { signal })
        .then(response => {
          if (!response.ok) throw new Error();
          return response.json();
        }).then(data => {
          if (signal.aborted) return;
          setResult(data);
          setStatus(data.zoomRequired ? "Aproxime o mapa" : data.features.length ? "" : "Sem feições nesta vista");
        }).catch(() => {
          if (!signal.aborted) { setResult(undefined); setStatus("Base indisponível"); }
        });
    };
    update();
    map.on("moveend", update);
    return () => { controller?.abort(); map.off("moveend", update); };
  }, [layer, map, projectBounds]);
  return <>
    {status && <span className="block text-[11px] text-slate-600" role="status">{status}</span>}
    {result && <GeoJSON key={showNames + JSON.stringify(result.features.map(feature => feature.properties?.codigo))} data={result}
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
      }} />}
  </>;
}

export default function PreviewIbgeLayers({ projectBounds }: { projectBounds?: string }) {
  const map = useMap();
  const controlRef = useRef<HTMLDetailsElement>(null);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({ municipios: true });
  const [ibgeEnabled, setIbgeEnabled] = useState(true);
  const [sources, setSources] = useState<{ id: number; address: string; layer: string }[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => fetch("/api/trpc/previewConnections.list", { signal: controller.signal, cache: "no-store" })
      .then(r => r.json()).then(data => {
        if (controller.signal.aborted) return;
        const connections = data.result?.data?.json ?? [];
        setIbgeEnabled(connections.find((source: any) => source.id === -2)?.enabled ?? true);
        setSources(connections.filter((source: any) => source.type === "WMS" && source.enabled && source.layer));
      }).catch(() => {});
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("preview-connections-changed", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("preview-connections-changed", refresh);
    };
  }, []);
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

  return <>{sources.map(source => <WMSTileLayer key={source.id + source.address + source.layer} url={source.address} layers={source.layer} format="image/png" transparent version="1.1.1" />)}
  <details ref={controlRef} className="preview-ibge-control" onKeyDown={event => {
    if (event.key === "Escape" && event.currentTarget.open) {
      event.stopPropagation();
      closePanel();
    }
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
    {layers.map(layer => <div key={layer.id} className="rounded px-2 py-1.5 text-xs hover:bg-slate-50">
      <label className="flex cursor-pointer items-center gap-2">
        <input type="checkbox" disabled={!ibgeEnabled} checked={ibgeEnabled && !!enabled[layer.id]} onChange={event => {
          const checked = event.target.checked;
          setEnabled(current => ({ ...current, [layer.id]: checked }));
        }} />
        <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: layer.color }} />
        {layer.label}
      </label>
      {ibgeEnabled && enabled[layer.id] && <OfficialLayer layer={layer} projectBounds={projectBounds} />}
    </div>)}
    </div>
  </details></>;
}
