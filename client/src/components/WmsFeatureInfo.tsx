import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { trpc } from "@/lib/trpc";

/**
 * Identificar em camadas WMS — ao clicar no mapa, consulta o GetFeatureInfo de
 * cada conexão WMS ligada e abre um popup com os atributos da feição sob o
 * ponto. Porte do ArchaeologicalWmsIdentify da prévia do Codex, generalizado
 * para qualquer fonte WMS (não só sítios arqueológicos). O IPHAN é ignorado
 * aqui porque tem a ferramenta própria "Consultar sítios IPHAN".
 */

// Campos de geometria/controle que não interessam no popup.
const HIDDEN = /^(geometry|bbox|the_geom|geom|shape|st_asgeojson|boundedby)$/i;

function propsCard(title: string, props: Record<string, unknown>): HTMLElement | null {
  const entries = Object.entries(props).filter(
    ([key, value]) => value != null && value !== "" && typeof value !== "object" && !HIDDEN.test(key),
  );
  if (!entries.length) return null;
  const card = document.createElement("article");
  card.className = "space-y-1 border-b pb-2 pt-1";
  const strong = document.createElement("strong");
  strong.className = "block";
  strong.textContent = title;
  card.append(strong);
  for (const [key, value] of entries.slice(0, 12)) {
    const line = document.createElement("div");
    line.className = "text-xs";
    line.textContent = key + ": " + String(value).slice(0, 200);
    card.append(line);
  }
  return card;
}

export default function WmsFeatureInfo() {
  const map = useMap();
  const { data: connections = [] } = trpc.connections.list.useQuery(undefined, {
    refetchOnWindowFocus: true,
  });
  const sources = connections.filter(
    (c) => c.enabled && c.type === "WMS" && c.layer && !/SICG:sitios/.test(c.layer),
  );
  // Assinatura estável para não re-assinar o clique a cada render.
  const key = sources.map((s) => `${s.id}:${s.layer}`).join("|");
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  useEffect(() => {
    if (!sourcesRef.current.length) return;
    let request: AbortController | undefined;
    const identify = async (event: L.LeafletMouseEvent) => {
      if (map.getZoom() < 10 || (event.originalEvent.target as Element | null)?.closest?.(".leaflet-interactive")) return;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const bounds = map.getBounds();
      const sw = L.CRS.EPSG3857.project(bounds.getSouthWest());
      const ne = L.CRS.EPSG3857.project(bounds.getNorthEast());
      const { x, y } = map.latLngToContainerPoint(event.latlng);
      const size = map.getSize();
      const content = document.createElement("div");
      content.className = "space-y-2";
      await Promise.all(
        sourcesRef.current.map(async (source) => {
          try {
            const endpoint = new URL(source.address);
            const params: Record<string, string | number> = {
              SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetFeatureInfo",
              SRS: "EPSG:3857", BBOX: [sw.x, sw.y, ne.x, ne.y].join(","),
              WIDTH: size.x, HEIGHT: size.y, X: Math.round(x), Y: Math.round(y),
              LAYERS: source.layer ?? "", QUERY_LAYERS: source.layer ?? "", STYLES: "",
              FORMAT: "image/png", INFO_FORMAT: "application/json", FEATURE_COUNT: 5,
            };
            for (const [k, v] of Object.entries(params)) endpoint.searchParams.set(k, String(v));
            const response = await fetch(endpoint, { signal: controller.signal });
            if (!response.ok) return;
            const result = await response.json();
            if (!Array.isArray(result.features) || controller.signal.aborted) return;
            for (const feature of result.features.slice(0, 5)) {
              const card = propsCard(source.name, feature.properties ?? {});
              if (card) content.append(card);
            }
          } catch {
            // Fonte sem atributos consultáveis pelo navegador segue visível como imagem.
          }
        }),
      );
      if (!controller.signal.aborted && content.childElementCount) {
        L.popup({ maxWidth: 360, maxHeight: 320 }).setLatLng(event.latlng).setContent(content).openOn(map);
      }
    };
    map.on("click", identify);
    return () => { request?.abort(); map.off("click", identify); };
  }, [map, key]);

  return null;
}
