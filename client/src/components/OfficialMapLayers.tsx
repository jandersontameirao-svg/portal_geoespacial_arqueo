import { useEffect, useMemo, useRef, useState } from "react";
import { skipToken } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useMap, useMapEvents, WMSTileLayer } from "react-leaflet";
import type { Feature, FeatureCollection } from "geojson";
import L from "leaflet";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "../../../server/routers";
import {
  OFFICIAL_LAYERS_EVENT,
  OFFICIAL_STATUS_EVENT,
  OFFICIAL_SELECTION_REQUEST_EVENT,
  type OfficialProvenance,
  type OfficialRecord,
  type OfficialSelection,
  type OfficialStatusDetail,
  type OfficialTableRow,
} from "./OfficialBasesPanel";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type OfficialQuery = RouterOutputs["official"]["query"];
type OfficialQueryOk = Extract<OfficialQuery, { status: "ok" }>;
type QueryWithOptionalFields = OfficialQueryOk & {
  rows?: OfficialTableRow[];
  provenance?: OfficialProvenance;
  complete?: boolean;
  matched?: number | null;
};

interface OfficialBounds { west: number; south: number; east: number; north: number; }

function ViewportWatcher({ onBounds }: { onBounds: (bounds: OfficialBounds) => void }) {
  const map = useMap();
  const update = () => {
    const bounds = map.getBounds();
    onBounds({ west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() });
  };
  useMapEvents({ moveend: update, zoomend: update });
  useEffect(() => { update(); }, [map]);
  return null;
}

function popupFromFeature(feature: Feature): HTMLElement {
  const root = document.createElement("div");
  root.className = "official-feature-popup";
  const properties = feature.properties && typeof feature.properties === "object" ? feature.properties : {};
  for (const [key, raw] of Object.entries(properties)) {
    const row = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = `${key}: `;
    const value = document.createElement("span");
    value.textContent = typeof raw === "string" ? raw : JSON.stringify(raw) ?? "";
    row.append(label, value);
    root.appendChild(row);
  }
  if (!root.childElementCount) root.textContent = "Feição oficial sem atributos confirmados.";
  return root;
}

function reportStatus(detail: OfficialStatusDetail) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<OfficialStatusDetail>(OFFICIAL_STATUS_EVENT, { detail }));
}

function queryRows(data: OfficialQuery | undefined): OfficialTableRow[] | undefined {
  if (!data || data.status !== "ok") return undefined;
  return (data as QueryWithOptionalFields).rows;
}

function queryProvenance(data: OfficialQuery | undefined): OfficialProvenance | undefined {
  if (!data || data.status !== "ok") return undefined;
  return (data as QueryWithOptionalFields).provenance;
}

function queryComplete(data: OfficialQuery | undefined): boolean | undefined {
  if (!data || data.status !== "ok") return undefined;
  return (data as QueryWithOptionalFields).complete;
}

function queryMatched(data: OfficialQuery | undefined): number | null | undefined {
  if (!data || data.status !== "ok") return undefined;
  return (data as QueryWithOptionalFields).matched;
}

function provenanceField(provenance: OfficialProvenance | undefined, key: string): unknown {
  if (!provenance || typeof provenance !== "object") return undefined;
  return (provenance as unknown as Record<string, unknown>)[key];
}

function statusMessage(data: OfficialQueryOk, featureCount: number, rows: OfficialTableRow[] | undefined, tabular: boolean): string {
  const provenance = queryProvenance(data);
  const cache = provenanceField(provenance, "cacheHit");
  const cacheLabel = cache === true ? "cache TEMPORÁRIO" : cache === false ? "fonte direta" : "consulta direta";
  if (tabular) return `${rows?.length ?? 0} registro(s) tabular(es) · ${cacheLabel}`;
  return `${featureCount} feição(ões) · geometrias completas · ${cacheLabel}`;
}

