import { useEffect, useMemo, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "../../../server/routers";
import { Checkbox } from "./ui/checkbox";

export const OFFICIAL_SELECTION_REQUEST_EVENT = "official-selection-request";

export const OFFICIAL_LAYERS_EVENT = "official-layers-change";
export const OFFICIAL_STATUS_EVENT = "official-layer-status";

type RouterOutputs = inferRouterOutputs<AppRouter>;
export type OfficialCatalog = RouterOutputs["official"]["catalog"];
export type OfficialRecord = OfficialCatalog[number];
export type OfficialQuery = RouterOutputs["official"]["query"];
type OfficialQueryOk = Extract<OfficialQuery, { status: "ok" }>;
export type OfficialProvenance = OfficialQueryOk extends { provenance: infer Value }
  ? Value
  : Record<string, unknown>;
export type OfficialTableRow = Record<string, string>;

export interface OfficialSelection {
  vectorIds: string[];
  wmsIds: string[];
  query: string;
}

export interface OfficialStatusDetail {
  id: string;
  status: string;
  message?: string;
  projectId?: number;
  rows?: OfficialTableRow[];
  provenance?: OfficialProvenance;
  complete?: boolean;
  matched?: number | null;
}

type OfficialStatus = "OPERACIONAL" | "PARCIAL" | "RESTRITA" | "INDISPONÍVEL" | "NÃO INTEGRADA";
type StatusMessage = OfficialStatusDetail;
type TableResult = {
  rows: OfficialTableRow[];
  provenance?: OfficialProvenance;
  complete?: boolean;
  matched?: number | null;
};

const stateClass: Record<OfficialStatus, string> = {
  OPERACIONAL: "bg-emerald-100 text-emerald-800",
  PARCIAL: "bg-amber-100 text-amber-800",
  RESTRITA: "bg-red-100 text-red-800",
  INDISPONÍVEL: "bg-slate-200 text-slate-700",
  "NÃO INTEGRADA": "bg-slate-100 text-slate-600",
};

function emitSelection(selection: OfficialSelection) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<OfficialSelection>(OFFICIAL_LAYERS_EVENT, { detail: selection }));
  }
}

function textValue(value: unknown, fallback = "não informado"): string {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value ? "sim" : "não";
  return String(value);
}

function provenanceValue(provenance: OfficialProvenance | undefined, key: string): string {
  if (!provenance || typeof provenance !== "object") return "não informado";
  const candidate = provenance as unknown as Record<string, unknown>;
  return textValue(candidate[key]);
}

function legendUrl(wms: NonNullable<OfficialRecord["wms"]>): string | undefined {
  let url: URL;
  try { url = new URL(wms.url); } catch { return undefined; }
  if (url.protocol !== "https:" || url.username || url.password) return undefined;
  url.searchParams.set("service", "WMS");
  url.searchParams.set("request", "GetLegendGraphic");
  url.searchParams.set("format", "image/png");
  url.searchParams.set("layer", wms.layer);
  url.searchParams.set("version", wms.version);
  return url.toString();
}

