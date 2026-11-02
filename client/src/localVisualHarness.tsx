import { useCallback, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import { FeatureGroup, MapContainer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import "./index.css";
import "./lib/leafletDefaultMarker";
import LeafletDrawControl from "./components/LeafletDrawControl";
import MeasurementTools from "./components/MeasurementTools";
import ThematicLayerTree, { moveThematicItem, type ThematicLayerItem } from "./components/ThematicLayerTree";

/**
 * Harness exclusivamente local para verificação visual de componentes GIS.
 * Não importa main.tsx, App, useAuth ou tRPC e não cria sessão, usuário ou cookie.
 */
function blockedIo(name: string) {
  return () => {
    throw new Error(`[offline-visual-harness] ${name} bloqueado: rede externa não é permitida.`);
  };
}

function blockNetworkApis() {
  Object.defineProperty(window, "fetch", { configurable: true, value: blockedIo("fetch") });
  Object.defineProperty(window, "XMLHttpRequest", { configurable: true, value: class BlockedXMLHttpRequest { constructor() { throw new Error("[offline-visual-harness] XMLHttpRequest bloqueado"); } } });
  Object.defineProperty(window, "WebSocket", { configurable: true, value: class BlockedWebSocket { constructor() { throw new Error("[offline-visual-harness] WebSocket bloqueado"); } } });
  Object.defineProperty(window, "open", { configurable: true, value: blockedIo("window.open") });
}

blockNetworkApis();

const initialItems: ThematicLayerItem[] = [
  {
    id: "aoi-local",
    group: "own",
    kind: "drawing",
    name: "Área de interesse sintética",
    description: "Polígono de demonstração somente em memória.",
    visible: true,
    analyzable: true,
    selectedForAnalysis: true,
    color: "#f97316",
    status: "local",
    sourceLabel: "Fixture offline",
  },
  {
    id: "cog-local",
    group: "own",
    kind: "raster",
    name: "COG sintético restaurado",
    description: "Representação de camada raster local; nenhum tile remoto é carregado.",
    visible: true,
    analyzable: true,
    color: "#22c55e",
    status: "local",
    sourceLabel: "Fixture local",
  },
  {
    id: "wms-visual",
    group: "base",
    kind: "wms",
    name: "WMS de referência",
    description: "Exemplo visual; a conexão não é aberta neste harness.",
    visible: false,
    color: "#3b82f6",
    status: "unavailable",
    sourceLabel: "Bloqueado por design",
  },
  {
    id: "wfs-import",
    group: "base",
    kind: "wfs",
    name: "WFS autorizado",
    description: "Exemplo de base que exigiria importação autorizada em ambiente real.",
    visible: true,
    color: "#8b5cf6",
    status: "healthy",
    sourceLabel: "Fixture offline",
  },
  {
    id: "buffer-local",
    group: "result",
    kind: "analysis",
    name: "Buffer de 500 m",
    description: "Resultado sintético independente da seleção de camadas.",
    visible: true,
    analyzable: false,
    color: "#ef4444",
    status: "local",
    sourceLabel: "Fixture offline",
  },
];

function OfflineLeafletCanvas() {
  const [featureGroup, setFeatureGroup] = useState<L.FeatureGroup | null>(null);
  const [featureCount, setFeatureCount] = useState(0);
  const sequence = useRef(0);
  const draw = useMemo<L.Control.DrawOptions>(() => ({ marker: {}, polyline: {}, polygon: {}, rectangle: {}, circle: false, circlemarker: false }), []);

  const clear = useCallback(() => {
    featureGroup?.clearLayers();
    setFeatureCount(0);
  }, [featureGroup]);

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm" data-testid="offline-leaflet-canvas">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Leaflet Draw e medição — canvas offline</h2>
          <p className="mt-1 text-sm text-muted-foreground">Sem TileLayer, WMS, WFS, OAuth, tRPC, banco ou storage. Os desenhos permanecem somente na memória da página.</p>
        </div>
        <button type="button" className="rounded-md border px-3 py-2 text-sm disabled:opacity-50" disabled={!featureCount} onClick={clear}>Limpar {featureCount} geometria(s)</button>
      </div>
      <div className="relative overflow-hidden rounded-lg border bg-[linear-gradient(45deg,#f8fafc_25%,transparent_25%,transparent_75%,#f8fafc_75%),linear-gradient(45deg,#f8fafc_25%,#ffffff_25%,#ffffff_75%,#f8fafc_75%)] bg-[length:28px_28px] bg-[position:0_0,14px_14px]">
        <MapContainer center={[-15.7801, -47.9292]} zoom={5} scrollWheelZoom={false} style={{ height: "440px", width: "100%" }}>
          <FeatureGroup ref={setFeatureGroup}>
            {featureGroup && (
              <LeafletDrawControl
                featureGroup={featureGroup}
                draw={draw}
                onCreated={(event) => {
                  (event.layer as any).options.harnessId = `offline-${++sequence.current}`;
                  setFeatureCount((value) => value + 1);
                }}
                onDeleted={(event) => setFeatureCount((value) => Math.max(0, value - event.layers.getLayers().length))}
              />
            )}
          </FeatureGroup>
          <MeasurementTools />
        </MapContainer>
        <div className="pointer-events-none absolute bottom-3 right-3 rounded bg-white/90 px-3 py-2 text-xs text-slate-700 shadow">Grade local sem tiles externos · EPSG:3857 apenas para UI</div>
      </div>
    </section>
  );
}

function HarnessApp() {
  const [items, setItems] = useState(initialItems);
  const [order, setOrder] = useState(initialItems.map((item) => item.id));
  const [eventLog, setEventLog] = useState<string[]>(["Harness inicializado com fixtures sintéticas."]);
  const log = useCallback((message: string) => setEventLog((current) => [message, ...current].slice(0, 6)), []);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto max-w-7xl px-5 py-5">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Geoportal Grupo Arqueo · Harness estritamente local</p>
          <h1 className="mt-1 text-2xl font-semibold">Validação visual offline de componentes reais</h1>
          <p className="mt-2 max-w-4xl text-sm text-muted-foreground">Este endereço não é o Portal, não implementa login e não cria sessão. OAuth, tRPC, banco, storage, WMS, WFS, tiles e qualquer rede externa são bloqueados por design.</p>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <OfflineLeafletCanvas />
          <section className="rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="text-base font-semibold">Árvore temática com fixtures sintéticas</h2>
            <p className="mt-1 text-sm text-muted-foreground">Teste visibilidade, análise e ordem visual. Nenhuma alteração é persistida ou enviada.</p>
            <div className="mt-4">
              <ThematicLayerTree
                items={items}
                order={order}
                onVisibilityChange={(item, visible) => {
                  setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, visible } : candidate));
                  log(`${visible ? "Exibida" : "Ocultada"}: ${item.name}`);
                }}
                onAnalysisSelectionChange={(item, selected) => {
                  setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, selectedForAnalysis: selected } : candidate));
                  log(`${selected ? "Selecionada" : "Removida"} da análise: ${item.name}`);
                }}
                onMove={(item, direction) => {
                  setOrder((current) => moveThematicItem(current, item.id, direction));
                  log(`${direction === "up" ? "Subida" : "Descida"} na ordem: ${item.name}`);
                }}
              />
            </div>
          </section>
        </div>
        <aside className="h-fit rounded-xl border bg-card p-4 shadow-sm">
          <h2 className="text-base font-semibold">Registro local de interação</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground" aria-live="polite">
            {eventLog.map((event, index) => <li className="rounded border bg-muted/30 p-2" key={`${event}-${index}`}>{event}</li>)}
          </ul>
          <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
            Limite: este harness valida composição, controles e interações em memória. Não comprova login, permissões, persistência, mapas-base, raster, storage ou integração operacional.
          </div>
        </aside>
      </div>
    </main>
  );
}

async function bootstrapOfflineHarness() {
  // O plugin leaflet-measure é UMD e consulta window.L no instante de avaliação.
  // A ordem abaixo é intencionalmente sequencial e exclusiva deste entrypoint local.
  const leafWindow = window as Window & { L?: typeof L };
  leafWindow.L = L;
  await import("leaflet-measure");
  document.documentElement.dataset.harnessLeafletIdentity = String(leafWindow.L === L);
  document.documentElement.dataset.harnessMeasureRegistered = String(typeof (L as typeof L & { Control: typeof L.Control & { Measure?: unknown } }).Control.Measure === "function");
  createRoot(document.getElementById("root")!).render(<HarnessApp />);
}

void bootstrapOfflineHarness().catch((error: unknown) => {
  document.body.textContent = `Falha na inicialização local do harness: ${error instanceof Error ? error.message : String(error)}`;
  throw error;
});