function OfficialVectorOverlay({ record, bounds, query, projectId }: { record: OfficialRecord; bounds: OfficialBounds | null; query: string; projectId?: number }) {
  const map = useMap();
  const layerRef = useRef<L.GeoJSON | null>(null);
  const activeRequestKeyRef = useRef<string>("");
  const queryEnabled = Boolean(bounds) && record.connectionMode === "remote" && record.queryable;
  const requestKey = JSON.stringify({
    projectId: projectId ?? null,
    institutionId: record.id,
    geometryMode: record.geometryMode,
    queryable: record.queryable,
    connectionMode: record.connectionMode,
    bounds,
    query: query.trim(),
  });
  const input = queryEnabled && bounds
    ? { institutionId: record.id, bbox: bounds, query: query.trim() || undefined, limit: 200, ...(projectId ? { projectId } : {}) }
    : skipToken;
  const result = trpc.official.query.useQuery(input, {
    staleTime: record.remote?.cacheAllowed ? 5 * 60 * 1000 : 0,
    gcTime: record.remote?.cacheAllowed ? 5 * 60 * 1000 : 0,
    retry: false,
  });

  const removeLayer = () => {
    if (layerRef.current) {
      layerRef.current.removeFrom(map);
      layerRef.current = null;
    }
  };

  useEffect(() => {
    if (!record.queryable || record.connectionMode !== "remote") {
      removeLayer();
      reportStatus({ id: record.id, status: "not_queryable", projectId, message: "Fonte indisponível; nenhuma geometria antiga será desenhada." });
    }
  }, [record.id, record.queryable, record.connectionMode, projectId]);

  useEffect(() => {
    if (activeRequestKeyRef.current === requestKey) return;
    activeRequestKeyRef.current = requestKey;
    removeLayer();
  }, [requestKey]);

  useEffect(() => {
    if (!queryEnabled || !bounds) {
      removeLayer();
      return;
    }
    if (result.isFetching) {
      removeLayer();
      return;
    }
    if (result.error) {
      removeLayer();
      reportStatus({ id: record.id, status: "error", projectId, message: result.error.message ?? "falha na consulta remota" });
      return;
    }
    const data = result.data;
    if (!data) return;
    if (data.status === "error" || data.status === "not_queryable") {
      removeLayer();
      reportStatus({ id: record.id, status: data.status, projectId, message: data.error });
      return;
    }
    const rows = queryRows(data);
    const provenance = queryProvenance(data);
    if (provenance && provenanceField(provenance, "geometryComplete") !== undefined && provenanceField(provenance, "geometryComplete") !== true && record.geometryMode === "vector") {
      removeLayer();
      reportStatus({ id: record.id, status: "error", projectId, message: "A fonte não confirmou geometrias completas; nada foi desenhado.", provenance });
      return;
    }
    if (record.geometryMode === "vector" && queryComplete(data) !== true) {
      removeLayer();
      reportStatus({ id: record.id, status: "error", projectId, message: "Consulta remota incompleta ou truncada; reduza a extensão ou filtre a fonte. Nenhuma feição parcial foi desenhada.", provenance, complete: false, matched: queryMatched(data) });
      return;
    }
    reportStatus({
      id: record.id,
      status: "ok",
      projectId,
      message: statusMessage(data, data.geojson?.features.length ?? 0, rows, record.geometryMode === "tabular"),
      rows,
      provenance,
      complete: queryComplete(data),
      matched: queryMatched(data),
    });
    if (record.geometryMode !== "vector" || !data.geojson) {
      removeLayer();
      return;
    }
    const collection = data.geojson as unknown as FeatureCollection;
    removeLayer();
    try {
      layerRef.current = L.geoJSON(collection, {
        style: { color: "#c2410c", weight: 1, fillColor: "#fb923c", fillOpacity: 0.18 },
        pointToLayer: (_feature, latlng) => L.circleMarker(latlng, { radius: 5, color: "#c2410c", fillColor: "#fb923c", fillOpacity: 0.8 }),
        onEachFeature: (feature, featureLayer) => featureLayer.bindPopup(popupFromFeature(feature)),
      }).addTo(map);
    } catch {
      removeLayer();
      reportStatus({ id: record.id, status: "error", projectId, message: "Geometria oficial inválida para o mapa; nada foi desenhado." });
    }
  }, [map, record, bounds, queryEnabled, query, projectId, requestKey, result.data, result.dataUpdatedAt, result.error, result.isFetching]);

  useEffect(() => {
    if (result.isFetching && queryEnabled) reportStatus({ id: record.id, status: "loading", projectId, message: "consultando conexão DIRETA do viewport…" });
  }, [record.id, projectId, queryEnabled, result.isFetching]);

  useEffect(() => () => {
    removeLayer();
    reportStatus({ id: record.id, status: "removed", projectId });
  }, [map, record.id, projectId]);

  return null;
}