export default function OfficialBasesPanel() {
  const catalogQuery = trpc.official.catalog.useQuery();
  const { data, isLoading, isError, error, refetch } = catalogQuery;
  const [selection, setSelection] = useState<OfficialSelection>({ vectorIds: [], wmsIds: [], query: "" });
  const [statusMessages, setStatusMessages] = useState<Record<string, StatusMessage>>({});
  const [tableResults, setTableResults] = useState<Record<string, TableResult>>({});
  const [filter, setFilter] = useState("");

  useEffect(() => { emitSelection(selection); }, [selection]);
  useEffect(() => {
    const publish = () => emitSelection(selection);
    window.addEventListener(OFFICIAL_SELECTION_REQUEST_EVENT, publish);
    return () => window.removeEventListener(OFFICIAL_SELECTION_REQUEST_EVENT, publish);
  }, [selection]);
  useEffect(() => () => emitSelection({ vectorIds: [], wmsIds: [], query: "" }), []);

  useEffect(() => {
    const activeIds = new Set([...selection.vectorIds, ...selection.wmsIds]);
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<OfficialStatusDetail>).detail;
      if (!detail?.id || !activeIds.has(detail.id)) return;
      if (detail.status === "removed") {
        setStatusMessages(current => {
          const next = { ...current };
          delete next[detail.id];
          return next;
        });
        setTableResults(current => {
          const next = { ...current };
          delete next[detail.id];
          return next;
        });
        return;
      }
      setStatusMessages(current => ({ ...current, [detail.id]: detail }));
      if (detail.rows) {
        setTableResults(current => ({
          ...current,
          [detail.id]: {
            rows: detail.rows ?? [],
            provenance: detail.provenance,
            complete: detail.complete,
            matched: detail.matched,
          },
        }));
      } else if (["error", "not_queryable", "loading"].includes(detail.status)) {
        setTableResults(current => {
          const next = { ...current };
          delete next[detail.id];
          return next;
        });
      }
    };
    window.addEventListener(OFFICIAL_STATUS_EVENT, listener);
    return () => window.removeEventListener(OFFICIAL_STATUS_EVENT, listener);
  }, [selection.vectorIds, selection.wmsIds]);

  useEffect(() => {
    if (!data) return;
    const knownIds = new Set(data.map(row => row.id));
    setSelection(current => {
      const vectorIds = current.vectorIds.filter(id => knownIds.has(id));
      const wmsIds = current.wmsIds.filter(id => knownIds.has(id));
      if (vectorIds.length === current.vectorIds.length && wmsIds.length === current.wmsIds.length) return current;
      return { ...current, vectorIds, wmsIds };
    });
  }, [data]);

  useEffect(() => {
    setTableResults({});
    setStatusMessages({});
  }, [selection.query]);

  const rows = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase("pt-BR");
    return (data ?? []).filter(row => !needle || `${row.institution} ${row.layerName ?? ""} ${row.id}`.toLocaleLowerCase("pt-BR").includes(needle));
  }, [data, filter]);

  const toggle = (kind: "vectorIds" | "wmsIds", id: string, checked: boolean) => {
    setSelection(current => ({
      ...current,
      [kind]: checked ? Array.from(new Set([...current[kind], id])) : current[kind].filter(value => value !== id),
    }));
    if (!checked) {
      setStatusMessages(current => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setTableResults(current => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  };

  const consultTable = (id: string) => {
    if (selection.vectorIds.includes(id)) {
      setSelection(current => ({ ...current, vectorIds: current.vectorIds.filter(value => value !== id) }));
      setStatusMessages(current => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setTableResults(current => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      return;
    }
    if (!selection.query.trim()) {
      setStatusMessages(current => ({
        ...current,
        [id]: { id, status: "error", message: "Informe uma UF ou município para consultar a tabela; não há interseção espacial." },
      }));
      setTableResults(current => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      return;
    }
    setSelection(current => ({ ...current, vectorIds: Array.from(new Set([...current.vectorIds, id])) }));
  };

  return (
    <section data-testid="official-bases-panel" className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
      <div className="mb-2 flex items-center gap-2 font-medium">
        <ShieldCheck className="h-4 w-4 text-orange-600" />
        Bases oficiais V3
        <span className="ml-auto text-[10px] text-muted-foreground">somente allowlist</span>
      </div>
      <p className="mb-2 text-[11px] leading-4 text-muted-foreground">
        Vetor consulta somente a conexão DIRETA do recorte do viewport; WMS é imagem e não alimenta análise espacial. Tabelas são texto, sem coordenadas e sem interseção espacial. Nenhuma amostra local é apresentada como consulta.
      </p>
      <p className="mb-2 text-[10px] leading-4 text-amber-700">
        “OPERACIONAL” no catálogo não é homologação integral: consulta remota não prova persistência nem login real.
      </p>
      <input
        value={filter}
        onChange={event => setFilter(event.target.value)}
        placeholder="Filtrar instituição ou camada"
        aria-label="Filtrar bases oficiais"
        className="mb-2 w-full rounded border px-2 py-1 text-xs"
      />
      <input
        value={selection.query}
        onChange={event => setSelection(current => ({ ...current, query: event.target.value }))}
        placeholder="UF, município ou filtro de atributos"
        aria-label="Filtrar atributos das bases oficiais"
        className="mb-2 w-full rounded border px-2 py-1 text-xs"
        maxLength={120}
      />
      {isLoading && <p className="text-xs text-muted-foreground">Carregando catálogo oficial…</p>}
      {!isLoading && !isError && rows.length === 0 && <p className="text-xs text-muted-foreground">{data?.length ? "Nenhuma fonte corresponde ao filtro." : "Nenhuma fonte oficial catalogada."}</p>}
      {isError && (
        <div className="mb-2 text-xs text-red-700">
          <p>Falha ao carregar catálogo: {error?.message ?? "resposta indisponível"}</p>
          <button type="button" className="underline" onClick={() => { void refetch(); }}>Tentar novamente</button>
        </div>
      )}
      <div className="max-h-[34vh] space-y-2 overflow-y-auto pr-1">
        {rows.map(row => {
          const vectorEnabled = row.queryable && row.connectionMode === "remote" && row.geometryMode === "vector";
          const tableEnabled = row.queryable && row.connectionMode === "remote" && row.geometryMode === "tabular";
          const wmsEnabled = Boolean(row.wms && legendUrl(row.wms));
          const vectorChecked = selection.vectorIds.includes(row.id);
          const wmsChecked = selection.wmsIds.includes(row.id);
          const status = statusMessages[row.id];
          const tableResult = tableResults[row.id];
          return (
            <article key={row.id} className="rounded border border-slate-200 p-2 dark:border-slate-700" data-testid={`official-row-${row.id}`}>
              <div className="flex items-start gap-2">
                {vectorEnabled && (
                  <Checkbox checked={vectorChecked} onCheckedChange={checked => toggle("vectorIds", row.id, checked === true)} aria-label={`Mostrar vetor ${row.institution}`} />
                )}
                {wmsEnabled && (
                  <Checkbox checked={wmsChecked} onCheckedChange={checked => toggle("wmsIds", row.id, checked === true)} aria-label={`Mostrar imagem WMS ${row.institution}`} />
                )}
                {!vectorEnabled && !wmsEnabled && <span className="w-4" aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-xs font-medium">{row.institution}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${stateClass[row.state]}`}>{row.state}</span>
                    {row.connectionMode === "remote" ? (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800">conexão DIRETA</span>
                    ) : (
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700">fonte indisponível</span>
                    )}
                    {wmsEnabled && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-800">WMS · imagem</span>}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">{row.layerName ?? row.serviceType}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {vectorEnabled ? "vetor completo do recorte remoto" : wmsEnabled ? "seletor WMS direto" : row.geometryMode === "tabular" ? "tabela sem geometria" : "sem consulta"}
                    {status?.message ? ` · ${status.message}` : ""}
                  </p>
                </div>
              </div>
              {row.geometryMode === "tabular" && (
                <button
                  type="button"
                  className="mt-2 rounded border px-2 py-1 text-[10px] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!tableEnabled}
                  onClick={() => consultTable(row.id)}
                >
                  {vectorChecked ? "Remover tabela" : "Consultar tabela"}
                </button>
              )}
              {vectorChecked && row.geometryMode === "tabular" && tableResult && (
                <div className="mt-2 rounded bg-slate-50 p-2 text-[10px] dark:bg-slate-900/40" data-testid={`official-table-${row.id}`}>
                  <div className="font-medium">Registros tabulares em texto — sem coordenadas e sem interseção espacial</div>
                  <div className="mt-1 text-muted-foreground">
                    {tableResult.rows.length ? `${tableResult.rows.length} registro(s)` : "Nenhum registro correspondente"}
                    {tableResult.matched !== undefined && tableResult.matched !== null ? ` de ${tableResult.matched} encontrado(s)` : ""}
                    {tableResult.complete === false ? " · resposta incompleta" : ""}
                  </div>
                  {tableResult.rows.length > 0 && (
                    <ul className="mt-1 space-y-1">
                      {tableResult.rows.map((tableRow, index) => (
                        <li key={`${row.id}-table-${index}`} className="border-t pt-1 first:border-t-0">
                          {Object.entries(tableRow).map(([key, value]) => <div key={key}><strong>{key}: </strong>{value}</div>)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <details className="mt-1 text-[10px] text-muted-foreground">
                <summary className="cursor-pointer">Fonte, consulta e metadados</summary>
                <div className="space-y-0.5 pt-1">
                  <div>Conexão: {row.connectionMode === "remote" ? "DIRETA catalogada; disponibilidade depende da consulta" : "INDISPONÍVEL; nenhuma geometria antiga será desenhada"}</div>
                  <div>Endpoint catalogado: {row.serviceUrl ?? "não fornecido"}</div>
                  <div>Edição do catálogo: {row.version}</div>
                  <div>CRS do catálogo: {row.crs}</div>
                  <div>Licença: {row.license}</div>
                  <div>Campos confirmados: {row.attributeNames.length ? row.attributeNames.join(", ") : "nenhum"}</div>
                  <div>Estado da consulta: {status?.status ?? "não consultada"}</div>
                  {status?.message && <div>Mensagem/erro: {status.message}</div>}
                  {status?.provenance && (
                    <>
                      <div>Edição recebida: {provenanceValue(status.provenance, "edition")}</div>
                      <div>Data da consulta: {provenanceValue(status.provenance, "queriedAt")}</div>
                      <div>Endpoint respondente: {provenanceValue(status.provenance, "endpoint")}</div>
                      <div>Geometria completa: {provenanceValue(status.provenance, "geometryComplete")}</div>
                      <div>Cache TEMPORÁRIO: {provenanceValue(status.provenance, "cacheHit")} · expira {provenanceValue(status.provenance, "cacheExpiresAt")}</div>
                    </>
                  )}
                  <div>Limites declarados: timeout 10 s · resposta 4 MiB · cache TEMPORÁRIO 5 min · total 16 MiB</div>
                  <div className="text-amber-700">{row.restriction}</div>
                </div>
              </details>
              {wmsEnabled && wmsChecked && row.wms && (
                <div className="mt-2 border-t pt-2 text-[10px]">
                  <div className="mb-1 text-muted-foreground">Legenda WMS — imagem, sem dados vetoriais</div>
                  <img src={legendUrl(row.wms)} alt={`Legenda WMS de ${row.institution}`} className="max-h-24 max-w-full" loading="lazy" />
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
