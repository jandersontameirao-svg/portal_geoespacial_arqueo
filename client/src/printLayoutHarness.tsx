import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { Toaster } from "sonner";
import type { AppRouter } from "../../server/routers";
import type { MapPrintSnapshot } from "@shared/mapPrint";
import { trpc } from "@/lib/trpc";
import { captureMapSnapshot } from "@/lib/captureMapSnapshot";
import MapPrintPreview from "@/components/MapPrintPreview";
import "leaflet/dist/leaflet.css";
import "./index.css";

/** Dedicated local harness. Never imports App, OAuth, server code or any HTTP tRPC link. */
type Call = { index: number; path: string; type: string; input: unknown; response?: unknown; error?: string; pending: boolean };
type CaptureCall = { index: number; startedAt: number; settledAt?: number; aborted?: boolean; error?: string; width?: number; height?: number };
type Download = { index: number; url: string; type: string; size: number; dataUrl?: string; filename?: string };
const caseId = new URLSearchParams(location.search).get("case") || "desktop";
const role = caseId.includes("client") ? "client" : "admin";
const calls: Call[] = [], captures: CaptureCall[] = [], downloads: Download[] = [];
const now = new Date("2026-11-02T22:00:00Z");
const legacyTemplate = { id: 601, projectId: 4242, name: "Atlas legado intocado", templateType: "abnt_tecnico" as const, config: { atlasVersion: 1, pageSize: "A3", orientation: "landscape", scale: 10000, sentinel: "LEGACY_MUST_NOT_MUTATE", layers: [73] }, isDefault: true, createdBy: 9000, createdAt: now, updatedAt: now };
let templates: Array<Record<string, unknown>> = [structuredClone(legacyTemplate)];
let lastSnapshot: MapPrintSnapshot | null = null;
let map: L.Map | null = null;
let mapReady = false, openState = false, closeCount = 0;
const fixtureEvents: Array<Record<string, unknown>> = [];
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false }, mutations: { retry: false } } });
const memoryLink: TRPCLink<AppRouter> = () => ({ op }) => observable(observer => {
  const call: Call = { index: calls.length + 1, path: op.path, type: op.type, input: structuredClone(op.input ?? null), pending: true };
  calls.push(call);
  const timer = window.setTimeout(() => {
    try {
      let data: unknown;
      switch (op.path) {
        case "auth.me": data = { id: 9000, name: "MOCK — sessão sintética", role, email: null, openId: "mock-not-authenticated", createdAt: now, updatedAt: now, lastSignedIn: now }; break;
        case "atlas.templates.list": {
          if ((op.input as { projectId?: number })?.projectId !== 4242) throw Error("MOCK_WRONG_PROJECT");
          data = structuredClone(templates); break;
        }
        case "atlas.templates.create": {
          const input = op.input as Record<string, unknown>;
          if (role !== "admin" || op.type !== "mutation" || input.projectId !== 4242) throw Error("MOCK_CREATE_FORBIDDEN");
          const id = 700 + templates.length;
          templates = [...templates, { ...structuredClone(input), id, createdBy: 9000, createdAt: now, updatedAt: now }];
          data = { success: true, id }; break;
        }
        default: throw Error(`MOCK_UNKNOWN_API: ${op.type} ${op.path}; no HTTP fallback`);
      }
      call.pending = false; call.response = structuredClone(data); observer.next({ result: { data } }); observer.complete();
    } catch (error) {
      call.pending = false; call.error = error instanceof Error ? error.message : String(error);
      observer.error(TRPCClientError.from(new Error(call.error)));
    }
  }, op.path === "atlas.templates.create" ? 650 : 45);
  return () => window.clearTimeout(timer);
});
const client = trpc.createClient({ links: [memoryLink] });

// Observe exactly the PDF blob made by the real export, without replacing its bytes/exporter.
const nativeCreateObjectURL = URL.createObjectURL.bind(URL);
URL.createObjectURL = (blob: Blob | MediaSource) => {
  const url = nativeCreateObjectURL(blob);
  if (blob instanceof Blob && (blob.type === "application/pdf" || blob.type.includes("pdf"))) {
    const item: Download = { index: downloads.length + 1, url, type: blob.type, size: blob.size };
    downloads.push(item);
    const reader = new FileReader(); reader.onload = () => { item.dataUrl = String(reader.result); }; reader.readAsDataURL(blob);
  }
  return url;
};
document.addEventListener("click", event => {
  const anchor = (event.target as Element)?.closest?.("a[download]") as HTMLAnchorElement | null;
  if (anchor) { const item = downloads.find(row => row.url === anchor.href); if (item) item.filename = anchor.download; }
}, true);

