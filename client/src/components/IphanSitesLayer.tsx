import { useEffect, useRef, useState } from "react";
import { GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import { Landmark } from "lucide-react";
import type { FeatureCollection } from "geojson";
import { trpc } from "@/lib/trpc";

const MIN_ZOOM = 11;

/**
 * Sítios arqueológicos do IPHAN (SICG) dentro da vista, como camada consultável.
 * Porte da prévia do Codex (iphanRecords) via router iphanSites.inView.
 */
export default function IphanSitesLayer() {
  const map = useMap();
  const utils = trpc.useUtils();
  const controlRef = useRef<HTMLDetailsElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [result, setResult] = useState<FeatureCollection>();
  const [status, setStatus] = useState("");

  useEffect(() => {
    const control = controlRef.current;
    if (control) { L.DomEvent.disableClickPropagation(control); L.DomEvent.disableScrollPropagation(control); }
  }, [map]);

  useEffect(() => {
    if (!enabled) { setResult(undefined); setStatus(""); return; }
    let cancelled = false;
    const update = async () => {
      if (map.getZoom() < MIN_ZOOM) { setResult(undefined); setStatus("Aproxime o mapa para consultar os sítios"); return; }
      setStatus("Consultando IPHAN…");
      try {
        const data = await utils.iphanSites.inView.fetch({ bbox: map.getBounds().toBBoxString() });
        if (cancelled) return;
        const collection = data as unknown as FeatureCollection;
        setResult(collection);
        setStatus(collection.features.length ? "" : "Nenhum sítio nesta vista");
      } catch (error: any) {
        if (!cancelled) { setResult(undefined); setStatus(error?.message || "IPHAN indisponível"); }
      }
    };
    void update();
    map.on("moveend", update);
    return () => { cancelled = true; map.off("moveend", update); };
  }, [enabled, map, utils]);

  return (
    <details ref={controlRef} className="preview-ibge-control" style={{ top: "3.75rem" }}>
      <summary aria-label="Sítios do IPHAN" title="Sítios arqueológicos do IPHAN (SICG)">
        <Landmark size={20} aria-hidden="true" />
      </summary>
      <div className="preview-ibge-panel rounded-lg border bg-white p-2 text-xs shadow-lg">
        <label className="flex cursor-pointer items-center gap-2 px-1 py-1">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: "#b84c1b" }} />
          Sítios IPHAN (SICG)
        </label>
        {status && <p role="status" className="px-1 pt-1 text-[11px] text-slate-600">{status}</p>}
      </div>
      {enabled && result && (
        <GeoJSON
          key={JSON.stringify(result.features.map((feature) => feature.properties?.id))}
          data={result}
          style={{ color: "#b84c1b", weight: 1, fillOpacity: 0.15 }}
          pointToLayer={(_, point) => L.circleMarker(point, { radius: 4, color: "#b84c1b", fillOpacity: 0.85 })}
          onEachFeature={(feature, item) => {
            const p = feature.properties || {};
            const el = document.createElement("div");
            el.innerHTML = "";
            const strong = document.createElement("strong");
            strong.textContent = String(p.nome || "Sítio arqueológico");
            const info = document.createElement("div");
            info.className = "text-xs";
            info.textContent = [p.codigo && ("Código: " + p.codigo), p.classificacao, p.tipoBem].filter(Boolean).join(" · ");
            el.appendChild(strong); el.appendChild(info);
            item.bindPopup(el);
            item.bindTooltip(String(p.nome || p.codigo || "Sítio"), { sticky: true });
          }}
        />
      )}
    </details>
  );
}
