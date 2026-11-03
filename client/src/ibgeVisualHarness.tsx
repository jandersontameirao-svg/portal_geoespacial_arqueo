import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { Toaster } from "sonner";
import type { AppRouter } from "../../server/routers";
import { trpc } from "./lib/trpc";
import GlobalMapPanels from "./components/GlobalMapPanels";
import IbgeSourceCard from "./components/IbgeSourceCard";
import { InstitutionalLayersProvider, useInstitutionalLayers } from "./components/InstitutionalMapLayers";
import { DEFAULT_BASEMAP } from "./lib/basemaps";
import "./index.css";
/** NO App/OAuth, HTTP link, real map, layer overlay, raster/image response, backend or database. */
type Call = { index: number; path: string; type: string; input: unknown; response?: unknown; error?: string };
const calls: Call[] = [];
const suppressedStorageWrites: Array<{ key: string; value: string }> = [];
Storage.prototype.setItem = function (key: string, value: string) { suppressedStorageWrites.push({ key, value }); };
const caseId = new URLSearchParams(location.search).get("case") ?? "map-desktop";
const reader = caseId.includes("reader");
const card = caseId.startsWith("card");
const memory = memoryLocation({ path: "/synthetic", record: true });
const now = new Date("2026-01-01T12:00:00Z");
const cacheFixtures = [
  { id: 7001, name: "FUNAI — cache sintético", source: "funai", layerType: "terras_indigenas" },
  { id: 7002, name: "INCRA — cache sintético", source: "incra", layerType: "terras_quilombolas" },
  { id: 7003, name: "IPHAN — cache sintético", source: "iphan", layerType: "sitios_arqueologicos" },
  { id: 7004, name: "OpenStreetMap — cache sintético", source: "osm", layerType: "rodovias" },
].map(row => ({ ...row, description: "MOCK: metadados somente; nenhuma geometria", dataFormat: "geojson", dataUrl: "https://fixture.invalid/never-request.geojson", downloadStatus: "completed", featureCount: 0, userVisible: false, isActive: true, isCacheStale: false, createdAt: now, updatedAt: now }));
const remoteLayer = "CGEO:C02_recortes_territoriais_municipio_2010";
const publishedFixtures = (["wms", "wfs"] as const).map((serviceType, index) => {
  const variant = { id: 9101 + index, serviceId: 9201 + index, publisher: "IBGE", serviceType, endpoint: `https://fixture.invalid/ibge/${serviceType}`, remoteLayer, attribution: "Fonte: IBGE · fixture sintética, edição 2010", health: "healthy", displayCrs: "EPSG:3857", role: "primary", priority: 1, enabled: true, serviceEnabled: true };
  return { logicalLayer: `IBGE — Municípios 2010 ${serviceType.toUpperCase()}`, selected: variant, primary: variant, isFallback: false, reason: null };
});
let published = card ? [] as typeof publishedFixtures : structuredClone(publishedFixtures);
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, staleTime: Infinity }, mutations: { retry: false } } });
const memoryLink: TRPCLink<AppRouter> = () => ({ op }) => observable(observer => {
  const call: Call = { index: calls.length + 1, path: op.path, type: op.type, input: op.input === undefined ? null : structuredClone(op.input) };
  calls.push(call);
  const timer = window.setTimeout(() => {
    try {
      let data: unknown;
      switch (op.path) {
        case "auth.me": data = { id: 9000, name: "SESSÃO SINTÉTICA NÃO AUTENTICADA", role: reader ? "viewer" : "admin", email: null }; break;
        case "baseLayers.catalog": data = cacheFixtures; break;
        case "projects.list": data = [{ id: 4242, name: "Projeto sintético", code: "MOCK", ownerId: 9000, status: "active", createdAt: now, updatedAt: now }]; break;
        case "layers.list": case "geometries.list": data = []; break;
        case "ogcCatalog.listPublished": data = published; break;
        case "ogcCatalog.listServices": data = published.map(row => ({ ...row.selected, id: row.selected.serviceId })); break;
        case "ogcCatalog.registerIbge": {
          if (reader || op.type !== "mutation") throw new Error("MOCK_REGISTER_FORBIDDEN");
          published = structuredClone(publishedFixtures);
          data = { success: true, idempotent: false, records: published.map(row => ({ serviceId: row.selected.serviceId, variantId: row.selected.id, serviceType: row.selected.serviceType, logicalLayer: row.logicalLayer, endpoint: row.selected.endpoint })), edition: 2010, attribution: "Fonte: IBGE · fixture sintética", evidence: { synthetic: true }, persisted: false, transport: "MOCK MemoryTRPCLink — no DB" };
          break;
        }
        default: throw new Error(`MOCK_UNKNOWN_PATH: ${op.type} ${op.path}; sem fallback`);
      }
      call.response = structuredClone(data); observer.next({ result: { data } }); observer.complete();
    } catch (error) { call.error = error instanceof Error ? error.message : String(error); observer.error(TRPCClientError.from(new Error(call.error))); }
  }, 35);
  return () => window.clearTimeout(timer);
});
const client = trpc.createClient({ links: [memoryLink] });
let panelState: unknown = null;
Object.defineProperty(window, "__IBGE_HARNESS__", { get: () => ({ caseId, calls: structuredClone(calls), panelState: structuredClone(panelState), published: structuredClone(published), cacheFixtures: structuredClone(cacheFixtures), suppressedStorageWrites: structuredClone(suppressedStorageWrites), navigationHistory: [...memory.history], synthetic: true, transport: "MOCK MemoryTRPCLink (no HTTP, no DB)", authentication: "Synthetic role return only; no actual login/authorization tested", limits: "No App/OAuth, backend/DB, persistent storage, WFS query, real map/tiles, geography/download, remote availability or real authentication. Unknown API paths fail explicitly." }) });
function StateProbe({ basemapId }: { basemapId: string }) {
  const state = useInstitutionalLayers();
  panelState = { basemapId, enabled: state.enabled, request: state.request, statuses: state.statuses };
  return null;
}
function Harness() {
  const [enabledIds, setEnabledIds] = useState<number[]>([]);
  const [basemapId, setBasemapId] = useState(DEFAULT_BASEMAP.id);
  return <main className="min-h-screen bg-muted/20 text-foreground" data-testid="ibge-real-harness">
    <header className="border-b border-amber-300 bg-amber-50 p-3 text-amber-950"><h1 className="text-sm font-bold">HARNESS IBGE · TRANSPORTE MOCK</h1><p className="text-xs">UI real · sessão/DB sintéticos · sem login, App/OAuth, mapas, tiles ou downloads. Não comprova backend/autorização real.</p></header>
    {card ? <section className="mx-auto max-w-4xl p-3"><IbgeSourceCard /></section> : <InstitutionalLayersProvider viewMode="2d"><StateProbe basemapId={basemapId} /><section className="relative h-[calc(100dvh-7rem)] min-h-[480px] bg-slate-100" data-testid="synthetic-map-canvas"><p className="absolute bottom-2 left-2 text-xs text-slate-700">Canvas sintético sem geometria e sem tiles</p><GlobalMapPanels enabledIds={enabledIds} onChange={setEnabledIds} basemapId={basemapId} onBasemapChange={setBasemapId} viewMode="2d" selectionReady selectionPending={false} onRetrySelection={() => {}} /></section></InstitutionalLayersProvider>}
    <Toaster />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Router hook={memory.hook} searchHook={memory.searchHook}><trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><Harness /></QueryClientProvider></trpc.Provider></Router>);
