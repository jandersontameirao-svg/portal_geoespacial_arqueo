import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ImageOverlay, Popup, useMap } from "react-leaflet";
import type { ImageOverlay as LeafletImageOverlay } from "leaflet";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { registerIndeMapPrintState } from "@/lib/indeMapPrintGuard";
import {
  INDE_MAX_LAYERS,
  assertIndeMapImage,
  emptyIndeCatalogState,
  indeCatalogReducer,
  indeCrsIssue,
  indeErrorMessage,
  indeImageSize,
  indeLeafletAttribution,
  indeMercatorViewport,
  type IndeCatalogAction,
  type IndeGlobeImage,
  type IndeLayerState,
  type IndeLayerStatus,
  type IndeMapImage,
  type IndeMapImageInput,
  type IndeSelectedLayer,
  type IndeViewMode,
} from "@/lib/indeCatalogState";

export { default as IndeCatalogPanel } from "./IndeCatalogPanel";
export type {
  IndeSelectedLayer,
  IndeLayerStatus,
  IndeGlobeImage,
} from "@/lib/indeCatalogState";

type MapImageClient = {
  indeCatalog: {
    mapImage: {
      query: (
        input: IndeMapImageInput,
        options?: { signal?: AbortSignal }
      ) => Promise<IndeMapImage>;
    };
  };
};
export interface IndeStatusReporter {
  (id: string, status: IndeLayerStatus): void;
  (id: string, state: IndeLayerState, message: string): void;
}
export interface IndeCatalogContextValue {
  selected: IndeSelectedLayer[];
  statuses: Record<string, IndeLayerStatus>;
  viewMode: IndeViewMode;
  authenticated: boolean;
  identity: string | null;
  limit: number;
  notice: string | null;
  toggle: (layer: IndeSelectedLayer | string, checked: boolean) => void;
  clear: () => void;
  report: IndeStatusReporter;
  reportStatus: IndeStatusReporter;
  loadGlobeImage: (id: string, signal: AbortSignal) => Promise<IndeGlobeImage>;
}
const Context = createContext<IndeCatalogContextValue | null>(null);
export function useIndeCatalog(): IndeCatalogContextValue {
  const context = useContext(Context);
  if (!context) throw new Error("IndeCatalogProvider ausente");
  return context;
}

