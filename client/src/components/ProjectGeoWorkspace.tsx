import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FeatureGroup, GeoJSON, MapContainer, Marker, Pane as MapPane, Polygon, Polyline, Popup, TileLayer, useMap, WMSTileLayer } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import LeafletDrawControl from "@/components/LeafletDrawControl";
import RasterIngestionPanel from "@/components/RasterIngestionPanel";
import RasterRealPixelExport from "@/components/RasterRealPixelExport";
import LayersTree from "@/components/LayersTree";
import ThematicLayerTree, { moveThematicItem, type ThematicLayerItem } from "@/components/ThematicLayerTree";
import MapPrintPreview from "@/components/MapPrintPreview";
import { captureMapSnapshot } from "@/lib/captureMapSnapshot";
import { assertIndeMapPrintReady } from "@/lib/indeMapPrintGuard";
import { trpc } from "@/lib/trpc";
import { DEFAULT_BASEMAP, SELECTABLE_BASEMAPS } from "@/lib/basemaps";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Clock, Download, Layers, Loader2, Pencil, Printer, Ruler, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { storedPolygonToGeoJSON } from "../../../shared/geometry-coordinates";
import { closeLeafletPolygonRings } from "@/lib/leaflet-geometry-coordinates";
import { isWorkspaceFeatureCollection, standaloneWorkspaceGeometry, workspaceLayerVisible } from "../../../shared/workspaceHierarchy";
import { escapeAttribution, ibgeAttribution, isIbgeVariant, type InstitutionalPublishedLayer } from "@/lib/institutionalLayers";

type CoordinateGeometry = Exclude<Geometry, { type: "GeometryCollection" }>;

type StoredGeometry = {
  id: number;
  type: "marker" | "polyline" | "polygon";
  name: string;
  description: string | null;
  coordinates: string;
  color: string;
  visible: number;
  opacity: number;
  layerId?: number | null;
};

type ProjectVectorLayer = {
  id: number;
  name: string;
  layerData: FeatureCollection<Geometry>;
  defaultStyle?: { color?: string; weight?: number; fillOpacity?: number } | null;
  isVisible: boolean | number;
  metadata?: { kind?: string; sourceFileName?: string; logicalLayer?: string; featureCount?: number; presentation?: { renderOrder?: number } } | null;
};

type PublishedOgcLayer = InstitutionalPublishedLayer;

type Operation = "buffer" | "intersection" | "union" | "clip" | "overlay" | "grid" | "area";

const operationLabels: Record<Operation, string> = {
  buffer: "Buffer / zona de influência",
  intersection: "Interseção",
  union: "União",
  clip: "Recorte",
  overlay: "Sobreposição",
  grid: "Malha de pontos",
  area: "Cálculo de área (ADA)",
};

function parseCoordinates(geometry: StoredGeometry): any {
  return JSON.parse(geometry.coordinates);
}

function toFeature(geometry: StoredGeometry): Feature<CoordinateGeometry> {
  const coords = parseCoordinates(geometry);
  if (geometry.type === "marker") {
    return { type: "Feature", properties: { geometryId: geometry.id, name: geometry.name }, geometry: { type: "Point", coordinates: [coords[1], coords[0]] } };
  }
  if (geometry.type === "polyline") {
    return { type: "Feature", properties: { geometryId: geometry.id, name: geometry.name }, geometry: { type: "LineString", coordinates: coords.map((coord: number[]) => [coord[1], coord[0]]) } };
  }
  return {
    type: "Feature",
    properties: { geometryId: geometry.id, name: geometry.name },
    geometry: storedPolygonToGeoJSON(coords) as CoordinateGeometry,
  };
}

function coordinatesFromLayer(layer: any, type: StoredGeometry["type"]): string {
  if (type === "marker") {
    const point = layer.getLatLng();
    return JSON.stringify([point.lat, point.lng]);
  }
  if (type === "polyline") {
    const values = layer.getLatLngs() as L.LatLng[];
    return JSON.stringify(values.map((point) => [point.lat, point.lng]));
  }

  const geojson = layer.toGeoJSON().geometry;
  if (geojson.type === "Polygon") {
    const stored = geojson.coordinates.map((ring: number[][]) => ring.map(([lng, lat, ...rest]) => [lat, lng, ...rest]));
    return JSON.stringify(closeLeafletPolygonRings(stored));
  }
  if (geojson.type === "MultiPolygon") {
    const stored = geojson.coordinates.map((polygon: number[][][]) => polygon.map((ring) => ring.map(([lng, lat, ...rest]) => [lat, lng, ...rest])));
    return JSON.stringify(closeLeafletPolygonRings(stored));
  }
  throw new Error("O desenho de polígono retornou uma geometria não suportada.");
}

function calculateCenter(geometries: StoredGeometry[]): [number, number] {
  const first = geometries[0];
  if (!first) return [-15.7801, -47.9292];
  const coords = parseCoordinates(first);
  if (first.type === "marker") return coords;
  const firstPosition = (value: unknown): [number, number] | undefined => {
    if (!Array.isArray(value) || value.length === 0) return undefined;
    if (typeof value[0] === "number" && typeof value[1] === "number") return [value[0], value[1]];
    return firstPosition(value[0]);
  };
  return firstPosition(coords) || [-15.7801, -47.9292];
}

