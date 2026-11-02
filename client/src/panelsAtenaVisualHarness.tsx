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
import AtenaPanel from "./components/AtenaPanel";
import { DEFAULT_BASEMAP } from "./lib/basemaps";
import "./index.css";

/** UI ONLY. No App, auth provider, OAuth, cookies, persistence, HTTP link or server imports. */
type Call = { index: number; path: string; type: string; input: unknown; response?: unknown; error?: string };
const calls: Call[] = [];
// MyProjectsPanel real usa useAuth, cujo hook tenta registrar a sessão no storage.
// No harness a fronteira é explicitamente NÃO persistente: registrar a tentativa
// em memória e suprimir a escrita, sem alterar o componente/hook de produção.
const suppressedStorageWrites: Array<{ key: string; value: string }> = [];
Storage.prototype.setItem = function (key: string, value: string) {
  suppressedStorageWrites.push({ key, value });
};
const caseId = new URLSearchParams(location.search).get("case") ?? "map";
const memory = memoryLocation({ path: "/synthetic", record: true });
const now = new Date("2026-01-01T12:00:00Z");
const projects = [
  { id: 4242, name: "Projeto Sintético Alfa", code: "QA-ALFA", createdAt: now, updatedAt: now, status: "active", ownerId: 9000 },
  { id: 4243, name: "Projeto Sintético Beta", code: "QA-BETA", createdAt: now, updatedAt: now, status: "active", ownerId: 9000 },
];
const nodes = [
  { id: 8100, name: "Grupo sintético", projectId: 4242, parentId: null, isGroup: true, sortOrder: 0, userVisible: true, effectiveVisible: true, layerType: "vector", crs: "EPSG:4326", featureCount: 0 },
  { id: 8101, name: "Insumo sintético", projectId: 4242, parentId: 8100, isGroup: false, sortOrder: 0, userVisible: true, effectiveVisible: true, layerType: "vector", crs: "EPSG:4326", featureCount: 2 },
];
const requests = {
  operation: "vector.buffer", sourceLayerIds: [8101], distanceM: 50, outputName: "Buffer sintético 50 m",
};
const plan = {
  planVersion: 1, skill: "vector.buffer", skillVersion: "synthetic-1", referenceLayer: null,
  sourceLayers: [{ id: 8101, name: "Insumo sintético", crs: "EPSG:4326", featureCount: 2 }],
  parameters: { distanceM: 50, unit: "m", areaMethod: "MOCK: nenhuma área foi calculada", bufferMethod: "MOCK: nenhum buffer foi calculado" },
  outputName: "Buffer sintético 50 m", steps: ["MOCK: validar parâmetros", "MOCK: representar criação de camada; não persiste"],
};
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, staleTime: Infinity }, mutations: { retry: false } } });
const memoryLink: TRPCLink<AppRouter> = () => ({ op }) => observable(observer => {
  const call: Call = { index: calls.length + 1, path: op.path, type: op.type, input: op.input === undefined ? null : structuredClone(op.input) };
  calls.push(call);
  const timer = window.setTimeout(() => {
    try {
      const input = (op.input ?? {}) as Record<string, unknown>;
      let data: unknown;
      switch (op.path) {
        case "auth.me": data = { id: 9000, name: "SESSÃO SINTÉTICA, não autenticada", role: "editor", email: null }; break;
        case "projects.list": data = projects; break;
        case "layers.list": data = nodes.map(node => ({ ...node, effectiveVisible: node.userVisible && (node.parentId == null || nodes.find(parent => parent.id === node.parentId)?.userVisible === true) })); break;
        case "geometries.list": {
          // Fixture deliberadamente vazia: nenhum desenho/exportação é exercitado.
          if (op.type !== "query" || !projects.some(project => project.id === input.projectId)) throw new Error("MOCK_GEOMETRIES_PROJECT_NOT_ALLOWED");
          data = []; break;
        }
        case "layers.setVisibility": { const node = nodes.find(row => row.id === input.id); if (!node) throw new Error("MOCK_NODE_MISSING"); node.userVisible = input.visible === true; data = { success: true, persisted: false }; break; }
        case "baseLayers.catalog": data = []; break;
        case "atena.status": data = { ai: { configured: true, mode: "MOCK: interpretação em memória; nenhum modelo" }, skills: [], skillVersions: {}, codeVersion: "synthetic-ui-only" }; break;
        case "atena.templates": data = [{ id: "areas_influencia", title: "Áreas de influência (sintético bloqueado)", purpose: "MOCK", status: "blocked", blockedReason: "MOCK: fonte remota bloqueada, sem fallback local", roles: [], version: "synthetic", defaultPageSize: "A3", defaultOrientation: "landscape" }]; break;
        case "atena.layers": data = nodes.filter(node => !node.isGroup); break;
        case "prospect.sources": data = { canWrite: true, geometries: [], layers: nodes.filter(node => !node.isGroup) }; break;
        case "atena.list": data = []; break;
        case "atena.interpret": data = { status: "proposal", request: requests, explanation: "MOCK: interpretação sintética determinística; nenhum modelo foi chamado." }; break;
        case "atena.plan": data = { status: "ready", plan }; break;
        case "atena.run": data = { outcome: "started", runId: 9900, reused: false, persisted: false }; break;
        case "atena.get": data = { id: 9900, projectId: 4242, status: "failed", steps: [], errorMessage: "MOCK_EXECUTION_FAILED: não é execução real; nenhum resultado criado", alerts: [], outputs: null }; break;
        default: throw new Error(`API não autorizada no harness: ${op.type} ${op.path}`);
      }
      call.response = structuredClone(data); observer.next({ result: { data } }); observer.complete();
    } catch (error) { call.error = error instanceof Error ? error.message : String(error); observer.error(TRPCClientError.from(new Error(call.error))); }
  }, 35);
  return () => window.clearTimeout(timer);
});
const client = trpc.createClient({ links: [memoryLink] });
Object.defineProperty(window, "__PANELS_ATENA_HARNESS__", { get: () => ({ caseId, calls: structuredClone(calls), suppressedStorageWrites: structuredClone(suppressedStorageWrites), storageBoundary: "Storage.setItem is a harness-only no-op, attempts recorded in memory; production useAuth is untouched", navigationHistory: [...memory.history], synthetic: true, mockedApis: ["auth.me", "projects.list", "layers.list", "geometries.list", "layers.setVisibility", "baseLayers.catalog", "atena.status", "atena.templates", "atena.layers", "prospect.sources", "atena.list", "atena.interpret", "atena.plan", "atena.run", "atena.get"], limits: "No App, OAuth, cookies, persistent storage, HTTP tRPC, model, GIS execution, remote source, backend validation or real authentication. auth.me is a synthetic return value, NOT a bypass." }) });
function Harness() {
  const [enabledIds, setEnabledIds] = useState([4242]);
  const [basemapId, setBasemapId] = useState(DEFAULT_BASEMAP.id);
  return <main className="min-h-screen bg-muted/20 text-foreground" data-testid="panels-atena-real-harness">
    <header className="border-b border-amber-300 bg-amber-50 p-3 text-amber-950"><h1 className="text-sm font-bold">HARNESS OFFLINE · APIs 100% SIMULADAS</h1><p className="text-xs">Componentes reais · tRPC em memória · sem App/OAuth/cookies/storage. Não prova autenticação nem backend. Nenhum mapa-base/tile é montado.</p></header>
    {caseId.startsWith("atena") ? <section className="mx-auto max-w-4xl p-3" data-testid="real-atena"><AtenaPanel embedded initialProjectId={caseId.includes("unauthorized") ? 999999 : undefined} /></section> : <section className="relative h-[calc(100dvh-5.5rem)] min-h-[480px] bg-slate-100 dark:bg-slate-900" data-testid="real-map-panels"><div className="absolute bottom-3 left-3 rounded border bg-white p-2 text-xs text-slate-700">Canvas sintético sem tiles · sem dados geográficos</div><GlobalMapPanels enabledIds={enabledIds} onChange={setEnabledIds} basemapId={basemapId} onBasemapChange={setBasemapId} viewMode="2d" selectionReady selectionPending={false} onRetrySelection={() => {}} /></section>}
    <Toaster />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Router hook={memory.hook} searchHook={memory.searchHook}><trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><Harness /></QueryClientProvider></trpc.Provider></Router>);