/** The keyed inner scope clears state synchronously, including when a different user signs in. */
export function IndeCatalogProvider({
  viewMode,
  children,
}: {
  viewMode: IndeViewMode;
  children: ReactNode;
}) {
  const { user, loading } = useAuth();
  const identity = !loading && user ? String(user.id) : null;
  return (
    <IndeIdentityScope
      key={identity ?? "anonymous"}
      identity={identity}
      viewMode={viewMode}
    >
      {children}
    </IndeIdentityScope>
  );
}
function IndeIdentityScope({
  identity,
  viewMode,
  children,
}: {
  identity: string | null;
  viewMode: IndeViewMode;
  children: ReactNode;
}) {
  const utils = trpc.useUtils();
  // Structural transport typing lets this isolated frontend compile while the router is being added.
  const clientRef = useRef(utils.client as unknown as MapImageClient);
  clientRef.current = utils.client as unknown as MapImageClient;
  const [state, setState] = useState(() => emptyIndeCatalogState(identity));
  const stateRef = useRef(state);
  const modeRef = useRef(viewMode);
  modeRef.current = viewMode;
  const modeEpoch = useMemo(() => Symbol(viewMode), [viewMode]);
  const modeEpochRef = useRef(modeEpoch);
  modeEpochRef.current = modeEpoch;
  const statusEpoch = useRef(new Map<string, symbol>());
  const mounted = useRef(true);
  const globeRequests = useRef(new Map<string, AbortController>());
  const dispatch = useCallback((action: IndeCatalogAction) => {
    if (!mounted.current) return;
    const next = indeCatalogReducer(stateRef.current, action);
    stateRef.current = next;
    setState(next);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      globeRequests.current.forEach(controller => controller.abort());
      globeRequests.current.clear();
    };
  }, []);
  useEffect(() => {
    if (viewMode === "3d") return;
    globeRequests.current.forEach(controller => controller.abort());
    globeRequests.current.clear();
  }, [viewMode]);
  const toggle = useCallback(
    (layer: IndeSelectedLayer | string, checked: boolean) => {
      if (!identity) return;
      const id = typeof layer === "string" ? layer : layer.id;
      if (!checked) {
        globeRequests.current.get(id)?.abort();
        globeRequests.current.delete(id);
        statusEpoch.current.delete(id);
      }
      dispatch({
        type: "toggle",
        identity,
        layer,
        checked,
        viewMode: modeRef.current,
      });
    },
    [identity, dispatch]
  );
  const clear = useCallback(() => {
    globeRequests.current.forEach(controller => controller.abort());
    globeRequests.current.clear();
    statusEpoch.current.clear();
    dispatch({ type: "clear", identity });
  }, [identity, dispatch]);
  const report: IndeStatusReporter = useCallback(
    (
      id: string,
      status: IndeLayerStatus | IndeLayerState,
      message?: string
    ) => {
      // Old renderer callbacks cannot report into another mode, identity, or removed selection.
      if (
        !identity ||
        modeRef.current !== viewMode ||
        modeEpochRef.current !== modeEpoch ||
        !mounted.current
      )
        return;
      const layer = stateRef.current.selected.find(item => item.id === id);
      if (!layer) return;
      const issue = indeCrsIssue(layer.crs, viewMode);
      const next =
        typeof status === "string"
          ? { state: status, message: message ?? "" }
          : status;
      statusEpoch.current.set(id, modeEpoch);
      dispatch({
        type: "report",
        identity,
        id,
        status: issue
          ? { state: "error", message: issue, viewMode }
          : { ...next, viewMode },
      });
    },
    [identity, viewMode, modeEpoch, dispatch]
  );
  const loadGlobeImage = useCallback(
    async (id: string, signal: AbortSignal): Promise<IndeGlobeImage> => {
      const layer = stateRef.current.selected.find(item => item.id === id);
      if (
        !mounted.current ||
        !identity ||
        !layer ||
        modeRef.current !== "3d" ||
        signal.aborted
      )
        throw new DOMException("Seleção 3D cancelada.", "AbortError");
      const issue = indeCrsIssue(layer.crs, "3d");
      if (issue) throw new Error(issue);
      globeRequests.current.get(id)?.abort();
      const controller = new AbortController();
      globeRequests.current.set(id, controller);
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(abort, 30000);
      const input: IndeMapImageInput = {
        organizationId: layer.organizationId,
        layerName: layer.layerName,
        bounds: [-180, -90, 180, 90],
        width: 512,
        height: 256,
        crs: "EPSG:4326",
      };
      report(
        id,
        "loading",
        "Solicitando PNG global EPSG:4326; aguardando textura 3D verificada…"
      );
      try {
        const image = await clientRef.current.indeCatalog.mapImage.query(
          input,
          { signal: controller.signal }
        );
        if (
          controller.signal.aborted ||
          signal.aborted ||
          !mounted.current ||
          modeRef.current !== "3d" ||
          globeRequests.current.get(id) !== controller ||
          !stateRef.current.selected.some(item => item.id === id)
        )
          throw new DOMException("Imagem 3D obsoleta.", "AbortError");
        assertIndeMapImage(image, input);
        // No ready here: only the actual globe texture loader can verify visual readiness.
        return { ...image, crs: "EPSG:4326", bounds: [-180, -90, 180, 90] };
      } catch (error) {
        if (
          !signal.aborted &&
          mounted.current &&
          modeRef.current === "3d" &&
          globeRequests.current.get(id) === controller
        )
          report(
            id,
            "error",
            `Imagem 3D não exibida: ${controller.signal.aborted ? "tempo limite ou solicitação cancelada" : indeErrorMessage(error)}`
          );
        throw error;
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        if (globeRequests.current.get(id) === controller)
          globeRequests.current.delete(id);
      }
    },
    [identity, report]
  );
  const statuses = useMemo(
    () =>
      Object.fromEntries(
        state.selected.map(layer => {
          const issue = indeCrsIssue(layer.crs, viewMode);
          const stored = state.statuses[layer.id];
          return [
            layer.id,
            issue
              ? { state: "error" as const, message: issue, viewMode }
              : stored?.viewMode === viewMode &&
                  statusEpoch.current.get(layer.id) === modeEpoch
                ? stored
                : {
                    state: "loading" as const,
                    message: `Aguardando imagem WMS ${viewMode.toUpperCase()} atualizada…`,
                    viewMode,
                  },
          ];
        })
      ),
    [state.selected, state.statuses, viewMode, modeEpoch]
  );
  const value = useMemo<IndeCatalogContextValue>(
    () => ({
      selected: state.selected,
      statuses,
      viewMode,
      authenticated: !!identity,
      identity,
      limit: INDE_MAX_LAYERS,
      notice: state.notice,
      toggle,
      clear,
      report,
      reportStatus: report,
      loadGlobeImage,
    }),
    [
      state.selected,
      state.notice,
      statuses,
      viewMode,
      identity,
      toggle,
      clear,
      report,
      loadGlobeImage,
    ]
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

type OverlayResult = {
  image: IndeMapImage;
  geographicBounds: [number, number, number, number];
  token: number;
};
function IndeWmsImage({ layer }: { layer: IndeSelectedLayer }) {
  const map = useMap();
  const utils = trpc.useUtils();
  const clientRef = useRef(utils.client as unknown as MapImageClient);
  clientRef.current = utils.client as unknown as MapImageClient;
  const { report } = useIndeCatalog();
  const [result, setResult] = useState<OverlayResult | null>(null);
  const [ready, setReady] = useState(false);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlay = useRef<LeafletImageOverlay | null>(null);
  const hidden = useRef(true);
  useLayoutEffect(
    () => registerIndeMapPrintState(map, layer.id, ready),
    [map, layer.id, ready]
  );
  const removeCurrent = useCallback(() => {
    hidden.current = true;
    overlay.current?.setOpacity(0);
    setResult(null);
    setReady(false);
    if (loadTimer.current) clearTimeout(loadTimer.current);
  }, []);
  useEffect(() => {
    let active = true;
    const invalidate = () => {
      sequence.current += 1;
      controller.current?.abort();
      controller.current = null;
      removeCurrent();
      report(
        layer.id,
        "loading",
        "Recorte alterado; a imagem anterior foi removida. Aguardando imagem atualizada…"
      );
    };
    const request = async () => {
      if (!active) return;
      const token = ++sequence.current;
      controller.current?.abort();
      const abortController = new AbortController();
      controller.current = abortController;
      removeCurrent();
      report(
        layer.id,
        "loading",
        "Carregando PNG WMS EPSG:3857 do recorte visível…"
      );
      const timeout = setTimeout(() => {
        if (!active || token !== sequence.current) return;
        sequence.current += 1;
        abortController.abort();
        removeCurrent();
        report(
          layer.id,
          "error",
          "Tempo limite ao carregar a imagem WMS do recorte. Mova o mapa ou desligue e ligue a camada para tentar novamente."
        );
      }, 30000);
      try {
        const bounds = map.getBounds();
        const viewport = indeMercatorViewport([
          bounds.getWest(),
          bounds.getSouth(),
          bounds.getEast(),
          bounds.getNorth(),
        ]);
        const size = map.getSize();
        const dimensions = indeImageSize(size.x, size.y);
        const input: IndeMapImageInput = {
          organizationId: layer.organizationId,
          layerName: layer.layerName,
          bounds: viewport.bounds,
          ...dimensions,
          crs: "EPSG:3857",
        };
        const image = await clientRef.current.indeCatalog.mapImage.query(
          input,
          { signal: abortController.signal }
        );
        if (
          !active ||
          abortController.signal.aborted ||
          token !== sequence.current
        )
          return;
        assertIndeMapImage(image, input);
        setResult({
          image,
          geographicBounds: viewport.geographicBounds,
          token,
        });
        // Receiving a data URL is not readiness: ImageOverlay must emit load.
        loadTimer.current = setTimeout(() => {
          if (!active || token !== sequence.current) return;
          removeCurrent();
          report(
            layer.id,
            "error",
            "O PNG WMS não concluiu o carregamento visual; nenhuma imagem antiga foi mantida."
          );
        }, 15000);
      } catch (error) {
        if (
          active &&
          !abortController.signal.aborted &&
          token === sequence.current
        ) {
          removeCurrent();
          report(
            layer.id,
            "error",
            `Imagem WMS não exibida: ${indeErrorMessage(error)}`
          );
        }
      } finally {
        clearTimeout(timeout);
        if (controller.current === abortController) controller.current = null;
      }
    };
    const onStart = () => {
      if (timer.current) clearTimeout(timer.current);
      invalidate();
    };
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      invalidate();
      timer.current = setTimeout(() => {
        void request();
      }, 300);
    };
    map.on("movestart zoomstart", onStart);
    map.on("moveend zoomend resize", schedule);
    void request();
    return () => {
      active = false;
      sequence.current += 1;
      controller.current?.abort();
      if (timer.current) clearTimeout(timer.current);
      if (loadTimer.current) clearTimeout(loadTimer.current);
      overlay.current?.setOpacity(0);
      map.off("movestart zoomstart", onStart);
      map.off("moveend zoomend resize", schedule);
    };
  }, [
    map,
    layer.id,
    layer.organizationId,
    layer.layerName,
    report,
    removeCurrent,
  ]);
  const events = useMemo(
    () => ({
      load: () => {
        if (!result || result.token !== sequence.current) return;
        if (loadTimer.current) clearTimeout(loadTimer.current);
        hidden.current = false;
        setReady(true);
        report(layer.id, {
          state: "ready",
          attribution: result.image.attribution,
          message:
            "Imagem WMS 2D carregada para o recorte atual; não representa contagem de feições.",
        });
      },
      error: () => {
        if (!result || result.token !== sequence.current) return;
        removeCurrent();
        report(
          layer.id,
          "error",
          "Falha no carregamento visual do PNG WMS; imagem removida."
        );
      },
    }),
    [result, layer.id, report, removeCurrent]
  );
  if (!result || result.token !== sequence.current) return null;
  const [west, south, east, north] = result.geographicBounds;
  return (
    <ImageOverlay
      key={`${layer.id}:${result.token}`}
      ref={overlay}
      url={result.image.dataUrl}
      bounds={[
        [south, west],
        [north, east],
      ]}
      opacity={ready && !hidden.current ? (layer.opacity ?? 0.85) : 0}
      interactive
      zIndex={250}
      attribution={indeLeafletAttribution(
        result.image.attribution || layer.attribution
      )}
      eventHandlers={events}
    >
      <Popup>
        <div className="space-y-2 text-sm">
          <strong>{layer.title}</strong>
          <p>{result.image.attribution || layer.attribution}</p>
          <p>Imagem WMS · EPSG:3857 · sem contagem de feições.</p>
          <p>
            Use a seleção de camadas institucionais para desligar esta imagem.
          </p>
        </div>
      </Popup>
    </ImageOverlay>
  );
}

/** Mount inside Leaflet's MapContainer. No fitBounds, external image URL or invasive navigation. */
export function IndeMapLayers() {
  const { selected, viewMode, identity } = useIndeCatalog();
  if (viewMode !== "2d" || !identity) return null;
  return (
    <>
      {selected
        .filter(layer => !indeCrsIssue(layer.crs, "2d"))
        .map(layer => (
          <IndeWmsImage key={`${identity}:${layer.id}`} layer={layer} />
        ))}
    </>
  );
}
