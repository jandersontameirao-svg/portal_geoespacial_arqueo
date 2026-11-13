import { WMSTileLayer } from "react-leaflet";
import { trpc } from "@/lib/trpc";

/**
 * Renderiza como sobreposição WMS cada conexão cadastrada que esteja ligada
 * (tipo WMS, com camada). Porte do comportamento da prévia (previewConnections).
 */
export default function ConnectionWmsLayers() {
  const { data: connections = [] } = trpc.connections.list.useQuery(undefined, {
    refetchOnWindowFocus: true,
  });
  const sources = connections.filter((c) => c.type === "WMS" && c.enabled && c.layer);
  return (
    <>
      {sources.map((source) => (
        <WMSTileLayer
          key={`${source.id}-${source.address}-${source.layer}`}
          url={source.address}
          layers={source.layer ?? ""}
          format="image/png"
          transparent
          version="1.1.1"
        />
      ))}
    </>
  );
}
