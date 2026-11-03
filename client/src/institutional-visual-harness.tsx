import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { MapContainer, useMap } from "react-leaflet";
import { Toaster } from "sonner";
import type { AppRouter } from "../../server/routers";
import { trpc } from "./lib/trpc";
import GlobalMapPanels from "./components/GlobalMapPanels";
import IbgeSourceCard from "./components/IbgeSourceCard";
import InstitutionalSourcesCard from "./components/InstitutionalSourcesCard";
import InstitutionalMapLayers, { InstitutionalLayersProvider, useInstitutionalLayers } from "./components/InstitutionalMapLayers";
import { DEFAULT_BASEMAP } from "./lib/basemaps";
import "leaflet/dist/leaflet.css";
import "./index.css";
/** No App, HTTP tRPC, backend/DB, OAuth/session/cookie, remote maps or original geodata. */
type Call = { index: number; path: string; type: string; input: unknown; response?: unknown; error?: string };
type Variant = { id: number; serviceId: number; publisher: string; serviceType: "wms" | "wfs"; endpoint: string; remoteLayer: string; attribution: string; health: string; displayCrs: string; role: string; priority: number; enabled: boolean; serviceEnabled: boolean; edition?: string; title?: string };
type Published = { logicalLayer: string; selected: Variant | null; primary: Variant; isFallback: boolean; reason: string | null };
const calls: Call[] = [];
const suppressedStorageWrites: Array<{ key: string; value: string }> = [];
Storage.prototype.setItem = function (key: string, value: string) { suppressedStorageWrites.push({ key, value }); };
const caseId = new URLSearchParams(location.search).get("case") ?? "map-desktop";
const reader = caseId.includes("reader");
const card = caseId.startsWith("card");
const memory = memoryLocation({ path: "/synthetic", record: true });
const now = new Date("2026-01-01T12:00:00Z");
const hostile = '<img src="/never-synthetic-xss" onerror="window.__INSTITUTIONAL_XSS__=1"> & <script>window.__INSTITUTIONAL_XSS__=2</script>';
const cacheFixtures = [
  { id: 7001, name: "FUNAI — cache sintético", source: "funai", layerType: "terras_indigenas" },
  { id: 7002, name: "INCRA — cache sintético", source: "incra", layerType: "terras_quilombolas" },
  { id: 7003, name: "IPHAN — cache sintético", source: "iphan", layerType: "sitios_arqueologicos" },
  { id: 7004, name: "OpenStreetMap — cache sintético", source: "osm", layerType: "rodovias" },
].map(row => ({ ...row, description: "MOCK: metadados somente; nenhuma geometria legada", dataFormat: "geojson", dataUrl: "https://fixture.invalid/never-request.geojson", downloadStatus: "completed", featureCount: 0, userVisible: false, isActive: true, isCacheStale: false, createdAt: now, updatedAt: now }));
// Final research disposition supplied by main at 21:24:03; only UI fixtures, not evidence of a real registration.
const sourceFixtures = [
  { publisher: "IPHAN", title: "Bens materiais protegidos — IPHAN", sourceCrs: "EPSG:4674", status: "validated" as const, blocker: null, types: ["wms", "wfs"], presetId: "MOCK-iphan-bens-protegidos", remoteLayer: "SICG:Bem_Protecao" },
  { publisher: "FUNAI", title: "Terras indígenas — FUNAI", sourceCrs: "EPSG:4326", status: "blocked" as const, blocker: "TLS estrito: UNABLE_TO_VERIFY_LEAF_SIGNATURE; nenhuma conexão habilitada", types: [] as string[], presetId: "MOCK-funai-blocked", remoteLayer: "MOCK:funai_blocked" },
  { publisher: "INCRA", title: "Territórios quilombolas — INCRA", sourceCrs: "EPSG:4674", status: "blocked" as const, blocker: "DNS legado ENOTFOUND; espelho HTTP 403 WAF. Serviço remoto não validado", types: [] as string[], presetId: "MOCK-incra-blocked", remoteLayer: "MOCK:incra_blocked" },
];
let sources = sourceFixtures.map(source => {
  return { publisher: source.publisher, label: source.publisher, title: source.title, edition: "não comprovada — fixture sintética", sourceCrs: source.sourceCrs, status: source.status, blocker: source.blocker, presetId: source.presetId, supportsWms: source.types.includes("wms"), supportsWfs: source.types.includes("wfs"), registeredTypes: card ? [] as string[] : [...source.types], wmsVersion: "1.1.1" as const };
});
function row(publisher: string, serviceType: "wms" | "wfs", id: number, available: boolean, remoteLayer: string): Published {
  const variant: Variant = { id, serviceId: id + 1000, publisher, serviceType, endpoint: `${location.origin}/synthetic-never-request/${publisher.toLowerCase()}/${serviceType}`, remoteLayer, attribution: `MOCK sintético ${publisher} ${hostile}`, health: available ? "healthy" : "blocked", displayCrs: "EPSG:3857", role: "primary", priority: 1, enabled: available, serviceEnabled: available, edition: publisher === "IBGE" ? "2010" : "MOCK sem edição própria" };
  return { logicalLayer: `${publisher} MOCK ${serviceType}`, selected: available ? variant : null, primary: variant, isFallback: false, reason: available ? null : "MOCK preserva bloqueio real; não é conexão cadastrada" };
}
const ibgeRows = (["wms", "wfs"] as const).map((type, i) => row("IBGE", type, 9101 + i, true, "CGEO:C02_recortes_territoriais_municipio_2010"));
const institutionalRows = sourceFixtures.flatMap((source, index) => (["wms", "wfs"] as const).map((type, typeIndex) => row(source.publisher, type, 9301 + index * 10 + typeIndex, source.types.includes(type), source.remoteLayer)));
let published = [...ibgeRows, ...(card ? [] : institutionalRows), row("EXTERNAL_NOT_ALLOWED", "wfs", 9999, true, "MOCK:external_not_allowed")];
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, staleTime: Infinity }, mutations: { retry: false } } });
const memoryLink: TRPCLink<AppRouter> = () => ({ op }) => observable(observer => {
  const call: Call = { index: calls.length + 1, path: op.path, type: op.type, input: op.input === undefined ? null : structuredClone(op.input) };
  calls.push(call);
  const timer = window.setTimeout(() => {
    try {
      let data: unknown;
      switch (op.path) {
        case "auth.me": data = { id: 9000, name: "PAPEL SINTÉTICO SEM SESSÃO", role: reader ? "viewer" : "admin", email: null }; break;
        case "baseLayers.catalog": data = cacheFixtures; break;
        case "projects.list": data = [{ id: 4242, name: "Projeto sintético", code: "MOCK", ownerId: 9000, status: "active", createdAt: now, updatedAt: now }]; break;
        case "layers.list": case "geometries.list": data = []; break;
        case "ogcCatalog.listPublished": data = published; break;
        case "ogcCatalog.listServices": data = published.flatMap(row => row.selected ? [{ ...row.selected, id: row.selected.serviceId }] : []); break;
        case "institutionalCatalog.listSources":
          if (caseId === "catalog-error-mobile") throw new Error("MOCK_LIST_SOURCES_FAILURE_EXPLICIT");
          data = sources; break;
        case "institutionalCatalog.registerSource": {
          const publisher = (op.input as { publisher?: string })?.publisher;
          const source = sources.find(item => item.publisher === publisher);
          if (reader || op.type !== "mutation" || !source || source.status !== "validated") throw new Error("MOCK_REGISTER_FORBIDDEN");
          source.registeredTypes = [source.supportsWms && "wms", source.supportsWfs && "wfs"].filter(Boolean) as string[];
          published = [...published.filter(item => item.primary.publisher !== publisher), ...institutionalRows.filter(item => item.primary.publisher === publisher)];
          data = { success: true, idempotent: false, publisher, records: published.filter(item => item.primary.publisher === publisher && item.selected).map(item => ({ serviceId: item.primary.serviceId, variantId: item.primary.id, serviceType: item.primary.serviceType })), persisted: false, transport: "MOCK MemoryTRPCLink — sem DB" }; break;
        }
        case "ogcCatalog.queryIbgeViewport": case "institutionalCatalog.queryViewport": {
          const input = op.input as { variantId: number; limit: number; bbox: { west: number; south: number; east: number; north: number } };
          const variant = published.find(item => item.selected?.id === input.variantId)?.selected;
          if (op.type !== "query" || !variant || variant.serviceType !== "wfs" || variant.publisher === "FUNAI" || variant.publisher === "EXTERNAL_NOT_ALLOWED" || (variant.publisher === "IBGE") !== (op.path === "ogcCatalog.queryIbgeViewport")) throw new Error("MOCK_QUERY_FORBIDDEN");
          if (input.limit !== 50 || input.bbox.east - input.bbox.west > 2 || input.bbox.north - input.bbox.south > 2) throw new Error("MOCK_VIEWPORT_LIMIT_INVALID");
          data = { complete: true, featureCount: 1, matched: 1, queriedAt: now.toISOString(), attribution: `MOCK ${variant.publisher} ${hostile}`, collection: { type: "FeatureCollection", features: [{ type: "Feature", properties: { synthetic: true, name: hostile, source: variant.publisher }, geometry: { type: "Polygon", coordinates: [[[-0.02,-0.02],[0.02,-0.02],[0.02,0.02],[-0.02,0.02],[-0.02,-0.02]]] } }] } }; break;
        }
        default: throw new Error(`MOCK_UNKNOWN_PATH: ${op.type} ${op.path}; nenhum fallback`);
      }
      call.response = structuredClone(data); observer.next({ result: { data } }); observer.complete();
    } catch (error) { call.error = error instanceof Error ? error.message : String(error); observer.error(TRPCClientError.from(new Error(call.error))); }
  }, 35);
  return () => window.clearTimeout(timer);
});
const client = trpc.createClient({ links: [memoryLink] });
let panelState: unknown = null;
let mapProbe: { bounds: unknown; pan: () => void; popup: () => boolean } | null = null;
function MapProbe() {
  const map = useMap();
  mapProbe = { get bounds() { return map.getBounds().toBBoxString(); }, pan: () => { map.panBy([10, 10], { animate: false }); }, popup: () => { let opened = false; map.eachLayer(layer => { if (layer.getPopup?.()) { layer.openPopup(); opened = true; } }); return opened; } };
  return null;
}
Object.defineProperty(window, "__INSTITUTIONAL_HARNESS__", { get: () => ({ caseId, calls: structuredClone(calls), panelState: structuredClone(panelState), published: structuredClone(published), sources: structuredClone(sources), cacheFixtures: structuredClone(cacheFixtures), suppressedStorageWrites: structuredClone(suppressedStorageWrites), navigationHistory: [...memory.history], mapBounds: mapProbe?.bounds, synthetic: true, transport: "MOCK MemoryTRPCLink — sem HTTP/DB", authentication: "Papel auth.me estritamente em memória; sem sessão, cookie, login ou OAuth; não testa autorização real", limits: "Fixture geográfica artificial perto de 0,0; não é dado de órgão. Nenhum WMS real, mapa-base, rede externa, backend/DB, download ou autenticação real. Status fixtures conforme disposição final de pesquisa recebida do main às 21:24:03. FUNAI jamais healthy. APIs desconhecidas falham." }) });
Object.defineProperty(window, "__INSTITUTIONAL_ACTIONS__", { value: { pan: () => mapProbe?.pan(), openPopup: () => mapProbe?.popup() ?? false } });
function StateProbe({ basemapId }: { basemapId: string }) {
  const state = useInstitutionalLayers();
  panelState = { basemapId, enabled: state.enabled, request: state.request, statuses: state.statuses, layers: state.layers, sourcesError: state.sourcesError };
  return null;
}
function Harness() {
  const [enabledIds, setEnabledIds] = useState<number[]>([]);
  const [basemapId, setBasemapId] = useState(DEFAULT_BASEMAP.id);
  return <main className="min-h-screen bg-muted/20 text-foreground" data-testid="institutional-real-harness">
    <header className="sticky top-0 z-[2000] border-b border-amber-300 bg-amber-50 p-3 text-amber-950"><h1 className="text-sm font-bold">HARNESS INSTITUCIONAL · SINTÉTICO · MOCK</h1><p className="text-xs">Componentes reais; API/papel apenas em memória. Sem sessão, OAuth, DB, rede externa ou dados geográficos originais. FUNAI: TLS bloqueado.</p></header>
    {card ? <section className="mx-auto max-w-4xl space-y-3 p-3"><IbgeSourceCard /><InstitutionalSourcesCard /></section> : <InstitutionalLayersProvider viewMode="2d"><StateProbe basemapId={basemapId} /><section className="relative h-[calc(100dvh-8rem)] min-h-[460px] bg-slate-100" data-testid="synthetic-map-canvas"><MapContainer center={[0, 0]} zoom={10} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} zoomControl={false}><InstitutionalMapLayers /><MapProbe /></MapContainer><p className="pointer-events-none absolute bottom-6 left-2 z-[500] max-w-[80%] text-xs text-slate-700">HARNESS: mapa vazio, eventual polígono artificial. Nenhum mapa-base ou WMS solicitado.</p><GlobalMapPanels enabledIds={enabledIds} onChange={setEnabledIds} basemapId={basemapId} onBasemapChange={setBasemapId} viewMode="2d" selectionReady selectionPending={false} onRetrySelection={() => {}} /></section></InstitutionalLayersProvider>}
    <Toaster />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Router hook={memory.hook} searchHook={memory.searchHook}><trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><Harness /></QueryClientProvider></trpc.Provider></Router>);
