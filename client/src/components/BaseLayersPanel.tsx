import { useEffect, useMemo, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { Layers } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { GeoJsonObject } from "geojson";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";

// Reutiliza o modelo atual de bases; o adaptador acrescenta a preferência por usuário.
type BaseLayer = inferRouterOutputs<AppRouter>["baseLayers"]["list"][number] & {
  userVisible: boolean;
};
const TYPE_LABELS: Record<string, string> = {
  terras_indigenas: "Terras indígenas",
  terras_quilombolas: "Terras quilombolas",
  unidades_conservacao: "Unidades de conservação",
  rodovias: "Rodovias",
  infraestrutura_eletrica: "Infraestrutura elétrica",
  sitios_arqueologicos: "Sítios arqueológicos",
  other: "Outros",
};
const SOURCE_LABELS: Record<string, string> = {
  funai: "FUNAI",
  incra: "INCRA",
  icmbio: "ICMBio",
  osm: "OpenStreetMap",
  aneel: "ANEEL",
  iphan: "IPHAN",
  custom: "Outra fonte",
};
export function baseLayerDisplayIssue(
  layer: Pick<BaseLayer, "dataFormat" | "dataUrl" | "downloadStatus">
): string | null {
  if (layer.dataFormat !== "geojson")
    return `Formato ${layer.dataFormat}: visualização global indisponível`;
  if (layer.downloadStatus !== "completed" || !layer.dataUrl)
    return "Dados ainda indisponíveis para exibição";
  return null;
}

export default function BaseLayersPanel({
  viewMode,
}: {
  viewMode: "2d" | "3d";
}) {
  const utils = trpc.useUtils();
  const {
    data: catalog,
    isLoading,
    isError,
    refetch,
  } = trpc.baseLayers.catalog.useQuery(undefined, { retry: false });
  const setVisibility = trpc.baseLayers.setVisibility.useMutation({
    onSuccess: () => {
      void utils.baseLayers.catalog.invalidate();
    },
    onError: error => toast.error(`Visibilidade não salva: ${error.message}`),
  });
  const [source, setSource] = useState("all");
  const [filter, setFilter] = useState("");
  const sources = useMemo(
    () =>
      Array.from(new Set((catalog ?? []).map(layer => layer.source))).sort(),
    [catalog]
  );
  const rows = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase("pt-BR");
    return (catalog ?? []).filter(
      layer =>
        (source === "all" || layer.source === source) &&
        (!query ||
          `${layer.name} ${layer.description ?? ""}`
            .toLocaleLowerCase("pt-BR")
            .includes(query))
    );
  }, [catalog, source, filter]);
  const groups = useMemo(() => {
    const result = new Map<string, typeof rows>();
    for (const layer of rows)
      result.set(layer.layerType, [
        ...(result.get(layer.layerType) ?? []),
        layer,
      ]);
    return Array.from(result.entries());
  }, [rows]);

  return (
    <div className="space-y-3 p-2 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Layers className="h-4 w-4" />
        Camadas temáticas
        <span className="ml-auto text-xs text-muted-foreground">
          {catalog
            ? `${catalog.filter(layer => layer.userVisible).length}/${catalog.length}`
            : "—"}
        </span>
      </div>
      <div className="flex gap-2">
        <select
          value={source}
          onChange={event => setSource(event.target.value)}
          className="min-w-0 max-w-[45%] rounded-md border border-input bg-background px-1 text-xs"
          aria-label="Filtrar camadas por origem"
        >
          <option value="all">Todas as origens</option>
          {sources.map(value => (
            <option key={value} value={value}>
              {SOURCE_LABELS[value] ?? value}
            </option>
          ))}
        </select>
        <Input
          value={filter}
          onChange={event => setFilter(event.target.value)}
          placeholder="Buscar camada"
          aria-label="Buscar camada temática"
          className="h-9 min-w-0 text-xs"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {viewMode === "3d"
          ? "As bases GeoJSON serão exibidas em 2D; a textura do globo 3D permanece independente."
          : "Bases GeoJSON ligadas são exibidas no mapa 2D. A preferência de visibilidade é salva por usuário."}
      </p>
      <div aria-live="polite" className="space-y-3">
        {isLoading && !catalog && (
          <p className="text-xs text-muted-foreground">Carregando catálogo…</p>
        )}
        {isError && (
          <p role="alert" className="text-xs text-destructive">
            Catálogo indisponível ou falha ao atualizar; não é um filtro sem
            resultados.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => void refetch()}
            >
              Tentar novamente
            </button>
          </p>
        )}
        {!isLoading && !isError && catalog?.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Catálogo carregado sem camadas ativas.
          </p>
        )}
        {!isLoading && !isError && !!catalog?.length && rows.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nenhuma camada corresponde aos filtros.
          </p>
        )}
        {groups.map(([type, items]) => (
          <div key={type} className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground">
              {TYPE_LABELS[type] ?? type}
            </h3>
            {items.map(layer => {
              const issue = baseLayerDisplayIssue(layer);
              return (
                <div
                  key={layer.id}
                  className="flex items-start gap-2 rounded-lg border border-border p-2"
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={layer.userVisible}
                    disabled={
                      setVisibility.isPending ||
                      isError ||
                      (!!issue && !layer.userVisible)
                    }
                    onCheckedChange={checked =>
                      setVisibility.mutate({
                        id: layer.id,
                        visible: checked === true,
                      })
                    }
                    aria-label={`Mostrar camada ${layer.name}`}
                  />
                  <div className="min-w-0">
                    <p className="font-medium break-words">{layer.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {SOURCE_LABELS[layer.source] ?? layer.source}
                      {layer.featureCount != null
                        ? ` · ${layer.featureCount} feições`
                        : ""}
                    </p>
                    {issue && (
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        {issue}
                      </p>
                    )}
                    {layer.isCacheStale && (
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        Cache desatualizado; consulte a gestão de bases.
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="border-t border-border pt-2 text-xs text-muted-foreground space-y-2">
        <p>
          Camadas próprias e resultados estão na árvore de cada projeto, na
          seção Projetos. WMS, raster e análises continuam no workspace real.
        </p>
        <Link
          href="/base-layers"
          className="inline-block text-orange-700 underline dark:text-orange-300"
        >
          Gerenciar bases existentes
        </Link>
      </div>
    </div>
  );
}

// URLs vêm do catálogo existente, não de um novo provedor. O fetch é de um
// artefato GeoJSON, não uma chamada paralela à API tRPC. Falhas removem o overlay.
function BaseLayerOverlay({ layer }: { layer: BaseLayer }) {
  const map = useMap();
  useEffect(() => {
    if (!layer.userVisible || baseLayerDisplayIssue(layer)) return;
    const controller = new AbortController();
    let overlay: L.GeoJSON | undefined;
    void (async () => {
      try {
        const response = await fetch(layer.dataUrl!, {
          signal: controller.signal,
          credentials: "omit",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const maxBytes = 15 * 1024 * 1024;
        if (Number(response.headers.get("content-length")) > maxBytes)
          throw new Error(
            "GeoJSON excede o limite de 15 MB do mapa global; use o workspace"
          );
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Resposta sem dados");
        const chunks: Uint8Array[] = [];
        let length = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > maxBytes) {
            await reader.cancel();
            throw new Error("GeoJSON excede 15 MB; use o workspace");
          }
          chunks.push(value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const data = JSON.parse(
          new TextDecoder().decode(bytes)
        ) as GeoJsonObject;
        if (
          !data ||
          typeof data !== "object" ||
          ![
            "FeatureCollection",
            "Feature",
            "Point",
            "MultiPoint",
            "LineString",
            "MultiLineString",
            "Polygon",
            "MultiPolygon",
            "GeometryCollection",
          ].includes(data.type)
        )
          throw new Error("Artefato não é GeoJSON válido");
        if (controller.signal.aborted) return;
        const label = document.createElement("span");
        label.textContent = layer.name;
        overlay = L.geoJSON(data, {
          style: { color: "#0f766e", weight: 1, fillOpacity: 0.15 },
        });
        overlay.bindTooltip(label).addTo(map);
      } catch (error) {
        overlay?.remove();
        if (!controller.signal.aborted)
          toast.error(
            `Base “${layer.name}” não exibida: ${error instanceof Error ? error.message : "dados indisponíveis ou CORS"}`
          );
      }
    })();
    return () => {
      controller.abort();
      overlay?.remove();
    };
  }, [
    map,
    layer.id,
    layer.name,
    layer.userVisible,
    layer.dataUrl,
    layer.dataFormat,
    layer.downloadStatus,
  ]);
  return null;
}

export function BaseLayerMapOverlays() {
  const { data: catalog, isError } = trpc.baseLayers.catalog.useQuery(
    undefined,
    { retry: false }
  );
  // Não manter dados antigos na tela após uma falha de autorização/atualização.
  if (isError) return null;
  return (
    <>
      {catalog
        ?.filter(layer => layer.userVisible && !baseLayerDisplayIssue(layer))
        .map(layer => (
          <BaseLayerOverlay key={layer.id} layer={layer} />
        ))}
    </>
  );
}
