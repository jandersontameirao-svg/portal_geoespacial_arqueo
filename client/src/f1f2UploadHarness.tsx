import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { Toaster } from "sonner";
import type { AppRouter } from "../../server/routers";
import { trpc } from "./lib/trpc";
import FileUpload from "./components/FileUpload";
import RasterIngestionPanel from "./components/RasterIngestionPanel";
import "./index.css";

/**
 * Synthetic UI proof only. These APIs are intentionally mocked:
 * - raster.ingestionAvailability: controlled availability flag, no worker call.
 * - files.upload: records input and acknowledges in memory; stores NO file.
 * - raster.ingestGeoTiff: records input, then rejects or acknowledges in memory.
 * No HTTP link, App, auth provider, OAuth bypass, database, storage, scanner or COG.
 * Synthetic File bytes are NOT a valid georeferenced TIFF and never leave memory.
 */
type RecordedCall = {
  index: number;
  path: string;
  type: string;
  input: unknown;
  outcome: "mock-success" | "mock-error";
  response?: unknown;
  error?: string;
};
const flags = { available: false, rejectRaster: true };
const calls: RecordedCall[] = [];
let completionCallbacks = 0;
const caseId = new URLSearchParams(location.search).get("case") || "manual";
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, staleTime: Infinity },
    mutations: { retry: false },
  },
});

const memoryLink: TRPCLink<AppRouter> = () => ({ op }) => observable((observer) => {
  const record: RecordedCall = {
    index: calls.length + 1, path: op.path, type: op.type,
    input: op.input === undefined ? null : structuredClone(op.input), outcome: "mock-success",
  };
  calls.push(record);
  // Snapshot the controls for this operation, rather than changing it mid-flight.
  const active = { ...flags };
  const timer = window.setTimeout(() => {
    try {
      let data: unknown;
      if (op.path === "raster.ingestionAvailability" && op.type === "query") {
        data = { available: active.available, mode: "synthetic-memory-only", reason: active.available ? undefined : "MOCK: serviço raster indisponível." };
      } else if (op.path === "files.upload" && op.type === "mutation") {
        data = { id: 9001, synthetic: true, persisted: false };
      } else if (op.path === "raster.ingestGeoTiff" && op.type === "mutation") {
        if (active.rejectRaster) throw new Error("MOCK_RASTER_REJECTED: falha raster sintética; sem fallback.");
        data = { id: 9002, tileCount: 0, synthetic: true, persisted: false };
      } else {
        throw new Error(`API não autorizada no harness: ${op.type} ${op.path}`);
      }
      record.response = data;
      observer.next({ result: { data } });
      observer.complete();
    } catch (error) {
      record.outcome = "mock-error";
      record.error = error instanceof Error ? error.message : String(error);
      observer.error(TRPCClientError.from(new Error(record.error)));
    } finally {
      window.dispatchEvent(new Event("f1f2-mock-updated"));
    }
  }, 25);
  return () => window.clearTimeout(timer);
});
const client = trpc.createClient({ links: [memoryLink] });

// Read-only inspection surface: interactions still go through DOM events.
Object.defineProperty(window, "__F1F2_HARNESS__", {
  get: () => ({
    caseId, flags: { ...flags }, calls: structuredClone(calls), completionCallbacks,
    appId: import.meta.env.VITE_APP_ID,
    mockedApis: ["raster.ingestionAvailability", "files.upload", "raster.ingestGeoTiff"],
    limits: "No real storage, database, scanner, raster processing, OAuth or application authentication.",
  }),
});

function Harness() {
  const [available, setAvailable] = useState(false);
  const [rejectRaster, setRejectRaster] = useState(true);
  const [revision, setRevision] = useState(0);
  React.useEffect(() => {
    const update = () => setRevision((value) => value + 1);
    window.addEventListener("f1f2-mock-updated", update);
    return () => window.removeEventListener("f1f2-mock-updated", update);
  }, []);
  return <main className="mx-auto max-w-6xl space-y-5 p-6" data-harness="f1f2-upload" data-revision={revision}>
    <header className="rounded-xl border border-blue-200 bg-blue-50 p-5">
      <p className="text-xs font-bold uppercase tracking-widest text-blue-800">F1/F2 • evidência visual sintética • loopback isolado</p>
      <h1 className="mt-2 text-2xl font-semibold">Upload TIFF — componentes reais, APIs simuladas</h1>
      <p className="mt-2 text-sm">FileUpload.tsx e RasterIngestionPanel.tsx sem substituições. Fixtures File do navegador; React Query + tRPC Provider com link em memória.</p>
      <p className="mt-2 text-sm font-semibold text-red-800">Não prova storage, DB, scanner, COG, OAuth nem autorização real. As mensagens dos componentes abaixo refletem respostas simuladas.</p>
      <p className="mt-2 text-xs">Caso: <code data-testid="case-id">{caseId}</code> · VITE_APP_ID: {import.meta.env.VITE_APP_ID}</p>
    </header>
    <section className="flex flex-wrap gap-5 rounded border bg-slate-50 p-4" aria-label="Controles das APIs simuladas">
      <label className="flex items-center gap-2"><input data-testid="mock-availability" type="checkbox" checked={available} onChange={async (event) => {
        flags.available = event.target.checked;
        setAvailable(flags.available);
        await queryClient.invalidateQueries();
      }} />API simulada disponível</label>
      <label className="flex items-center gap-2"><input data-testid="mock-reject-raster" type="checkbox" checked={rejectRaster} onChange={(event) => {
        flags.rejectRaster = event.target.checked;
        setRejectRaster(flags.rejectRaster);
      }} />API simulada rejeita raster</label>
    </section>
    <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
      <section data-testid="real-file-upload" className="space-y-3">
        <h2 className="text-lg font-semibold">FileUpload real</h2>
        <FileUpload projectId={4242} onUploadComplete={() => { completionCallbacks++; }} />
      </section>
      <section data-testid="real-raster-panel" className="space-y-3">
        <h2 className="text-lg font-semibold">RasterIngestionPanel real</h2>
        <RasterIngestionPanel projectId={4242} canEdit={true} />
        <div className="rounded border bg-slate-50 p-4 text-sm">
          <h3 className="font-semibold">Contratos inteiramente simulados</h3>
          <p className="mt-2">raster.ingestionAvailability: flag local.</p>
          <p>files.upload: registra payload e responde em memória.</p>
          <p>raster.ingestGeoTiff: rejeição controlada; sem worker.</p>
          <p className="mt-2">Nenhum App ou fluxo de autenticação é montado. Não há link HTTP tRPC.</p>
        </div>
      </section>
    </div>
    <section className="rounded border p-4">
      <h2 className="text-sm font-semibold">Chamadas capturadas (simuladas)</h2>
      <pre data-testid="mock-calls" className="mt-2 max-h-60 overflow-auto text-xs">{JSON.stringify(calls, null, 2)}</pre>
    </section>
    <Toaster position="bottom-right" richColors duration={60000} visibleToasts={8} />
  </main>;
}

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={client} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>
  </trpc.Provider>,
);
