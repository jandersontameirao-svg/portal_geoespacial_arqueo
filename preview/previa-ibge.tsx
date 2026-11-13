import { useEffect, useRef, useState } from "react";
import { GeoJSON, WMSTileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { Layers, X } from "lucide-react";
import type { FeatureCollection } from "geojson";

const layers = [
  { id: "estados", label: "Estados", color: "#6366f1", zoom: 0 },
  { id: "municipios", label: "Municípios", color: "#0891b2", zoom: 7 },
  { id: "localidades", label: "Localidades", color: "#f97316", zoom: 10 },
] as const;

const palmaresLayer = { id: "palmares", label: "Municípios com comunidades certificadas", color: "#a855f7", zoom: 0 } as const;

function OfficialLayer({ layer, projectBounds }: { layer: typeof layers[number] | typeof palmaresLayer; projectBounds?: string }) {
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
    {status && layer.id !== "palmares" && <span className="block text-[11px] text-slate-600" role="status">{status}</span>}
    {result && <GeoJSON key={showNames + JSON.stringify(result.features.map(feature => feature.properties?.codigo))} data={result}
      style={{ color: layer.color, weight: layer.id === "estados" ? 2 : 1,
        fillOpacity: layer.id === "palmares" ? 0.35 : 0,
        className: layer.id === "palmares" ? "preview-palmares-municipio" : undefined }}
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
        popup.textContent = label.textContent + (layer.id === "palmares"
          ? " — Município com comunidade certificada pela Fundação Cultural Palmares. Limite municipal do IBGE."
          : " — IBGE " + (layer.id === "localidades" ? "2022" : "2024"));
        item.bindPopup(popup);
      }} />}
  </>;
}

type MapSource = { id: number; name: string; address: string; layer: string; type: string; official?: boolean; enabled: boolean; selectedLayers?: string[]; availableLayers?: string[]; group?: string };

const childNames: Record<string, string> = {
  "IDE:ide_2017_mg_tombamento_iepha_pto": "Bens culturais tombados",
  "IDE:ide_2017_mg_ai_patrimonio_cultural_iepha_pol": "Áreas de influência do patrimônio cultural",
  "IDE:ide_2017_mg_celebracoes_formas_expressao_iepha_pto": "Celebrações e formas de expressão",
  "IDE:ide_2017_mg_lugares_iepha_pto": "Lugares de referência cultural",
  "IDE:ide_2017_mg_saberes_iepha_pol": "Saberes",
  "SICG:sitios": "Sítios arqueológicos · pontos",
  "SICG:sitios_pol": "Sítios arqueológicos · polígonos",
  "DBGEO:Empreendimentos": "Empreendimentos · FCA (grupo oficial)",
  "fca:fca": "FCA · camada individual",
  "CMR-PUBLICO:lim_terra_indigena_a": "Terras indígenas",
  palmares: palmaresLayer.label,
};

function childrenFor(source: MapSource) {
  if (source.id === -2) return layers.map(layer => ({ id: layer.id, label: layer.label }));
  return [...(source.availableLayers ?? []), ...(source.layer || "").split(",").filter(Boolean)].map(id => ({
    id, label: childNames[id] ?? (id === "0" ? source.name.split(" · ")[1] ?? id : id),
  }));
}

function selectedFor(source: MapSource) {
  return source.selectedLayers ?? (source.id === -2 ? ["municipios"] : (source.layer || "").split(",").filter(Boolean));
}

type CatalogLayer = { id: string; label: string };

async function discoverLayers(source: MapSource): Promise<CatalogLayer[]> {
  const url = new URL(source.address);
  const options = { signal: AbortSignal.timeout(12000), credentials: "omit" as const };
  if (source.type === "ArcGIS REST") {
    url.searchParams.set("f", "json");
    const response = await fetch(url, options);
    if (!response.ok) throw Error();
    const data = await response.json();
    if (!Array.isArray(data.layers)) throw Error();
    return data.layers.filter((layer: any) => Number.isInteger(layer.id) && !layer.subLayerIds?.length)
      .map((layer: any) => ({ id: String(layer.id), label: String(layer.name) }));
  }
  url.search = new URLSearchParams({ service: "WMS", request: "GetCapabilities", version: "1.1.1" }).toString();
  const response = await fetch(source.id === -1 || source.id === -3
    ? "/previa/catalogo-wms?id=" + source.id : url.href, options);
  if (!response.ok) throw Error();
  const xml = new DOMParser().parseFromString(await response.text(), "application/xml");
  if (!["WMT_MS_Capabilities", "WMS_Capabilities"].includes(xml.documentElement.localName)) throw Error();
  return [...xml.getElementsByTagNameNS("*", "Layer")].flatMap(layer => {
    const fields = [...layer.children];
    const id = fields.find(field => field.localName === "Name")?.textContent?.trim();
    const label = fields.find(field => field.localName === "Title")?.textContent?.trim();
    return id && /^[\w.:-]{1,150}$/.test(id) ? [{ id, label: label || id }] : [];
  });
}