function thematicPaneName(layerId: string) {
  return `thematic-${layerId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function escapePopupText(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function InvalidateMapOnResize() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const invalidate = () => map.invalidateSize({ pan: false, debounceMoveend: true });
    const timeout = window.setTimeout(invalidate, 0);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(invalidate);
    observer?.observe(container);
    return () => { window.clearTimeout(timeout); observer?.disconnect(); };
  }, [map]);
  return null;
}

function SidePanel({ title, children, defaultOpen = true }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="rounded-xl border bg-card text-card-foreground shadow-sm">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-base font-semibold [&::-webkit-details-marker]:hidden">{title}</summary>
      <div className="px-4 pb-4 pt-0">{children}</div>
    </details>
  );
}

function ScreenScaleIndicator() {
  const map = useMap();
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const update = () => {
      const { x, y } = map.getSize().divideBy(2);
      const metres = map.distance(map.containerPointToLatLng([x - 50, y]), map.containerPointToLatLng([x + 50, y]));
      // Polegada CSS nominal = 96 px. Estimativa de tela, distinta da escala
      // física do PDF calculada a partir do quadro em milímetros.
      setScale(Math.round(metres / ((100 * 0.0254) / 96)));
    };
    update();
    map.on("moveend", update);
    map.on("resize", update);
    return () => { map.off("moveend", update); map.off("resize", update); };
  }, [map]);
  if (scale <= 0) return null;
  return <div className="pointer-events-none absolute rounded bg-white/90 px-2 py-1 text-xs font-semibold text-slate-900 shadow" style={{ left: 12, bottom: 16, zIndex: 850 }} title="Escala aproximada no centro do mapa, com referência de 96 pixels por polegada">
    Escala aprox. 1:{scale.toLocaleString("pt-BR")}
  </div>;
}

export default function ProjectGeoWorkspace({ projectId, canEdit, projectName, clientName }: { projectId: number; canEdit: boolean; projectName?: string; clientName?: string }) {
  const utils = trpc.useUtils();
  const updateStyle = trpc.gisAnalysis.updateVectorStyle.useMutation({
    onSuccess: () => { void utils.gisAnalysis.list.invalidate({ projectId }); toast.success("Simbologia salva"); },
    onError: (error) => toast.error(error.message || "Não foi possível salvar a simbologia"),
  });
  const mapRef = useRef<L.Map | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const { data: rawGeometries, isLoading: geometriesLoading } = trpc.geometries.list.useQuery({ projectId });
  const { data: rawAnalysisLayers, isLoading: layersLoading } = trpc.gisAnalysis.list.useQuery({ projectId });
  const { data: rawRasterLayers, isLoading: rastersLoading } = trpc.raster.listForMap.useQuery({ projectId });
  const { data: historicalImagery = [] } = trpc.raster.historicalCatalog.useQuery({ projectId });
  const { data: rawOgcLayers = [] } = trpc.ogcCatalog.listPublished.useQuery();
  const hierarchy = trpc.layers.list.useQuery({ projectId });
  const hierarchyLayers = hierarchy.data || [];
  const presentedLayers = useMemo(() => (rawAnalysisLayers || []).map((layer) => ({
    ...layer, isVisible: workspaceLayerVisible(layer.id, Boolean(layer.isVisible), hierarchyLayers),
  })), [rawAnalysisLayers, hierarchy.data]);
  const rasterLayers = useMemo(() => (rawRasterLayers || []).map((layer) => ({
    ...layer, isVisible: workspaceLayerVisible(layer.id, Boolean(layer.isVisible), hierarchyLayers),
  })), [rawRasterLayers, hierarchy.data]);
  const geometries = useMemo(() => ((rawGeometries || []) as StoredGeometry[])
    .filter((geometry) => standaloneWorkspaceGeometry(geometry, presentedLayers))
    .map((geometry) => ({ ...geometry, visible: geometry.visible === 1 && (geometry.layerId == null || workspaceLayerVisible(geometry.layerId, true, hierarchyLayers)) ? 1 : 0 })),
  [rawGeometries, presentedLayers, hierarchy.data]);
  const setPersonalLayerVisibility = trpc.layers.setVisibility.useMutation({
    onSuccess: () => utils.layers.list.invalidate({ projectId }),
    onError: (error) => toast.error(error.message || "Não foi possível atualizar a visibilidade pessoal"),
  });
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [operation, setOperation] = useState<Operation>("buffer");
  const [bufferMeters, setBufferMeters] = useState("1000");
  const [gridSpacing, setGridSpacing] = useState("100");
  const [gridCode, setGridCode] = useState("MALHA");
  const [gridRotation, setGridRotation] = useState("0");
  const [gridPattern, setGridPattern] = useState("quadrada");
  const [pending, setPending] = useState<{ type: StoredGeometry["type"]; coordinates: string } | null>(null);
  const [editableLayers, setEditableLayers] = useState<L.FeatureGroup | null>(null);
  const pendingLayerRef = useRef<L.Layer | null>(null);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [basemapId, setBasemapId] = useState(DEFAULT_BASEMAP.id);
  const [selectedVectorLayerIds, setSelectedVectorLayerIds] = useState<number[]>([]);
  const [visibleRasterIds, setVisibleRasterIds] = useState<number[]>([]);
  const [visibleOgcLayerIds, setVisibleOgcLayerIds] = useState<string[]>([]);
  const [thematicOrder, setThematicOrder] = useState<string[]>([]);
  const [rasterOpacity, setRasterOpacity] = useState(72);

  const selectedGeometries = useMemo(
    () => geometries.filter((geometry) => selectedIds.includes(geometry.id)),
    [geometries, selectedIds],
  );
  const projectVectorLayers = useMemo<ProjectVectorLayer[]>(() => presentedLayers.flatMap((layer: any) => {
    if (layer.isGroup || layer.layerType !== "vector" || layer.metadata?.kind === "gis-analysis-result" || !isWorkspaceFeatureCollection(layer.layerData)) return [];
    return [{
      id: layer.id as number,
      name: layer.name as string,
      layerData: layer.layerData as FeatureCollection<Geometry>,
      defaultStyle: (layer.defaultStyle || null) as ProjectVectorLayer["defaultStyle"],
      isVisible: Boolean(layer.isVisible),
      metadata: (layer.metadata || null) as ProjectVectorLayer["metadata"],
    }];
  }), [presentedLayers]);
  const selectedVectorFeatures = useMemo(() => projectVectorLayers
    .filter((layer) => selectedVectorLayerIds.includes(layer.id))
    .flatMap((layer) => layer.layerData.features
      .filter((feature) => feature.geometry?.type !== "GeometryCollection")
      .map((feature) => ({ ...feature, properties: { ...(feature.properties || {}), sourceLayerId: layer.id, sourceLayerName: layer.name } }))),
  [projectVectorLayers, selectedVectorLayerIds]);
  const selectedInputs = useMemo(
    () => [...selectedGeometries.map(toFeature), ...selectedVectorFeatures] as Feature<CoordinateGeometry>[],
    [selectedGeometries, selectedVectorFeatures],
  );
  const activeBasemap = useMemo(
    () => SELECTABLE_BASEMAPS.find((basemap) => basemap.id === basemapId) || DEFAULT_BASEMAP,
    [basemapId],
  );
  const center = useMemo(() => calculateCenter(geometries), [geometries]);
  const analysisLayers = presentedLayers.filter((layer: any) => !layer.isGroup && layer.metadata?.kind === "gis-analysis-result" && layer.layerData);
  const publishedOgcLayers = rawOgcLayers as PublishedOgcLayer[];
  const publishedWfsLayers = useMemo(() => publishedOgcLayers.filter((layer) => layer.selected?.serviceType === "wfs" && !isIbgeVariant(layer.selected)), [publishedOgcLayers]);
  const hasIbgeWfs = publishedOgcLayers.some(layer => layer.selected?.serviceType === "wfs" && isIbgeVariant(layer.selected));
  const thematicItems = useMemo<ThematicLayerItem[]>(() => {
    const drawings = geometries.map((geometry) => ({
      id: `drawing-${geometry.id}`,
      group: "own" as const,
      kind: "drawing" as const,
      name: geometry.name,
      description: geometry.type === "marker" ? "Feição própria: ponto" : geometry.type === "polyline" ? "Feição própria: linha" : "Feição própria: área",
      visible: geometry.visible === 1,
      selectedForAnalysis: selectedIds.includes(geometry.id),
      analyzable: true,
      color: geometry.color,
      status: "local" as const,
    }));
    const vectors = projectVectorLayers.map((layer) => ({
      id: `vector-${layer.id}`,
      group: "own" as const,
      kind: "vector" as const,
      name: layer.name,
      description: `${layer.metadata?.featureCount || layer.layerData.features.length} feição(ões) ${layer.metadata?.kind === "wfs-import" ? `importadas de WFS ${layer.metadata?.logicalLayer || "publicado"}` : "importadas do arquivo preservado"}`,
      visible: Boolean(layer.isVisible),
      selectedForAnalysis: selectedVectorLayerIds.includes(layer.id),
      analyzable: true,
      color: layer.defaultStyle?.color || "#2563eb",
      status: "local" as const,
      sourceLabel: layer.metadata?.sourceFileName || layer.metadata?.logicalLayer,
    }));
    const rasters = rasterLayers.map((layer: any) => ({
      id: `raster-${layer.id}`,
      group: "own" as const,
      kind: "raster" as const,
      name: layer.name,
      description: `COG ${layer.crs}; NoData ${layer.nodata}; zoom ${layer.minZoom}–${layer.maxZoom}`,
      visible: visibleRasterIds.includes(layer.id),
      color: "#9333ea",
      status: "local" as const,
    }));
    const ogc = publishedOgcLayers.map((layer) => ({
      id: `ogc-${layer.logicalLayer}`,
      group: "base" as const,
      kind: layer.selected?.serviceType || "wms",
      name: layer.logicalLayer,
      description: layer.selected ? `${layer.selected.serviceType.toUpperCase()} publicado${layer.isFallback ? "; fallback ativo" : ""}` : layer.reason || "Sem variante saudável",
      visible: visibleOgcLayerIds.includes(layer.logicalLayer),
      analyzable: false,
      color: layer.selected?.serviceType === "wfs" ? "#0f766e" : "#b45309",
      status: layer.selected ? (layer.isFallback ? "degraded" as const : "healthy" as const) : "unavailable" as const,
      sourceLabel: layer.selected?.endpoint,
    }));
    const results = analysisLayers.map((layer: any) => ({
      id: `result-${layer.id}`,
      group: "result" as const,
      kind: "analysis" as const,
      name: layer.name,
      description: `${layer.metadata?.provenance?.operation || "Análise"} · ${Number(layer.metadata?.areaSquareMeters || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} m²`,
      visible: layer.isVisible !== false,
      color: layer.defaultStyle?.color || "#1d4ed8",
      status: "local" as const,
    }));
    return [...drawings, ...vectors, ...rasters, ...ogc, ...results];
  }, [analysisLayers, geometries, projectVectorLayers, publishedOgcLayers, rasterLayers, selectedIds, selectedVectorLayerIds, visibleOgcLayerIds, visibleRasterIds]);
  const captureCurrentMap = useCallback(async (signal?: AbortSignal) => {
    if (!mapRef.current) throw new Error("Aguarde o mapa do projeto carregar antes de imprimir.");
    assertIndeMapPrintReady(mapRef.current);
    const snapshot = await captureMapSnapshot(mapRef.current, { signal });
    return { ...snapshot, legend: thematicItems.filter(item => item.visible).map(item => ({ label: item.name, color: item.color })) };
  }, [thematicItems]);
  const visibleOgcLayers = useMemo(() => publishedOgcLayers.filter((layer) => layer.selected?.serviceType === "wms" && visibleOgcLayerIds.includes(layer.logicalLayer)), [publishedOgcLayers, visibleOgcLayerIds]);
  useEffect(() => {
    setVisibleRasterIds((current) => {
      const next = rasterLayers.filter((layer) => layer.isVisible).map((layer) => layer.id);
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
  }, [rasterLayers]);
  useEffect(() => {
    setThematicOrder((current) => {
      const availableIds = thematicItems.map((item) => item.id);
      const retained = current.filter((id) => availableIds.includes(id));
      const additions = availableIds.filter((id) => !retained.includes(id));
      const next = [...retained, ...additions];
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
  }, [thematicItems]);
  const thematicZIndex = (layerId: string) => {
    const position = thematicOrder.indexOf(layerId);
    const normalizedPosition = position < 0 ? thematicOrder.length : position;
    return 700 - normalizedPosition;
  };
  const drawOptions = useMemo<L.Control.DrawOptions>(() => ({ rectangle: false, circle: false, circlemarker: false, marker: {}, polyline: {}, polygon: {} }), []);
  const exportBounds = rasterLayers[0]?.bounds || { north: center[0] + 0.12, south: center[0] - 0.12, east: center[1] + 0.12, west: center[1] - 0.12 };

  const invalidate = async () => {
    await Promise.all([
      utils.geometries.list.invalidate({ projectId }),
      utils.gisAnalysis.list.invalidate({ projectId }),
      utils.raster.listForMap.invalidate({ projectId }),
      utils.layers.list.invalidate({ projectId }),
    ]);
  };

  const createGeometry = trpc.geometries.create.useMutation({
    onSuccess: async () => {
      if (pendingLayerRef.current && editableLayers) editableLayers.removeLayer(pendingLayerRef.current);
      pendingLayerRef.current = null;
      await invalidate();
      setPending(null);
      setNewName("");
      setNewDescription("");
      toast.success("Feição adicionada ao projeto");
    },
    onError: (error) => toast.error(error.message),
  });
  const updateGeometry = trpc.geometries.update.useMutation({
    onSuccess: invalidate,
    onError: (error) => toast.error(error.message),
  });
  const updateGeometryVisibility = trpc.geometries.updateVisibility.useMutation({
    onSuccess: invalidate,
    onError: (error) => toast.error(error.message),
  });
  const deleteGeometry = trpc.geometries.delete.useMutation({
    onSuccess: invalidate,
    onError: (error) => toast.error(error.message),
  });
  const runAnalysis = trpc.gisAnalysis.execute.useMutation({
    onSuccess: async (result) => {
      await invalidate();
      toast.success(`${result.name}: ${result.result.output.features.length} feição(ões) persistida(s)`);
    },
    onError: (error) => toast.error(error.message),
  });
  const updateVectorVisibility = trpc.gisAnalysis.updateVectorVisibility.useMutation({
    onSuccess: invalidate,
    onError: (error) => toast.error(error.message),
  });
  const updateLayerPresentation = trpc.gisAnalysis.updateLayerPresentation.useMutation({
    onSuccess: invalidate,
    onError: (error) => toast.error(error.message),
  });
  const exportVectorLayer = trpc.gisAnalysis.exportVectorLayer.useMutation({
    onSuccess: ({ data, filename }) => {
      const url = URL.createObjectURL(new Blob([data], { type: "application/geo+json" }));
      const link = Object.assign(document.createElement("a"), { href: url, download: filename });
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Camada GeoJSON exportada");
    },
    onError: (error) => toast.error(error.message),
  });
  const importWfsLayer = trpc.ogcCatalog.importWfsToProject.useMutation({
    onSuccess: async (result) => {
      await invalidate();
      toast.success(`WFS importado: ${result.featureCount} feição(ões) em ${result.pagesFetched} página(s)${result.truncated ? " (limite atingido)" : ""}`);
    },
    onError: (error) => toast.error(error.message),
  });

  const toggleSelection = (id: number, checked: boolean) => {
    setSelectedIds((current) => checked ? [...current, id] : current.filter((value) => value !== id));
  };
  const toggleVectorSelection = (id: number, checked: boolean) => {
    setSelectedVectorLayerIds((current) => checked ? Array.from(new Set([...current, id])) : current.filter((value) => value !== id));
  };

  const savePending = () => {
    if (!pending || !newName.trim()) {
      toast.error("Informe o nome da feição");
      return;
    }
    createGeometry.mutate({
      projectId,
      type: pending.type,
      name: newName.trim(),
      description: newDescription.trim() || undefined,
      coordinates: pending.coordinates,
      color: "#2563eb",
    });
  };

  const executeOperation = () => {
    if (selectedInputs.length === 0) {
      toast.error("Selecione ao menos uma feição ou camada vetorial do projeto");
      return;
    }
    if (["intersection", "union", "clip", "overlay"].includes(operation) && selectedInputs.length < 2) {
      toast.error("Selecione ao menos duas áreas para esta operação");
      return;
    }
    if (operation === "grid" && selectedInputs.length !== 1) {
      toast.error("A malha de pontos exige uma única área de recorte");
      return;
    }
    runAnalysis.mutate({
      projectId,
      operation,
      inputs: selectedInputs,
      bufferMeters: operation === "buffer" ? Number(bufferMeters) : undefined,
      grid: operation === "grid" ? {
        spacingMeters: Number(gridSpacing),
        originCode: gridCode.trim() || undefined,
        rotationDegrees: Number(gridRotation),
        pattern: gridPattern === "triangular" ? "triangular" : "quadrada",
      } : undefined,
      sourceLabels: [...selectedGeometries.map((geometry) => geometry.name), ...projectVectorLayers.filter((layer) => selectedVectorLayerIds.includes(layer.id)).map((layer) => layer.name)],
    });
  };

  const toggleThematicVisibility = (item: ThematicLayerItem, visible: boolean) => {
    const [kind, rawId] = item.id.split(/-(.+)/);
    if (kind === "drawing") {
      updateGeometryVisibility.mutate({ id: Number(rawId), visible: visible ? 1 : 0 });
      return;
    }
    if (kind === "vector") {
      setPersonalLayerVisibility.mutate({ id: Number(rawId), visible });
      return;
    }
    if (kind === "raster" || kind === "result") {
      const layerId = Number(rawId);
      setPersonalLayerVisibility.mutate({ id: layerId, visible });
      return;
    }
    if (kind === "ogc") {
      const selected = publishedOgcLayers.find(layer => layer.logicalLayer === rawId)?.selected;
      if (selected?.serviceType === "wfs") {
        toast.info(isIbgeVariant(selected) ? "Consulte o recorte IBGE no painel GeoServer do globo 2D; a consulta é somente em memória." : "WFS não é uma imagem WMS. Use a importação autorizada antes de visualizar.");
        return;
      }
      setVisibleOgcLayerIds((current) => visible ? Array.from(new Set([...current, rawId])) : current.filter((id) => id !== rawId));
    }
  };

  const toggleThematicAnalysis = (item: ThematicLayerItem, selected: boolean) => {
    const [kind, rawId] = item.id.split(/-(.+)/);
    if (kind === "drawing") toggleSelection(Number(rawId), selected);
    if (kind === "vector") toggleVectorSelection(Number(rawId), selected);
  };

  const moveThematicLayer = (item: ThematicLayerItem, direction: "up" | "down") => {
    setThematicOrder((current) => moveThematicItem(current, item.id, direction));
  };

  const renderGeometry = (geometry: StoredGeometry) => {
    if (geometry.visible !== 1) return null;
    const coords = parseCoordinates(geometry);
    const pane = thematicPaneName(`drawing-${geometry.id}`);
    const style = { color: geometry.color || "#2563eb", opacity: geometry.opacity / 100, fillOpacity: Math.min(0.45, geometry.opacity / 100), pane };
    const ref = (layer: any) => {
      if (layer) {
        (layer as any).options.geometryId = geometry.id;
        (layer as any).options.geometryType = geometry.type;
      }
    };
    if (geometry.type === "marker") {
      return <Marker key={geometry.id} position={coords} pane={pane} ref={ref}><Popup><strong>{geometry.name}</strong><br />{geometry.description || "Sem descrição"}</Popup></Marker>;
    }
    if (geometry.type === "polyline") {
      return <Polyline key={geometry.id} positions={coords} pathOptions={style} ref={ref}><Popup><strong>{geometry.name}</strong></Popup></Polyline>;
    }
    return <Polygon key={geometry.id} positions={coords} pathOptions={style} ref={ref}><Popup><strong>{geometry.name}</strong></Popup></Polygon>;
  };

  return (
    <div className="grid min-h-[480px] gap-4 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden">
      <Card className="flex min-h-[480px] min-w-0 flex-col overflow-hidden lg:min-h-0">
        <CardHeader className="border-b bg-slate-50 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="flex items-center gap-2"><Layers className="h-5 w-5 text-blue-600" />Mapa e análise do projeto</CardTitle><Button size="sm" variant="outline" onClick={() => setPrintOpen(true)}><Printer className="mr-2 h-4 w-4" />Imprimir mapa</Button></div>
          <CardDescription>Desenhe, edite, selecione e gere resultados espaciais persistidos com proveniência.</CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 p-0">
          <MapContainer ref={mapRef} center={center} zoom={11} style={{ height: "100%", width: "100%" }} className="isolate z-0 min-h-[420px] flex-1 lg:min-h-0">
            <InvalidateMapOnResize />
            <ScreenScaleIndicator />
            <TileLayer key={activeBasemap.id} attribution={activeBasemap.attribution} url={activeBasemap.url!} crossOrigin={activeBasemap.crossOrigin} minNativeZoom={activeBasemap.minZoom} maxNativeZoom={activeBasemap.maxZoom} />
            {thematicItems.map((item) => <MapPane key={item.id} name={thematicPaneName(item.id)} style={{ zIndex: thematicZIndex(item.id) }} />)}
            {rasterLayers.filter((layer) => layer.isVisible && visibleRasterIds.includes(layer.id)).map((layer) => (
              <TileLayer key={`raster-${layer.id}`} pane={thematicPaneName(`raster-${layer.id}`)} url={layer.tileTemplate} minZoom={layer.minZoom} maxZoom={layer.maxZoom} opacity={rasterOpacity / 100} />
            ))}
            {visibleOgcLayers.map((layer) => layer.selected?.serviceType === "wms" && <WMSTileLayer key={`ogc-${layer.logicalLayer}`} pane={thematicPaneName(`ogc-${layer.logicalLayer}`)} url={layer.selected.endpoint} layers={layer.selected.remoteLayer} format="image/png" transparent version="1.1.1" crs={L.CRS.EPSG3857} attribution={isIbgeVariant(layer.selected) ? ibgeAttribution(layer.selected) : escapeAttribution(layer.selected.attribution || layer.selected.publisher || "Fonte OGC publicada")} />)}
            {projectVectorLayers.filter((layer) => layer.isVisible).map((layer) => (
              <GeoJSON
                key={`file-vector-${layer.id}`}
                data={layer.layerData}
                style={{ color: layer.defaultStyle?.color || "#2563eb", weight: layer.defaultStyle?.weight || 2, fillOpacity: layer.defaultStyle?.fillOpacity ?? 0.2, pane: thematicPaneName(`vector-${layer.id}`) }}
                onEachFeature={(feature, leafletLayer) => leafletLayer.bindPopup(`<strong>${escapePopupText(layer.name)}</strong><br/>${escapePopupText(feature.properties?.name || "Feição importada")}`)}
              />
            ))}
            <FeatureGroup ref={setEditableLayers}>
              {canEdit && editableLayers && <LeafletDrawControl
                featureGroup={editableLayers}
                draw={drawOptions}
                onCreated={(event: any) => {
                  const type = event.layerType === "marker" ? "marker" : event.layerType === "polyline" ? "polyline" : "polygon";
                  pendingLayerRef.current = event.layer;
                  setPending({ type, coordinates: coordinatesFromLayer(event.layer, type) });
                }}
                onEdited={(event: any) => {
                  event.layers.eachLayer((layer: any) => {
                    const id = layer.options.geometryId as number | undefined;
                    const type = layer.options.geometryType as StoredGeometry["type"] | undefined;
                    if (id && type) updateGeometry.mutate({ id, coordinates: coordinatesFromLayer(layer, type) });
                  });
                }}
                onDeleted={(event: any) => {
                  event.layers.eachLayer((layer: any) => {
                    const id = layer.options.geometryId as number | undefined;
                    if (id) deleteGeometry.mutate({ id });
                  });
                }}
              />}
              {geometries.map(renderGeometry)}
            </FeatureGroup>
            {analysisLayers.filter((layer: any) => layer.isVisible !== false).map((layer: any) => (
              <GeoJSON
                key={`analysis-${layer.id}`}
                data={layer.layerData as FeatureCollection}
                style={{ color: layer.defaultStyle?.color || "#1d4ed8", weight: layer.defaultStyle?.weight || 2, fillOpacity: layer.defaultStyle?.fillOpacity ?? 0.25, pane: thematicPaneName(`result-${layer.id}`) }}
                onEachFeature={(feature, leafletLayer) => {
                  const code = feature.properties?.code ? `<br/>Código: ${escapePopupText(feature.properties.code)}` : "";
                  leafletLayer.bindPopup(`<strong>${escapePopupText(layer.name)}</strong>${code}`);
                }}
              />
            ))}
          </MapContainer>
        </CardContent>
      </Card>

      <aside className="min-h-0 space-y-4 overflow-y-auto pr-1 lg:pb-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Grupos e camadas do projeto</CardTitle><CardDescription>Hierarquia compartilhada; visibilidade pessoal em cascata, independente da seleção para análise.</CardDescription></CardHeader>
          <CardContent>{hierarchy.error ? <p role="alert" className="text-sm text-destructive">{hierarchy.error.message}</p> : <LayersTree projectId={projectId} canEdit={canEdit} onChanged={() => { void invalidate(); }} />}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Árvore temática e legenda</CardTitle><CardDescription>Olho controla visualização; “usar na análise” é independente e só se aplica a vetores próprios.</CardDescription></CardHeader>
          <CardContent className="space-y-3">{geometriesLoading || layersLoading || rastersLoading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : <ThematicLayerTree items={thematicItems} order={thematicOrder} disabled={!canEdit} onVisibilityChange={toggleThematicVisibility} onAnalysisSelectionChange={toggleThematicAnalysis} onMove={moveThematicLayer} />}{selectedVectorLayerIds.length > 0 && <Button variant="outline" className="w-full" disabled={exportVectorLayer.isPending} onClick={() => exportVectorLayer.mutate({ projectId, layerId: selectedVectorLayerIds[0] })}><Download className="mr-2 h-4 w-4" />Exportar primeiro vetor selecionado</Button>}<p className="text-xs text-muted-foreground">A ordem é visual nesta sessão; visibilidade de camadas próprias é persistida e auditada. WFS exige importação controlada antes de análise.</p></CardContent>
        </Card>

        {hasIbgeWfs && <Card><CardHeader className="pb-3"><CardTitle className="text-base">IBGE WFS · consulta temporária</CardTitle></CardHeader><CardContent><p className="text-xs text-muted-foreground">Use o painel GeoServer do globo em 2D e clique em Consultar recorte. As feições ficam apenas em memória; importação persistente e análise de IBGE não estão disponíveis neste workspace.</p></CardContent></Card>}
        {publishedWfsLayers.length > 0 && <Card><CardHeader className="pb-3"><CardTitle className="text-base">Importar base WFS</CardTitle><CardDescription>Importa GeoJSON paginado, recortado pela AOI e inicialmente oculto. WMS continua exclusivamente visual.</CardDescription></CardHeader><CardContent className="space-y-2">{publishedWfsLayers.map((layer) => <div key={layer.logicalLayer} className="flex items-center justify-between gap-2 rounded border p-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{layer.logicalLayer}</p><p className="truncate text-xs text-muted-foreground">{layer.selected?.remoteLayer}</p></div><Button size="sm" variant="outline" disabled={!canEdit || importWfsLayer.isPending || !layer.selected} onClick={() => layer.selected && importWfsLayer.mutate({ projectId, variantId: layer.selected.id })}>{importWfsLayer.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Importar"}</Button></div>)}<p className="text-xs text-muted-foreground">Limites fixos: até 5.000 feições, 10 páginas e 15 MB por importação.</p></CardContent></Card>}

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Mapa de fundo</CardTitle><CardDescription>Escolha explícita do fundo; camadas de órgãos permanecem na árvore temática. Sem download em lote ou fallback silencioso.</CardDescription></CardHeader>
          <CardContent className="space-y-2"><Select value={basemapId} onValueChange={setBasemapId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SELECTABLE_BASEMAPS.map((basemap) => <SelectItem key={basemap.id} value={basemap.id}>{basemap.name}{basemap.availability === "legacy-available" ? " — legado" : ""}</SelectItem>)}</SelectContent></Select>{activeBasemap.availability === "legacy-available" && <p className="text-xs text-amber-700">Base raster Esri em suporte maduro, com retirada prevista em dezembro de 2029.</p>}</CardContent>
        </Card>

        {historicalImagery.length > 0 && <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Clock className="h-4 w-4 text-violet-600" />Catálogo histórico de imagens</CardTitle><CardDescription>Somente COGs processados, ordenados por aquisição. A visibilidade não altera a seleção analítica.</CardDescription></CardHeader><CardContent className="space-y-2">{historicalImagery.map((item) => <div key={item.layerId} className="rounded border p-2"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{new Date(item.acquisitionAt).toLocaleDateString("pt-BR")} · {item.sourceLabel || "Origem não informada"}</p><p className="text-[11px] text-muted-foreground">{item.crs} · COG {item.cogSha256.slice(0, 12)}…</p></div><Button size="sm" variant={visibleRasterIds.includes(item.layerId) ? "secondary" : "outline"} onClick={() => { const nextVisible = !visibleRasterIds.includes(item.layerId); setPersonalLayerVisibility.mutate({ id: item.layerId, visible: nextVisible }); }}>{visibleRasterIds.includes(item.layerId) ? "Ocultar" : "Exibir"}</Button></div></div>)}</CardContent></Card>}

        {rasterLayers.length > 0 && <Card><CardHeader className="pb-3"><CardTitle className="text-base">Opacidade raster</CardTitle></CardHeader><CardContent className="space-y-2"><Label>Sobreposição: {rasterOpacity}%</Label><Slider value={[rasterOpacity]} min={10} max={100} step={1} onValueChange={([value]) => setRasterOpacity(value)} /></CardContent></Card>}

        <RasterRealPixelExport projectId={projectId} bounds={exportBounds} title="Exportar recorte raster do projeto" compact />

        <RasterIngestionPanel projectId={projectId} canEdit={canEdit} />

        {canEdit && projectVectorLayers.length > 0 && (
          <SidePanel title="Editar simbologia" defaultOpen={false}>
            <div className="space-y-3">
              {projectVectorLayers.map((layer) => {
                const hasFill = layer.layerData?.features?.some((feature) => /Polygon$/.test(feature.geometry?.type ?? ""));
                return (
                  <form key={layer.id} className="grid gap-2 border-t pt-3 text-sm first:border-t-0 first:pt-0" onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    updateStyle.mutate({
                      projectId,
                      layerId: layer.id,
                      color: String(data.get("color")),
                      weight: Number(data.get("weight")),
                      fillOpacity: hasFill ? Number(data.get("opacity")) / 100 : undefined,
                    });
                  }}>
                    <strong className="truncate">{layer.name}</strong>
                    <label className="flex items-center justify-between gap-2">Cor <input name="color" type="color" defaultValue={layer.defaultStyle?.color || "#2563eb"} /></label>
                    <label className="flex items-center justify-between gap-2">Espessura <input name="weight" type="number" min="1" max="8" required defaultValue={layer.defaultStyle?.weight ?? 2} className="w-16 rounded border bg-background px-1" /></label>
                    {hasFill && <label className="flex items-center justify-between gap-2">Preenchimento (%) <input name="opacity" type="number" min="0" max="100" required defaultValue={Math.round((layer.defaultStyle?.fillOpacity ?? 0.2) * 100)} className="w-16 rounded border bg-background px-1" /></label>}
                    <Button type="submit" size="sm" variant="outline" disabled={updateStyle.isPending}>Salvar estilo</Button>
                  </form>
                );
              })}
            </div>
          </SidePanel>
        )}

        <SidePanel title={<><Sparkles className="h-4 w-4 text-orange-500" />Operação espacial</>}>
          <div className="space-y-3">
            <Select value={operation} onValueChange={(value) => setOperation(value as Operation)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(operationLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
            {operation === "buffer" && <div className="space-y-1"><Label htmlFor="buffer">Distância (metros)</Label><Input id="buffer" type="number" min="1" max="100000" value={bufferMeters} onChange={(event) => setBufferMeters(event.target.value)} /></div>}
            {operation === "grid" && <><p className="text-xs text-muted-foreground">Marque uma área em “Usar na análise”. Os pontos serão recortados pelo polígono selecionado.</p><div className="space-y-1"><Label htmlFor="grid-pattern">Formato da malha</Label><Select value={gridPattern} onValueChange={setGridPattern}><SelectTrigger id="grid-pattern"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="quadrada">Quadrada</SelectItem><SelectItem value="triangular">Triangular (linhas alternadas)</SelectItem></SelectContent></Select></div><div className="space-y-1"><Label htmlFor="grid-spacing">Espaçamento (metros)</Label><Input id="grid-spacing" type="number" min="10" max="10000" value={gridSpacing} onChange={(event) => setGridSpacing(event.target.value)} /></div><div className="space-y-1"><Label htmlFor="grid-code">Prefixo</Label><Input id="grid-code" value={gridCode} onChange={(event) => setGridCode(event.target.value)} /></div><div className="space-y-1"><Label htmlFor="grid-rotation">Rotação (graus)</Label><Input id="grid-rotation" type="number" min="-180" max="180" value={gridRotation} onChange={(event) => setGridRotation(event.target.value)} /></div></>}
            <p className="text-xs text-muted-foreground">Cálculos geodésicos em EPSG:4326. Distâncias em metros e área em m²; cada resultado fica salvo como camada vetorial do projeto.</p>
            <Button className="w-full" onClick={executeOperation} disabled={!canEdit || runAnalysis.isPending}>{runAnalysis.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ruler className="mr-2 h-4 w-4" />}{canEdit ? "Executar e salvar" : "Somente leitura"}</Button>
          </div>
        </SidePanel>

      </aside>

      <MapPrintPreview projectId={projectId} projectName={projectName || `Projeto ${projectId}`} clientName={clientName} open={printOpen} onClose={() => setPrintOpen(false)} captureMap={captureCurrentMap} />

      <Dialog open={Boolean(pending)} onOpenChange={(open) => { if (!open) { if (pendingLayerRef.current && editableLayers) editableLayers.removeLayer(pendingLayerRef.current); pendingLayerRef.current = null; setPending(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Salvar nova feição</DialogTitle><DialogDescription>O desenho será associado ao projeto atual e ficará disponível para análise e exportação.</DialogDescription></DialogHeader>
          <div className="space-y-3"><div className="space-y-1"><Label htmlFor="feature-name">Nome</Label><Input id="feature-name" value={newName} onChange={(event) => setNewName(event.target.value)} autoFocus /></div><div className="space-y-1"><Label htmlFor="feature-description">Descrição</Label><Input id="feature-description" value={newDescription} onChange={(event) => setNewDescription(event.target.value)} /></div></div>
          <DialogFooter><Button variant="outline" onClick={() => { if (pendingLayerRef.current && editableLayers) editableLayers.removeLayer(pendingLayerRef.current); pendingLayerRef.current = null; setPending(null); }}>Cancelar</Button><Button onClick={savePending} disabled={createGeometry.isPending}>{createGeometry.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Salvar feição</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
