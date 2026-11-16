import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { trpc } from "@/lib/trpc";

/**
 * Renderiza como sobreposição cada conexão ArcGIS REST ligada (tipo "ArcGIS REST"
 * com índice(s) de camada). Cada tile do Leaflet é desenhado pelo endpoint
 * /export do MapServer na mesma extensão Web Mercator. Porte do ArcGisTiles da
 * prévia do Codex, generalizado para as conexões reais.
 */
function ArcGisTiles({ address, layer, name }: { address: string; layer: string; name: string }) {
  const map = useMap();
  useEffect(() => {
    const tileSize = 256;
    const tiles = L.tileLayer(address + "/export", { tileSize, attribution: name });
    tiles.getTileUrl = ({ x, y, z }: L.Coords) => {
      const northwest = L.CRS.EPSG3857.project(map.unproject(L.point(x * tileSize, y * tileSize), z));
      const southeast = L.CRS.EPSG3857.project(map.unproject(L.point((x + 1) * tileSize, (y + 1) * tileSize), z));
      const url = new URL(address + "/export");
      url.search = new URLSearchParams({
        bbox: [northwest.x, southeast.y, southeast.x, northwest.y].join(","),
        bboxSR: "3857", imageSR: "3857", size: "256,256", format: "png32",
        transparent: "true", layers: "show:" + layer, f: "image",
      }).toString();
      return url.href;
    };
    tiles.addTo(map);
    return () => { tiles.remove(); };
  }, [map, address, layer, name]);
  return null;
}

export default function ArcGisRestLayers() {
  const { data: connections = [] } = trpc.connections.list.useQuery(undefined, {
    refetchOnWindowFocus: true,
  });
  const sources = connections.filter((c) => c.type === "ArcGIS REST" && c.enabled && c.layer);
  return (
    <>
      {sources.map((source) => (
        <ArcGisTiles
          key={`${source.id}-${source.address}-${source.layer}`}
          address={source.address}
          layer={source.layer ?? ""}
          name={source.name}
        />
      ))}
    </>
  );
}
