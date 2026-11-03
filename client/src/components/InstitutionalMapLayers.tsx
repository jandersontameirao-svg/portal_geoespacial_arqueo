import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { GeoJSON, useMap, WMSTileLayer } from "react-leaflet";
import L from "leaflet";
import type { FeatureCollection } from "geojson";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  completeViewportCollection,
  ibgeAttribution,
  isIbgePublishedLayer,
  viewportIssue,
  type InstitutionalLayerStatus,
  type InstitutionalPublishedLayer,
  type InstitutionalVariant,
} from "@/lib/institutionalLayers";

type QueryRequest = { variantId: number; token: number };
type InstitutionalState = {
  layers: InstitutionalPublishedLayer[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  viewMode: "2d" | "3d";
  enabled: number[];
  toggle: (id: number, checked: boolean) => void;
  statuses: Record<number, InstitutionalLayerStatus>;
  report: (id: number, status: InstitutionalLayerStatus) => void;
  request: QueryRequest | null;
  queryViewport: (id: number) => void;
};
const Context = createContext<InstitutionalState | null>(null);
export function useInstitutionalLayers() {
  const state = useContext(Context);
  if (!state) throw new Error("InstitutionalLayersProvider ausente");
  return state;
}
export function InstitutionalLayersProvider({
  viewMode,
  children,
}: {
  viewMode: "2d" | "3d";
  children: ReactNode;
}) {
  const { user } = useAuth();
  const catalog = trpc.ogcCatalog.listPublished.useQuery(undefined, {
    enabled: !!user,
    retry: false,
  });
  const [enabled, setEnabled] = useState<number[]>([]);
  const [statuses, setStatuses] = useState<
    Record<number, InstitutionalLayerStatus>
  >({});
  const [request, setRequest] = useState<QueryRequest | null>(null);
  const sequence = useRef(0);
  const layers = useMemo(
    () =>
      catalog.isError
        ? []
        : ((catalog.data ?? []) as InstitutionalPublishedLayer[]).filter(
            isIbgePublishedLayer
          ),
    [catalog.data, catalog.isError]
  );
  const report = useCallback(
    (id: number, status: InstitutionalLayerStatus) =>
      setStatuses(current => ({ ...current, [id]: status })),
    []
  );
  const toggle = useCallback((id: number, checked: boolean) => {
    setEnabled(current =>
      checked
        ? Array.from(new Set([...current, id]))
        : current.filter(item => item !== id)
    );
    if (!checked) {
      setRequest(current => (current?.variantId === id ? null : current));
      setStatuses(current => ({
        ...current,
        [id]: { state: "idle", message: "Desligada; dados removidos do mapa." },
      }));
    }
  }, []);
  useEffect(() => {
    setEnabled([]);
    setRequest(null);
    setStatuses({});
  }, [user?.id, catalog.isError]);
  useEffect(() => {
    if (viewMode === "3d") {
      setRequest(null);
      setStatuses({});
    }
  }, [viewMode]);
  return (
    <Context.Provider
      value={{
        layers,
        isLoading: catalog.isLoading,
        isError: catalog.isError,
        refetch: () => {
          void catalog.refetch();
        },
        viewMode,
        enabled,
        toggle,
        statuses,
        report,
        request,
        queryViewport: id =>
          setRequest({ variantId: id, token: ++sequence.current }),
      }}
    >
      {children}
    </Context.Provider>
  );
}
function InstitutionalWms({ variant }: { variant: InstitutionalVariant }) {
  const { report } = useInstitutionalLayers();
  const errors = useRef(0);
  const events = useMemo(
    () => ({
      loading: () => {
        errors.current = 0;
        report(variant.id, {
          state: "loading",
          message: "Carregando imagens WMS do recorte…",
        });
      },
      tileerror: () => {
        errors.current += 1;
        report(variant.id, {
          state: "error",
          message:
            "Falha ao carregar imagens WMS; verifique o serviço ou tente desligar e ligar.",
        });
      },
      load: () => {
        if (!errors.current)
          report(variant.id, {
            state: "ready",
            message:
              "Imagens WMS carregadas para o recorte; não representam contagem de feições.",
          });
      },
    }),
    [variant.id, report]
  );
  return (
    <WMSTileLayer
      url={variant.endpoint}
      layers={variant.remoteLayer}
      version="1.1.1"
      format="image/png"
      transparent
      crs={L.CRS.EPSG3857}
      attribution={ibgeAttribution(variant)}
      eventHandlers={events}
    />
  );
}
export default function InstitutionalMapLayers() {
  const map = useMap();
  const utils = trpc.useUtils();
  const { layers, enabled, request, report } = useInstitutionalLayers();
  const [result, setResult] = useState<{
    variantId: number;
    token: number;
    collection: FeatureCollection;
    attribution: string;
  } | null>(null);
  const enabledRef = useRef(enabled);
  const requestRef = useRef(request);
  const layersRef = useRef(layers);
  const clientRef = useRef(utils.client);
  enabledRef.current = enabled;
  requestRef.current = request;
  layersRef.current = layers;
  clientRef.current = utils.client;
  // O token da requisição e o cleanup impedem que respostas antigas recoloquem dados.
  // Só uma nova solicitação explícita dispara WFS; refetch do catálogo não consulta.
  useEffect(() => {
    setResult(null);
    if (!request || !enabledRef.current.includes(request.variantId)) return;
    const variant = layersRef.current.find(
      layer => layer.selected?.id === request.variantId
    )?.selected;
    if (!variant || variant.serviceType !== "wfs") return;
    const bounds = map.getBounds();
    const bbox = {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    };
    const issue = viewportIssue(bbox);
    if (issue) {
      report(variant.id, { state: "error", message: issue });
      return;
    }
    let stale = false;
    report(variant.id, {
      state: "loading",
      message: "Consultando somente o recorte visível (limite 50)…",
    });
    void clientRef.current.ogcCatalog.queryIbgeViewport
      .query({ variantId: variant.id, bbox, limit: 50 })
      .then(response => {
        if (
          stale ||
          requestRef.current?.token !== request.token ||
          !enabledRef.current.includes(variant.id) ||
          !layersRef.current.some(layer => layer.selected?.id === variant.id)
        )
          return;
        const collection = completeViewportCollection(response);
        if (!collection) {
          report(variant.id, {
            state: "error",
            message:
              "Resposta incompleta: nenhuma geometria parcial foi exibida. Reduza o recorte e consulte novamente.",
          });
          return;
        }
        setResult({
          variantId: variant.id,
          token: request.token,
          collection,
          attribution: response.attribution,
        });
        report(variant.id, {
          state: "ready",
          message: `${response.featureCount} feição(ões) no recorte consultado; não é um total nacional.`,
          featureCount: response.featureCount,
          matched: response.matched,
          queriedAt: response.queriedAt,
          attribution: response.attribution,
        });
      })
      .catch((error: unknown) => {
        if (
          !stale &&
          requestRef.current?.token === request.token &&
          enabledRef.current.includes(variant.id)
        )
          report(variant.id, {
            state: "error",
            message: `Consulta não exibida: ${error instanceof Error ? error.message : "serviço indisponível"}`,
          });
      });
    return () => {
      stale = true;
    };
  }, [request, map, report]);
  useEffect(() => {
    if (
      result &&
      (!enabled.includes(result.variantId) ||
        !layers.some(layer => layer.selected?.id === result.variantId))
    )
      setResult(null);
  }, [enabled, layers, result]);
  const variants = layers.flatMap(layer =>
    layer.selected && enabled.includes(layer.selected.id)
      ? [layer.selected]
      : []
  );
  return (
    <>
      {variants
        .filter(variant => variant.serviceType === "wms")
        .map(variant => (
          <InstitutionalWms key={variant.id} variant={variant} />
        ))}
      {result &&
        enabled.includes(result.variantId) &&
        variants.some(variant => variant.id === result.variantId) && (
          <GeoJSON
            key={`${result.variantId}-${result.token}`}
            data={result.collection}
            attribution={ibgeAttribution({ attribution: result.attribution })}
            style={{ color: "#0f766e", weight: 2, fillOpacity: 0.1 }}
            onEachFeature={(feature, layer) => {
              const popup = document.createElement("div");
              const title = document.createElement("strong");
              title.textContent = "Município — referência 2010";
              popup.append(title);
              for (const [key, value] of Object.entries(
                feature.properties ?? {}
              )) {
                const row = document.createElement("p");
                row.textContent = `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value ?? "")}`;
                popup.append(row);
              }
              const source = document.createElement("p");
              source.textContent = `Fonte: IBGE — ${result.attribution}`;
              popup.append(source);
              layer.bindPopup(popup);
            }}
          />
        )}
    </>
  );
}