function ArcGisTiles({ source }: { source: MapSource }) {
  const map = useMap();
  useEffect(() => {
    // ArcGIS export renders each Leaflet tile using the same Web Mercator extent.
    const tileSize = 256;
    const tiles = L.tileLayer(source.address + "/export", { tileSize, attribution: source.name });
    tiles.getTileUrl = ({ x, y, z }: L.Coords) => {
      const northwest = L.CRS.EPSG3857.project(map.unproject(L.point(x * tileSize, y * tileSize), z));
      const southeast = L.CRS.EPSG3857.project(map.unproject(L.point((x + 1) * tileSize, (y + 1) * tileSize), z));
      const url = new URL(source.address + "/export");
      url.search = new URLSearchParams({
        bbox: [northwest.x, southeast.y, southeast.x, northwest.y].join(","),
        bboxSR: "3857", imageSR: "3857", size: "256,256", format: "png32",
        transparent: "true", layers: "show:" + source.layer, f: "image",
      }).toString();
      return url.href;
    };
    tiles.addTo(map);
    return () => { tiles.remove(); };
  }, [map, source]);
  return null;
}

export default function PreviewIbgeLayers({ projectBounds }: { projectBounds?: string }) {
  const map = useMap();
  const controlRef = useRef<HTMLDetailsElement>(null);
  const [connections, setConnections] = useState<MapSource[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [catalogs, setCatalogs] = useState<Record<string, CatalogLayer[] | "loading" | "error">>({});
  const loadingCatalogs = useRef(new Set<string>());
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => fetch("/api/trpc/previewConnections.list", { signal: controller.signal, cache: "no-store" })
      .then(r => r.json()).then(data => {
        if (controller.signal.aborted) return;
        const connections: MapSource[] = data.result?.data?.json ?? [];
        setConnections(connections);
        setError("");
      }).catch(() => { if (!controller.signal.aborted) setError("Não foi possível carregar as camadas."); });
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

  async function saveVisibility(source: MapSource, enabled: boolean, selectedLayers?: string[]) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/trpc/previewConnections.save", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: { ...source, enabled, selectedLayers } }),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) throw Error();
      const saved: MapSource = payload.result.data.json;
      setConnections(current => current.map(item => item.id === saved.id ? saved : item));
      window.dispatchEvent(new Event("preview-connections-changed"));
    } catch {
      setError("Não foi possível salvar a visibilidade.");
    } finally {
      setBusy(false);
    }
  }

  async function loadCatalog(source: MapSource, key: string) {
    if (loadingCatalogs.current.has(key) || Array.isArray(catalogs[key])) return;
    loadingCatalogs.current.add(key);
    setCatalogs(current => ({ ...current, [key]: "loading" }));
    try {
      const items = await discoverLayers(source);
      setCatalogs(current => ({ ...current, [key]: items }));
    } catch {
      setCatalogs(current => ({ ...current, [key]: "error" }));
    } finally {
      loadingCatalogs.current.delete(key);
    }
  }

  const active = connections.filter(source => source.enabled);
  const ibge = active.find(source => source.id === -2);
  const sources = active.filter(source => source.type === "WMS" || (source.official && source.type === "ArcGIS REST"))
    .map(source => ({ ...source, layer: selectedFor(source).join(",") })).filter(source => source.layer);

  return <>{active.some(source => source.id === -5 && selectedFor(source).includes("palmares")) && <OfficialLayer layer={palmaresLayer} />}
  {sources.map(source => source.type === "ArcGIS REST"
    ? <ArcGisTiles key={source.id} source={source} />
    : <WMSTileLayer key={source.id + source.address + source.layer} url={source.address} layers={source.layer} format="image/png" transparent version="1.1.1" />)}
  <details ref={controlRef} className="preview-ibge-control" onKeyDown={event => {
    if (event.key === "Escape" && event.currentTarget.open) {
      event.stopPropagation();
      closePanel();
    }
  }}>
    <summary aria-label="Camadas do mapa" title="Camadas do mapa">
      <Layers size={20} aria-hidden="true" />
    </summary>
    <div className="preview-ibge-panel rounded-lg border bg-white p-2 shadow-lg">
    <div className="flex items-center justify-between gap-2 pl-2">
      <h3 className="text-sm font-semibold">Camadas do mapa</h3>
      <button type="button" onClick={closePanel} aria-label="Fechar camadas do mapa" title="Fechar camadas do mapa"
        className="grid size-7 shrink-0 place-items-center rounded-md text-slate-700 hover:bg-slate-100 focus-visible:outline-2">
        <X size={16} aria-hidden="true" />
      </button>
    </div>
    {error && <p role="alert" className="px-2 text-xs text-red-700">{error}</p>}
    {(() => {
    const renderSource = (source: MapSource) => {
      const key = source.id + ":" + source.address;
      const catalog = catalogs[key];
      const remote = !source.group && (source.type === "WMS" || source.type === "ArcGIS REST");
      const children = [...new Map([
        ...(Array.isArray(catalog) ? catalog : []),
        ...childrenFor(source),
      ].map(child => [child.id, child])).values()];
      children.sort((a, b) => Number((source.availableLayers ?? []).includes(b.id)) - Number((source.availableLayers ?? []).includes(a.id)));
      const selected = selectedFor(source);
      for (const id of selected) if (!children.some(child => child.id === id)) children.push({ id, label: id });
      const groupOn = source.enabled && selected.length > 0;
      return <details key={key} className="border-t py-1 text-sm" onToggle={event => {
        if (event.currentTarget.open && remote) void loadCatalog(source, key);
      }}>
        <summary className="cursor-pointer px-2 py-1">
          <input type="checkbox" aria-label={source.name} disabled={busy} checked={groupOn}
            className="ml-1 mr-2" onClick={event => event.stopPropagation()}
            ref={input => { if (input) input.indeterminate = groupOn && selected.length < children.length; }}
            onChange={() => void saveVisibility(source, !groupOn, !groupOn && !selected.length
              ? childrenFor(source).filter(child => !source.availableLayers?.includes(child.id)).map(child => child.id) : selected)} />
          <span>{source.group ? source.name : source.name.split(" · ")[0]}</span>
        </summary>
        {catalog === "loading" && <p role="status" className="ml-5 text-xs">Carregando subcamadas…</p>}
        {catalog === "error" && <button type="button" className="ml-5 text-xs underline" onClick={() => void loadCatalog(source, key)}>Catálogo indisponível · tentar novamente</button>}
        {children.map(child => <label key={child.id} className="ml-5 flex cursor-pointer items-center gap-2 px-2 py-1 text-xs">
          <input type="checkbox" disabled={busy} checked={source.enabled && selected.includes(child.id)}
            onChange={event => {
              const selection = source.enabled ? selected : [];
              const next = event.target.checked ? [...selection, child.id] : selection.filter(id => id !== child.id);
              if (next.length > 40) { setError("Selecione até 40 subcamadas por fonte."); return; }
              void saveVisibility(source, next.length > 0, next);
            }} />
          {child.label}
        </label>)}
      </details>;
    };
    const mapped = connections.filter(source => source.layer && (source.official || source.type === "WMS"));
    return <>
      {mapped.filter(source => !source.group).map(renderSource)}
      <details className="border-t py-1 text-sm">
        <summary className="cursor-pointer px-2 py-1">Patrimônio cultural estadual</summary>
        <div className="ml-3">
          {mapped.filter(source => source.group === "patrimonio-estadual").map(renderSource)}
          <p className="px-2 py-1 text-xs text-slate-600">
            Geosserviço a confirmar: <a className="underline" target="_blank" rel="noreferrer" href="https://www.cultura.sp.gov.br/sec_cultura/CONDEPHAAT/Bens_Protegidos/Mapa_Interativo">SP · Condephaat</a>
          </p>
        </div>
      </details>
    </>;
    })()}
    {ibge && layers.filter(layer => selectedFor(ibge).includes(layer.id)).map(layer =>
      <OfficialLayer key={layer.id} layer={layer} projectBounds={projectBounds} />)}
    </div>
  </details></>;
}