export default function OfficialMapLayers({ projectId }: { projectId?: number }) {
  const [selection, setSelection] = useState<OfficialSelection>({ vectorIds: [], wmsIds: [], query: "" });
  const [bounds, setBounds] = useState<OfficialBounds | null>(null);

  useEffect(() => {
    const onSelection = (event: Event) => {
      const detail = (event as CustomEvent<OfficialSelection>).detail;
      if (!detail || !Array.isArray(detail.vectorIds) || !Array.isArray(detail.wmsIds) || typeof detail.query !== "string") return;
      setSelection({ vectorIds: detail.vectorIds.filter(id => typeof id === "string"), wmsIds: detail.wmsIds.filter(id => typeof id === "string"), query: detail.query.slice(0, 120) });
    };
    window.addEventListener(OFFICIAL_LAYERS_EVENT, onSelection);
    window.dispatchEvent(new Event(OFFICIAL_SELECTION_REQUEST_EVENT));
    return () => window.removeEventListener(OFFICIAL_LAYERS_EVENT, onSelection);
  }, []);

  const catalogResult = trpc.official.catalog.useQuery(undefined, { retry: false });
  // Only typed catalog responses supply endpoints; events can select IDs, never sources.
  const records = useMemo(() => catalogResult.isError ? [] : catalogResult.data ?? [], [catalogResult.data, catalogResult.isError]);

  const selectedVector = useMemo(
    () => records.filter(record => selection.vectorIds.includes(record.id) && record.connectionMode === "remote" && record.queryable),
    [records, selection.vectorIds],
  );
  const selectedWms = useMemo(
    () => records.filter(record => {
      if (!selection.wmsIds.includes(record.id) || !record.wms) return false;
      try { const url = new URL(record.wms.url); return url.protocol === "https:" && !url.username && !url.password; }
      catch { return false; }
    }),
    [records, selection.wmsIds],
  );

  return (
    <>
      <ViewportWatcher onBounds={setBounds} />
      {selectedVector.map(record => (
        <OfficialVectorOverlay
          key={`${record.id}-${projectId ?? "global"}`}
          record={record}
          bounds={bounds}
          query={selection.query}
          projectId={projectId}
        />
      ))}
      {selectedWms.map(record => record.wms && (
        <WMSTileLayer
          key={`${record.id}-${projectId ?? "global"}`}
          url={record.wms.url}
          layers={record.wms.layer}
          version={record.wms.version}
          format="image/png"
          transparent
          attribution={(record.attribution ?? record.institution).replace(/[&<>"']/g, value => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value]!)}
          eventHandlers={{
            loading: () => reportStatus({ id: record.id, status: "loading", projectId, message: "carregando imagem WMS direta…" }),
            load: () => reportStatus({ id: record.id, status: "ok", projectId, message: "imagem WMS carregada; não alimenta análise espacial" }),
            tileerror: () => reportStatus({ id: record.id, status: "error", projectId, message: "falha ao carregar tile WMS" }),
          }}
        />
      ))}
    </>
  );
}
