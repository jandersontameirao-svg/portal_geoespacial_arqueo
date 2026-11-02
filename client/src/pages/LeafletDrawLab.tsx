import { useMemo, useRef, useState } from "react";
import L from "leaflet";
import { FeatureGroup, MapContainer, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import "leaflet-draw";
import LeafletDrawControl from "@/components/LeafletDrawControl";
import "@/lib/leafletDefaultMarker";

export default function LeafletDrawLab() {
  const [featureGroup, setFeatureGroup] = useState<L.FeatureGroup | null>(null);
  const [features, setFeatures] = useState<any[]>([]);
  const sequence = useRef(0);
  const draw = useMemo<L.Control.DrawOptions>(() => ({ marker: {}, polyline: {}, polygon: {}, rectangle: {}, circle: false, circlemarker: false }), []);
  const replace = (layer: L.Layer) => {
    const id = (layer as any).options.labId || `lab-${++sequence.current}`;
    (layer as any).options.labId = id;
    const feature = (layer as any).toGeoJSON();
    feature.properties = { ...(feature.properties || {}), labId: id };
    setFeatures((current) => [...current.filter((item) => item.properties?.labId !== id), feature]);
  };
  const download = () => {
    const featureCollection = { type: "FeatureCollection", features };
    const href = URL.createObjectURL(new Blob([JSON.stringify(featureCollection, null, 2)], { type: "application/geo+json" }));
    const link = Object.assign(document.createElement("a"), { href, download: "leaflet-draw-lab.geojson" });
    link.click(); URL.revokeObjectURL(href);
  };
  const clear = () => { featureGroup?.clearLayers(); setFeatures([]); };
  return <main style={{ minHeight: "100vh", background: "#0f172a", color: "#e2e8f0", fontFamily: "system-ui, sans-serif", padding: "20px" }}>
    <section style={{ maxWidth: 1180, margin: "0 auto" }}>
      <p style={{ color: "#f59e0b", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 6 }}>Laboratório isolado</p>
      <h1 style={{ margin: 0, fontSize: 28 }}>Ensaio Leaflet Draw</h1>
      <p style={{ color: "#cbd5e1", maxWidth: 820 }}>Ambiente público de ensaio. As geometrias existem apenas na memória desta página: não são enviadas ao Portal, OAuth, banco, tRPC, storage ou auditoria.</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "16px 0" }}>
        <button onClick={download} disabled={!features.length} style={{ padding: "9px 14px", borderRadius: 6, border: 0, cursor: "pointer", background: "#10b981", color: "#06281e", fontWeight: 700 }}>Exportar GeoJSON ({features.length})</button>
        <button onClick={clear} disabled={!features.length} style={{ padding: "9px 14px", borderRadius: 6, border: "1px solid #475569", cursor: "pointer", background: "transparent", color: "#e2e8f0" }}>Limpar dados locais</button>
      </div>
      <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid #334155" }}>
        <MapContainer center={[-15.7801, -47.9292]} zoom={5} style={{ height: "640px", width: "100%" }}>
          <TileLayer attribution="Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
          <FeatureGroup ref={setFeatureGroup}>{featureGroup && <LeafletDrawControl featureGroup={featureGroup} draw={draw} onCreated={(event) => replace(event.layer)} onEdited={(event) => event.layers.eachLayer(replace)} onDeleted={(event) => event.layers.eachLayer((layer: any) => setFeatures((current) => current.filter((feature) => feature.properties?.labId !== layer.options.labId)))} />}</FeatureGroup>
        </MapContainer>
      </div>
      <p style={{ color: "#94a3b8", fontSize: 13 }}>Teste recomendado: desenhar marcador, linha, polígono e retângulo; editar e excluir; exportar GeoJSON; limpar e recarregar. Após refresh, nenhuma feição persiste por design.</p>
    </section>
  </main>;
}
