import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "../../server/routers";
import { trpc } from "./lib/trpc";
import BaseLayers from "./pages/BaseLayers";
import { ANEEL_SIGA_ATTRIBUTION, ANEEL_SIGA_SOURCE_URL, ANEEL_SIGA_RESOURCE_ID, ANEEL_SIGA_GEO_NOTICE } from "@shared/aneelSiga";
import "./index.css";

/** LAB ONLY: real management page + MemoryTRPCLink. No App/backend/session/DB/env/remote calls. */
const calls: Array<{ path: string; input: unknown; type: string }> = [];
let mode: "ok" | "error" = "ok";
let actor = 9903;
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false }, mutations: { retry: false } } });
const memory = memoryLocation({ path: "/base-layers", record: true });
const stamp = "2026-11-03T03:00:00.000Z";
const link: TRPCLink<AppRouter> = () => ({ op }) => observable(observer => {
  calls.push({ path: op.path, input: op.input ?? null, type: op.type });
  const timer = setTimeout(() => {
    try {
      let data: unknown;
      if (op.type !== "query") throw new Error("LAB_ONLY_NO_MUTATIONS");
      switch (op.path) {
        case "auth.me": data = actor ? { id: actor, openId: `fixture-${actor}`, name: "Usuário sintético", role: "user" } : null; break;
        case "baseLayers.list": data = ["funai", "incra", "iphan", "osm"].map((source, index) => ({ id: index + 1, name: `Cache sintético ${source}`, source, layerType: source === "funai" ? "terras_indigenas" : source === "osm" ? "rodovias" : "other", dataFormat: "geojson", dataUrl: null, downloadStatus: "pending", featureCount: null, isActive: true, cacheExpiresAt: null, lastDownloadAt: null, cacheState: "missing" })); break;
        case "ogcCatalog.listPublished": case "institutionalCatalog.listSources": data = []; break;
        case "indeCatalog.layers": {
          if ((op.input as any)?.organizationId !== "inde-service-7780c680bcf29d1b") throw new Error("LAB_WRONG_ORG");
          data = { organizationId: "inde-service-7780c680bcf29d1b", version: "1.3.0", fetchedAt: stamp, capabilitySha256: "a".repeat(64), truncated: false, layers: [{ name: "CMR-PUBLICO:lim_terra_indigena_a", title: "Limite sintético de teste", crs: ["EPSG:3857", "EPSG:4326"] }] }; break;
        }
        case "aneelSiga.query": {
          if (mode === "error") throw new Error("FALHA_SINTÉTICA_AN EEL".replace(" ", ""));
          const input = op.input as { offset: number; limit: number; uf?: string };
          const offset = input.offset ?? 0;
          const rows = offset >= 40 ? [] : [0, 1].map(i => ({ recordId: offset + i + 1, name: i === 0 ? `Usina sintética ${offset + 1}` : '<img src="/xss-fixture-never" onerror="window.__XSS__=1">', ceg: "TESTE.CEG.REPETIDO", uf: input.uf ?? "MG", generationType: "PCH", phase: "Fase sintética", awardType: "Outorga sintética", generatedAt: "2026-11-02", authorizedPowerKw: 0, monitoredPowerKw: null, centroid: { latitude: null, longitude: null, crs: null, approximate: true } }));
          data = { source: "ANEEL", dataset: "SIGA diário", attribution: ANEEL_SIGA_ATTRIBUTION, license: "ODbL", sourceUrl: ANEEL_SIGA_SOURCE_URL, resourceId: ANEEL_SIGA_RESOURCE_ID, queriedAt: stamp, totalRecords: 45, offset, limit: input.limit, hasNext: offset < 20, rows, geoNotice: ANEEL_SIGA_GEO_NOTICE, preciseMapAvailable: false }; break;
        }
        default: throw new Error(`LAB_UNKNOWN_PATH:${op.path}`);
      }
      observer.next({ result: { data } }); observer.complete();
    } catch (error) { observer.error(TRPCClientError.from(error instanceof Error ? error : new Error(String(error)))); }
  }, 25);
  return () => clearTimeout(timer);
});
const client = trpc.createClient({ links: [link] });
Object.defineProperty(window, "__SOURCE_HARNESS__", { value: {
  calls, setMode: (value: "ok" | "error") => { mode = value; },
  setActor: (value: number) => { actor = value; void queryClient.invalidateQueries({ queryKey: [["auth", "me"]] }); },
  synthetic: true, scope: "Componentes reais da página BaseLayers, transporte em memória. Não é sessão OAuth, backend, banco, storage ou dados oficiais.",
} });
createRoot(document.getElementById("root")!).render(<Router hook={memory.hook} searchHook={memory.searchHook}><trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><header className="border-b border-amber-600 bg-amber-100 p-3 text-amber-950"><h1 className="font-bold">LABORATÓRIO SINTÉTICO FUNAI/ANEEL</h1><p>Componentes reais; API e identidade só em memória. Sem login/OAuth, banco, produção, dados originais ou rede externa. Não substitui o aplicativo.</p></header><BaseLayers /></QueryClientProvider></trpc.Provider></Router>);