function purpleImage() {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d")!; context.fillStyle = "#9a44cc"; context.fillRect(0, 0, 128, 128);
  return canvas.toDataURL("image/png");
}
const legend = [{ label: "Polígono sintético (SVG)", color: "#16c45c" }, { label: "ImageOverlay sintético", color: "#9a44cc" }, { label: "Linha sintética", color: "#ffe234" }];
function Harness() {
  const element = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false), [open, setOpen] = useState(false);
  openState = open;
  useEffect(() => {
    if (!element.current) return;
    const localMap = L.map(element.current, { zoomControl: false, attributionControl: true, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, preferCanvas: false }).setView([-14, -49], 10);
    map = localMap;
    const failed = caseId.includes("tile-failure");
    const base = L.tileLayer(`/__print_fixture__/${failed ? "fail" : "blue"}/{z}/{x}/{y}.png`, { crossOrigin: "anonymous", attribution: "Base local sintética — não cartografia real", keepBuffer: 0 }).addTo(localMap);
    const wms = L.tileLayer.wms("/__print_fixture__/wms", { layers: "synthetic", format: "image/png", transparent: true, version: "1.1.1", crossOrigin: "anonymous", attribution: "WMS fixture local — sem GIS backend", keepBuffer: 0 }).addTo(localMap);
    [base, wms].forEach(layer => layer.on("tileload tileerror loading load", (event: L.LeafletEvent) => { fixtureEvents.push({ type: event.type, layer: layer === base ? "base" : "wms", at: performance.now() }); }));
    const bounds = localMap.getBounds(), south = bounds.getSouth(), west = bounds.getWest(), latSpan = bounds.getNorth() - south, lngSpan = bounds.getEast() - west;
    const point = (x: number, y: number): L.LatLngTuple => [south + latSpan * y, west + lngSpan * x];
    L.imageOverlay(purpleImage(), [point(.08, .12), point(.38, .42)], { opacity: 1, crossOrigin: "anonymous", attribution: "ImageOverlay local sintético" }).addTo(localMap);
    L.polygon([point(.57, .55), point(.86, .57), point(.78, .88), point(.53, .8)], { color: "#16c45c", fillColor: "#16c45c", fillOpacity: 1, weight: 3, interactive: false }).addTo(localMap);
    L.polyline([point(.12, .48), point(.45, .30), point(.89, .43)], { color: "#ffe234", opacity: 1, weight: 8, interactive: false }).addTo(localMap);
    const timer = window.setTimeout(() => { mapReady = true; setReady(true); }, 450);
    return () => { clearTimeout(timer); mapReady = false; map = null; localMap.remove(); };
  }, []);
  const capture = useCallback(async (signal?: AbortSignal): Promise<MapPrintSnapshot> => {
    if (!map) throw Error("Leaflet fixture is not mounted");
    const call: CaptureCall = { index: captures.length + 1, startedAt: performance.now() }; captures.push(call);
    try {
      // API adapter is intentionally confined to this harness; the imported implementation does all rendering/validation.
      const invoke = captureMapSnapshot as unknown as (map: L.Map, options: { signal?: AbortSignal; legend: typeof legend; timeoutMs: number }) => Promise<MapPrintSnapshot>;
      const snapshot = await invoke(map, { signal, legend, timeoutMs: 1800 });
      if (caseId.includes("cancel")) await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, 1200);
        signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      });
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      lastSnapshot = snapshot; call.width = snapshot.width; call.height = snapshot.height;
      return snapshot;
    } catch (error) {
      call.error = error instanceof Error ? error.message : String(error); call.aborted = signal?.aborted || (error instanceof DOMException && error.name === "AbortError"); throw error;
    } finally { call.settledAt = performance.now(); }
  }, []);
  return <main data-testid="print-layout-harness" style={{ minHeight: "100dvh", background: "#edf2f7", color: "#122033", padding: 12 }}>
    <header style={{ paddingBottom: 10 }}><h1 style={{ fontWeight: 700, fontSize: 16 }}>Impressão · harness local sintético</h1><p style={{ fontSize: 12 }}>Leaflet e exportação reais · tiles/overlays sintéticos · tRPC MOCK em memória · sem OAuth, banco ou GIS remoto.</p></header>
    <div ref={element} data-testid="real-leaflet-fixture" style={{ isolation: "isolate", zIndex: 0, width: "100%", height: innerWidth < 600 ? 320 : 430, background: "#2070d0" }} />
    <button data-testid="harness-open-print" disabled={!ready} onClick={() => setOpen(true)} style={{ marginTop: 12, padding: "10px 18px", background: "#123858", color: "white", borderRadius: 6 }}>Abrir impressão real</button>
    <p style={{ fontSize: 12, marginTop: 8 }}>Fixture sem significado geográfico: azul (tile), violeta (imagem), verde (SVG), amarelo (linha). Caso: {caseId}. Papel é configurado pelo componente real.</p>
    <MapPrintPreview projectId={4242} projectName="Projeto sintético — prova de pixels" open={open} onClose={() => { closeCount++; setOpen(false); }} captureMap={capture} />
    <Toaster />
  </main>;
}
Object.defineProperty(window, "__PRINT_HARNESS__", { get: () => ({ caseId, role, mapReady, open: openState, closeCount, calls: structuredClone(calls), captures: structuredClone(captures), downloads: structuredClone(downloads), snapshot: lastSnapshot ? structuredClone(lastSnapshot) : null, templates: structuredClone(templates), legacyTemplate: structuredClone(legacyTemplate), fixtureEvents: structuredClone(fixtureEvents), map: map ? { size: map.getSize(), bounds: map.getBounds(), crs: map.options.crs?.code, svg: map.getContainer().querySelector("svg")?.outerHTML, rect: map.getContainer().getBoundingClientRect().toJSON() } : null, synthetic: true, transport: "MOCK MemoryTRPCLink; no HTTP API, no DB", limitations: ["No real login/OAuth/authorization", "No GIS backend, production or remote tiles", "No proof of remote CORS compatibility", "Synthetic local pixels, not real cartography", "Template persistence only in this page's memory"] }) });
createRoot(document.getElementById("root")!).render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><Harness /></QueryClientProvider></trpc.Provider>);
