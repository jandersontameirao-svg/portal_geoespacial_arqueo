import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import Globe from "react-globe.gl";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polygon,
  Polyline,
  FeatureGroup,
  GeoJSON,
  useMapEvents,
} from "react-leaflet";
import "leaflet-draw/dist/leaflet.draw.css";
import { Button } from "./ui/button";
import {
  Globe as GlobeIcon,
  Map,
  Layers,
  ZoomIn,
  ZoomOut,
  Home,
  Maximize2,
  Hand,
  Upload,
  Printer,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import LayersPanel from "./LayersPanel";
import MeasurementTools from "./MeasurementTools";
import { CoordinatesDisplay } from "./CoordinatesDisplay";
import { MapEventsHandler } from "./MapEventsHandler";
import { CoordinateSearch } from "./CoordinateSearch";
import { formatUTMCoordinates } from "@/lib/utmHelper";
import GeometryImport from "./GeometryImport";
import SavedMapsPanel from "./SavedMapsPanel";
import MapPrintPreview from "./MapPrintPreview";
import { DEFAULT_BASEMAP, SELECTABLE_BASEMAPS } from "@/lib/basemaps";
import LeafletDrawControl from "./LeafletDrawControl";
import GlobalMapPanels from "./GlobalMapPanels";
import { BaseLayerMapOverlays } from "./BaseLayersPanel";
import InstitutionalMapLayers, { InstitutionalLayersProvider } from "./InstitutionalMapLayers";
import {
  isWorkspaceFeatureCollection,
  standaloneWorkspaceGeometry,
} from "@shared/workspaceHierarchy";
import { closeLeafletPolygonRings } from "@/lib/leaflet-geometry-coordinates";

const INITIAL_POSITION = {
  latitude: -15.7801,
  longitude: -47.9292,
  altitude: 2,
};

function escapePopupText(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    character =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!
  );
}

// Mantém centro/zoom e tamanho do Leaflet sincronizados sem desmontar desenhos.
function MapViewSync({
  center,
  zoom,
  mapRef,
  onMove,
  panEnabled,
}: {
  center: [number, number];
  zoom: number;
  mapRef: { current: L.Map | null };
  onMove: (latitude: number, longitude: number, zoom: number) => void;
  panEnabled: boolean;
}) {
  const map = useMapEvents({
    moveend: () => {
      const position = map.getCenter();
      onMove(position.lat, position.lng, map.getZoom());
    },
  });
  useEffect(() => {
    mapRef.current = map;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer?.observe(map.getContainer());
    map.invalidateSize({ pan: false });
    return () => {
      observer?.disconnect();
      mapRef.current = null;
    };
  }, [map, mapRef]);
  useEffect(() => {
    if (panEnabled) map.dragging.enable();
    else map.dragging.disable();
  }, [map, panEnabled]);
  useEffect(() => {
    if (
      Math.abs(map.getCenter().lat - center[0]) > 0.000001 ||
      Math.abs(map.getCenter().lng - center[1]) > 0.000001 ||
      map.getZoom() !== zoom
    )
      map.setView(center, zoom);
  }, [map, center[0], center[1], zoom]);
  return null;
}

// O mesmo catálogo alimenta a árvore e a renderização: inclui vetores legados
// layerData e evita desenhar novamente as geometrias materializadas em GeoJSON.
function ProjectLayerDataOverlays({ projectId }: { projectId: number }) {
  const { data: layers, isError } = trpc.layers.list.useQuery(
    { projectId },
    { retry: false }
  );
  useEffect(() => {
    if (isError)
      toast.error(
        `Camadas do projeto #${projectId} indisponíveis; overlays removidos.`
      );
  }, [isError, projectId]);
  if (isError) return null;
  return (
    <>
      {layers
        ?.filter(
          layer =>
            !layer.isGroup &&
            layer.effectiveVisible &&
            layer.layerType === "vector" &&
            isWorkspaceFeatureCollection(layer.layerData)
        )
        .map(layer => (
          <GeoJSON
            key={`${layer.id}-${layer.updatedAt?.toString()}-${JSON.stringify(layer.defaultStyle)}`}
            data={layer.layerData as import("geojson").FeatureCollection}
            style={{
              color:
                (layer.defaultStyle as { color?: string } | null)?.color ??
                "#2563eb",
              weight: 2,
              fillOpacity: 0.2,
            }}
            onEachFeature={(_feature, leafletLayer) => {
              const label = document.createElement("span");
              label.textContent = layer.name;
              leafletLayer.bindPopup(label);
            }}
          />
        ))}
    </>
  );
}

function ProjectGeometryOverlays({
  projectId,
  children,
}: {
  projectId: number;
  children: (layerIds: Set<number>) => React.ReactNode;
}) {
  const { data: layers, isError } = trpc.layers.list.useQuery(
    { projectId },
    { retry: false }
  );
  if (isError || !layers) return null;
  const materialized = new Set(
    layers
      .filter(
        layer => !standaloneWorkspaceGeometry({ layerId: layer.id }, layers)
      )
      .map(layer => layer.id)
  );
  return <>{children(materialized)}</>;
}

interface GlobeViewerProps {
  projectId?: number;
  initialPosition?: {
    latitude: number;
    longitude: number;
    altitude: number;
  };
  onViewModeChange?: (mode: "2d" | "3d") => void;
}

function firstStoredPosition(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (typeof value[0] === "number" && typeof value[1] === "number")
    return [value[0], value[1]];
  return firstStoredPosition(value[0]);
}

export default function GlobeViewer({
  projectId: requestedProjectId,
  initialPosition = INITIAL_POSITION, // Brasília
  onViewModeChange,
}: GlobeViewerProps) {
  const { user } = useAuth();
  const globeEl = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [basemapId, setBasemapId] = useState(DEFAULT_BASEMAP.id);
  const activeBasemap =
    SELECTABLE_BASEMAPS.find(
      basemap => basemap.id === basemapId && basemap.url
    ) ?? DEFAULT_BASEMAP;
  const [mapZoom, setMapZoom] = useState(
    Math.round(10 - initialPosition.altitude * 2)
  );
  const [viewMode, setViewMode] = useState<"2d" | "3d">("3d");
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [currentShape, setCurrentShape] = useState<any>(null);
  const [shapeName, setShapeName] = useState("");
  const [shapeDescription, setShapeDescription] = useState("");
  const [shapeColor, setShapeColor] = useState("#3b82f6");
  const [isLoading, setIsLoading] = useState(true);
  const [currentPosition, setCurrentPosition] = useState(initialPosition);
  const [isPanMode, setIsPanMode] = useState(true);
  const [mouseCoords, setMouseCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [drawFeatureGroup, setDrawFeatureGroup] =
    useState<L.FeatureGroup | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);

  const utils = trpc.useUtils();
  const { data: projects, isError: projectsError } =
    trpc.projects.list.useQuery();
  // Uma URL contextual não autoriza escrita nem revela um projeto alheio.
  const projectId = projects?.find(
    project => project.id === requestedProjectId
  )?.id;
  const selection = trpc.projectSelection.get.useQuery(undefined, {
    retry: false,
  });
  const [selectedIds, setSelectedIds] = useState<number[] | null>(null);
  const [selectionError, setSelectionError] = useState<string>();
  const selectionMutation = trpc.projectSelection.set.useMutation();
  const enabledIds = useMemo(
    () =>
      projectsError
        ? []
        : (selectedIds ?? []).filter(id =>
            projects?.some(project => project.id === id)
          ),
    [selectedIds, projects, projectsError]
  );
  useEffect(() => {
    if (!projects || !selection.data || selection.isError) return;
    setSelectedIds(
      current =>
        current ??
        Array.from(
          new Set([...selection.data, ...(projectId ? [projectId] : [])])
        )
          .filter(id => projects.some(project => project.id === id))
          .slice(0, 500)
    );
  }, [projects, selection.data, selection.isError, projectId]);
  const changeSelection = (ids: number[]) => {
    if (selectionMutation.isPending || !projects || selectedIds === null)
      return;
    const allowed = Array.from(new Set(ids))
      .filter(id => projects.some(project => project.id === id))
      .slice(0, 500);
    const previous = selectedIds;
    setSelectedIds(allowed);
    setSelectionError(undefined);
    selectionMutation.mutate(
      { projectIds: allowed },
      {
        onSuccess: () => {
          utils.projectSelection.get.setData(undefined, allowed);
          void utils.projectSelection.get.invalidate();
        },
        onError: error => {
          setSelectedIds(previous);
          setSelectionError(`Seleção não salva: ${error.message}`);
        },
      }
    );
  };
  // Componentes existentes de importação/exportação/opacidade invalidam list.
  // Acompanhar esse cache conserva o comportamento sem alterar esses componentes.
  const contextualGeometries = trpc.geometries.list.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );
  useEffect(() => {
    if (contextualGeometries.dataUpdatedAt)
      void utils.geometries.listForProjects.invalidate();
  }, [contextualGeometries.dataUpdatedAt]);
  const {
    data: savedGeometries,
    isError: geometriesError,
    isLoading: geometriesLoading,
  } = trpc.geometries.listForProjects.useQuery(
    { projectIds: enabledIds },
    {
      enabled: selectedIds !== null && enabledIds.length > 0 && !projectsError,
      retry: false,
    }
  );
  const selectionReady =
    selectedIds !== null && !selection.isError && !projectsError;
  const contextualProject = projects?.find(project => project.id === projectId);
  const canWriteContext =
    !!projectId && (user?.role === "admin" || user?.role === "editor");
  useEffect(() => {
    if (projectId)
      setSelectedIds(current =>
        current && !current.includes(projectId)
          ? [projectId, ...current].slice(0, 500)
          : current
      );
  }, [projectId]);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const resize = () =>
      setDimensions({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const bounds = contextualProject?.aoiBounds;
    if (!bounds) return;
    const position = {
      latitude: (bounds.north + bounds.south) / 2,
      longitude: (bounds.east + bounds.west) / 2,
      altitude: 0.5,
    };
    setCurrentPosition(position);
    setMapZoom(11);
    globeEl.current?.pointOfView(
      {
        lat: position.latitude,
        lng: position.longitude,
        altitude: position.altitude,
      },
      1000
    );
  }, [projectId, contextualProject?.aoiBounds]);
  const drawOptions = useMemo<L.Control.DrawOptions>(
    () => ({
      rectangle: false,
      circle: false,
      circlemarker: false,
      marker: {},
      polyline: {},
      polygon: {},
    }),
    []
  );

  // Mutation para salvar geometria
  const createGeometryMutation = trpc.geometries.create.useMutation({
    onSuccess: () => {
      void utils.geometries.list.invalidate();
      void utils.geometries.listForProjects.invalidate();
      // O renderer persistido passa a ser a única cópia após salvar o rascunho.
      if (currentShape?.layer)
        drawFeatureGroup?.removeLayer(currentShape.layer);
      toast.success("Geometria salva com sucesso!");
      setSaveDialogOpen(false);
      setShapeName("");
      setShapeDescription("");
      setShapeColor("#3b82f6");
      setCurrentShape(null);
    },
    onError: error => {
      toast.error(`Erro ao salvar: ${error.message}`);
    },
  });

  const handleSaveGeometry = () => {
    if (!shapeName.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    if (!projectId) {
      toast.error("Projeto não especificado");
      return;
    }
    if (!currentShape) return;

    createGeometryMutation.mutate({
      projectId,
      type: currentShape.type,
      name: shapeName,
      description: shapeDescription,
      coordinates: JSON.stringify(currentShape.coordinates),
      color: shapeColor,
    });
  };

  // Preparar dados dos marcadores (calcular centro do AOI)
  const markersData =
    projects
      ?.filter(p => enabledIds.includes(p.id) && p.aoiBounds)
      .map(p => {
        const bounds = p.aoiBounds!;
        const lat = (bounds.north + bounds.south) / 2;
        const lng = (bounds.east + bounds.west) / 2;

        // Criar GeoJSON do polígono AOI
        const aoiGeoJSON = JSON.stringify({
          type: "Polygon",
          coordinates: [
            [
              [bounds.west, bounds.north],
              [bounds.east, bounds.north],
              [bounds.east, bounds.south],
              [bounds.west, bounds.south],
              [bounds.west, bounds.north],
            ],
          ],
        });

        return {
          lat,
          lng,
          size: 0.5,
          color: "#3b82f6",
          label: p.name,
          id: p.id,
          code: p.code,
          aoiBounds: aoiGeoJSON,
        };
      }) || [];

  useEffect(() => {
    if (globeEl.current) {
      // Posicionar câmera inicial
      globeEl.current.pointOfView(
        {
          lat: initialPosition.latitude,
          lng: initialPosition.longitude,
          altitude: initialPosition.altitude,
        },
        1000
      );

      setIsLoading(false);
    }
  }, [initialPosition]);

  const handleToggleView = () => {
    // Salvar posição atual antes de alternar
    if (globeEl.current && viewMode === "3d") {
      const pov = globeEl.current.pointOfView();
      setCurrentPosition({
        latitude: pov.lat,
        longitude: pov.lng,
        altitude: pov.altitude,
      });
      setMapZoom(Math.max(2, Math.round(10 - pov.altitude * 2)));
    }

    const newMode = viewMode === "3d" ? "2d" : "3d";
    setViewMode(newMode);
    onViewModeChange?.(newMode);
  };

  const handleZoomIn = () => {
    if (viewMode === "2d") {
      mapRef.current?.zoomIn();
      return;
    }
    if (globeEl.current) {
      const pov = globeEl.current.pointOfView();
      globeEl.current.pointOfView(
        { altitude: Math.max(pov.altitude - 0.5, 0.5) },
        500
      );
    }
  };

  const handleZoomOut = () => {
    if (viewMode === "2d") {
      mapRef.current?.zoomOut();
      return;
    }
    if (globeEl.current) {
      const pov = globeEl.current.pointOfView();
      globeEl.current.pointOfView(
        { altitude: Math.min(pov.altitude + 0.5, 5) },
        500
      );
    }
  };

  const handleResetView = () => {
    if (viewMode === "2d") {
      setCurrentPosition(initialPosition);
      setMapZoom(Math.round(10 - initialPosition.altitude * 2));
      return;
    }
    if (globeEl.current) {
      globeEl.current.pointOfView(
        {
          lat: initialPosition.latitude,
          lng: initialPosition.longitude,
          altitude: initialPosition.altitude,
        },
        1000
      );
    }
  };

  return (
    <InstitutionalLayersProvider viewMode={viewMode}>
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-slate-950"
    >
      {isLoading && viewMode === "3d" && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950 z-10">
          <div className="text-center">
            <GlobeIcon className="w-12 h-12 animate-spin mx-auto mb-4 text-blue-500" />
            <p className="text-white">Carregando globo 3D...</p>
          </div>
        </div>
      )}

      {viewMode === "3d" ? (
        <Globe
          ref={globeEl}
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
          bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
          backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
          width={dimensions.width}
          height={dimensions.height}
          animateIn={true}
          waitForGlobeReady={true}
          onGlobeReady={() => {
            setIsLoading(false);
            globeEl.current?.pointOfView(
              {
                lat: currentPosition.latitude,
                lng: currentPosition.longitude,
                altitude: currentPosition.altitude,
              },
              0
            );
          }}
          // Marcadores de projetos
          pointsData={markersData}
          pointAltitude={0.01}
          pointRadius={0.5}
          pointColor={() => "#3b82f6"}
          pointLabel={(d: any) => `
            <div style="background: white; padding: 8px 12px; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.15);">
              <strong style="color: #1e293b; font-size: 14px;">${escapePopupText(d.label)}</strong><br/>
              <span style="color: #64748b; font-size: 12px;">${escapePopupText(d.code)}</span>
            </div>
          `}
          onPointClick={(point: any) => {
            window.location.href = `/projects/${point.id}?tab=map`;
          }}
        />
      ) : (
        <MapContainer
          center={[currentPosition.latitude, currentPosition.longitude]}
          zoom={mapZoom}
          style={{ width: "100%", height: "100%" }}
          zoomControl={false}
          className="z-0 [&_.leaflet-top.leaflet-left]:top-16"
        >
          {/* Capturar eventos do mouse */}
          <MapEventsHandler
            onMouseMove={(lat, lng) => setMouseCoords({ lat, lng })}
          />
          <MapViewSync
            center={[currentPosition.latitude, currentPosition.longitude]}
            zoom={mapZoom}
            mapRef={mapRef}
            panEnabled={isPanMode}
            onMove={(latitude, longitude, zoom) => {
              setCurrentPosition(previous => ({
                ...previous,
                latitude,
                longitude,
              }));
              setMapZoom(zoom);
            }}
          />
          <TileLayer
            key={activeBasemap.id}
            attribution={activeBasemap.attribution}
            url={activeBasemap.url!}
          />
          <BaseLayerMapOverlays />
          <InstitutionalMapLayers />
          {enabledIds.map(id => (
            <ProjectLayerDataOverlays key={id} projectId={id} />
          ))}
          {/* Ferramentas de Medição */}
          <MeasurementTools />

          {/* Ferramentas de Desenho */}
          <FeatureGroup ref={setDrawFeatureGroup}>
            {drawFeatureGroup && canWriteContext && (
              <LeafletDrawControl
                featureGroup={drawFeatureGroup}
                draw={drawOptions}
                onCreated={(e: any) => {
                  const { layerType, layer } = e;
                  const shape = {
                    type: layerType,
                    coordinates:
                      layerType === "marker"
                        ? [layer.getLatLng().lat, layer.getLatLng().lng]
                        : layerType === "polyline"
                          ? layer
                              .getLatLngs()
                              .map((ll: any) => [ll.lat, ll.lng])
                          : closeLeafletPolygonRings(
                              layer
                                .getLatLngs()[0]
                                .map((ll: any) => [ll.lat, ll.lng])
                            ),
                    id: Date.now(),
                    layer, // Guardar referência da camada
                  };
                  setCurrentShape(shape);
                  setSaveDialogOpen(true);
                }}
                onEdited={(e: any) => {
                  console.log("Formas editadas:", e);
                }}
                onDeleted={(e: any) => {
                  console.log("Formas deletadas:", e);
                }}
              />
            )}
          </FeatureGroup>

          {/* Marcadores de Projetos */}
          {markersData.map(marker => {
            const utmCoords = formatUTMCoordinates(marker.lat, marker.lng);
            return (
              <Marker key={marker.id} position={[marker.lat, marker.lng]}>
                <Popup>
                  <div>
                    <strong>{marker.label}</strong>
                    <br />
                    <span style={{ color: "#64748b", fontSize: "12px" }}>
                      {marker.code}
                    </span>
                    <br />
                    <Link
                      href={`/projects/${marker.id}?tab=map`}
                      style={{ color: "#3b82f6", textDecoration: "underline" }}
                    >
                      Abrir workspace do projeto
                    </Link>
                    <div
                      style={{
                        marginTop: "8px",
                        padding: "6px",
                        background: "#f3f4f6",
                        borderRadius: "4px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "11px",
                          color: "#6b7280",
                          fontWeight: "600",
                        }}
                      >
                        COORDENADAS UTM
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          fontFamily: "monospace",
                          marginTop: "2px",
                        }}
                      >
                        {utmCoords}
                      </div>
                      <div
                        style={{
                          fontSize: "10px",
                          color: "#9ca3af",
                          marginTop: "4px",
                        }}
                      >
                        Lat: {marker.lat.toFixed(6)}°, Lng:{" "}
                        {marker.lng.toFixed(6)}°
                      </div>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {/* Geometrias Salvas do Projeto */}
          {!geometriesError &&
            enabledIds.map(id => (
              <ProjectGeometryOverlays key={id} projectId={id}>
                {materialized =>
                  savedGeometries
                    ?.filter(
                      g =>
                        g.projectId === id &&
                        g.visible === 1 &&
                        g.effectiveVisible &&
                        (g.layerId == null || !materialized.has(g.layerId))
                    )
                    .map(geometry => {
                      try {
                        const coords = JSON.parse(geometry.coordinates);
                        const opacity = geometry.opacity / 100;
                        const color = geometry.color || "#3b82f6";

                        if (geometry.type === "marker") {
                          const utmCoords = formatUTMCoordinates(
                            coords[0],
                            coords[1]
                          );
                          return (
                            <Marker
                              key={`geom-${geometry.id}`}
                              position={[coords[0], coords[1]]}
                            >
                              <Popup>
                                <div>
                                  <strong>{geometry.name}</strong>
                                  <br />
                                  {geometry.description && (
                                    <>
                                      <span style={{ fontSize: "12px" }}>
                                        {geometry.description}
                                      </span>
                                      <br />
                                    </>
                                  )}
                                  <div
                                    style={{
                                      marginTop: "8px",
                                      padding: "6px",
                                      background: "#f3f4f6",
                                      borderRadius: "4px",
                                    }}
                                  >
                                    <div
                                      style={{
                                        fontSize: "11px",
                                        color: "#6b7280",
                                        fontWeight: "600",
                                      }}
                                    >
                                      COORDENADAS UTM
                                    </div>
                                    <div
                                      style={{
                                        fontSize: "12px",
                                        fontFamily: "monospace",
                                        marginTop: "2px",
                                      }}
                                    >
                                      {utmCoords}
                                    </div>
                                    <div
                                      style={{
                                        fontSize: "10px",
                                        color: "#9ca3af",
                                        marginTop: "4px",
                                      }}
                                    >
                                      Lat: {coords[0].toFixed(6)}°, Lng:{" "}
                                      {coords[1].toFixed(6)}°
                                    </div>
                                  </div>
                                </div>
                              </Popup>
                            </Marker>
                          );
                        } else if (geometry.type === "polyline") {
                          const positions = coords.map((c: number[]) => [
                            c[0],
                            c[1],
                          ]);
                          const firstPoint = positions[0];
                          const utmCoords = formatUTMCoordinates(
                            firstPoint[0],
                            firstPoint[1]
                          );
                          return (
                            <Polyline
                              key={`geom-${geometry.id}`}
                              positions={positions}
                              color={color}
                              opacity={opacity}
                              weight={3}
                            >
                              <Popup>
                                <div>
                                  <strong>{geometry.name}</strong>
                                  <br />
                                  {geometry.description && (
                                    <>
                                      <span style={{ fontSize: "12px" }}>
                                        {geometry.description}
                                      </span>
                                      <br />
                                    </>
                                  )}
                                  <div
                                    style={{
                                      marginTop: "8px",
                                      padding: "6px",
                                      background: "#f3f4f6",
                                      borderRadius: "4px",
                                    }}
                                  >
                                    <div
                                      style={{
                                        fontSize: "11px",
                                        color: "#6b7280",
                                        fontWeight: "600",
                                      }}
                                    >
                                      PONTO INICIAL (UTM)
                                    </div>
                                    <div
                                      style={{
                                        fontSize: "12px",
                                        fontFamily: "monospace",
                                        marginTop: "2px",
                                      }}
                                    >
                                      {utmCoords}
                                    </div>
                                  </div>
                                </div>
                              </Popup>
                            </Polyline>
                          );
                        } else if (geometry.type === "polygon") {
                          const positions = coords as
                            | L.LatLngExpression[][]
                            | L.LatLngExpression[][][];
                          const firstPoint = firstStoredPosition(coords);
                          if (!firstPoint) return null;
                          const utmCoords = formatUTMCoordinates(
                            firstPoint[0],
                            firstPoint[1]
                          );
                          return (
                            <Polygon
                              key={`geom-${geometry.id}`}
                              positions={positions}
                              pathOptions={{
                                color: color,
                                fillColor: color,
                                fillOpacity: opacity * 0.5,
                                opacity: opacity,
                                weight: 2,
                              }}
                            >
                              <Popup>
                                <div>
                                  <strong>{geometry.name}</strong>
                                  <br />
                                  {geometry.description && (
                                    <>
                                      <span style={{ fontSize: "12px" }}>
                                        {geometry.description}
                                      </span>
                                      <br />
                                    </>
                                  )}
                                  <div
                                    style={{
                                      marginTop: "8px",
                                      padding: "6px",
                                      background: "#f3f4f6",
                                      borderRadius: "4px",
                                    }}
                                  >
                                    <div
                                      style={{
                                        fontSize: "11px",
                                        color: "#6b7280",
                                        fontWeight: "600",
                                      }}
                                    >
                                      PONTO INICIAL (UTM)
                                    </div>
                                    <div
                                      style={{
                                        fontSize: "12px",
                                        fontFamily: "monospace",
                                        marginTop: "2px",
                                      }}
                                    >
                                      {utmCoords}
                                    </div>
                                  </div>
                                </div>
                              </Popup>
                            </Polygon>
                          );
                        }
                      } catch (e) {
                        console.error("Erro ao renderizar geometria:", e);
                      }
                      return null;
                    })
                }
              </ProjectGeometryOverlays>
            ))}

          {/* Polígonos de AOI dos Projetos */}
          {markersData.map(marker => {
            if (marker.aoiBounds) {
              try {
                const bounds = JSON.parse(marker.aoiBounds);
                if (bounds.type === "Polygon" && bounds.coordinates) {
                  const coords = bounds.coordinates[0].map(
                    (coord: number[]) => [coord[1], coord[0]]
                  );
                  return (
                    <Polygon
                      key={`aoi-${marker.id}`}
                      positions={coords}
                      pathOptions={{
                        color: "#3b82f6",
                        fillColor: "#3b82f6",
                        fillOpacity: 0.2,
                        weight: 2,
                      }}
                    >
                      <Popup>
                        <div>
                          <strong>AOI: {marker.label}</strong>
                          <br />
                          <span style={{ color: "#64748b", fontSize: "12px" }}>
                            Área de Interesse do Projeto
                          </span>
                        </div>
                      </Popup>
                    </Polygon>
                  );
                }
              } catch (e) {
                console.error("Erro ao parsear AOI:", e);
              }
            }
            return null;
          })}
        </MapContainer>
      )}

      {/* Controles Flutuantes */}
      <div className="absolute top-4 right-3 flex flex-col gap-2 z-[900]">
        {/* Toggle 2D/3D */}
        <Button
          variant="secondary"
          size="icon"
          onClick={handleToggleView}
          className="bg-white/90 hover:bg-white shadow-lg"
          title={viewMode === "3d" ? "Alternar para 2D" : "Alternar para 3D"}
        >
          {viewMode === "3d" ? (
            <Map className="w-5 h-5" />
          ) : (
            <GlobeIcon className="w-5 h-5" />
          )}
        </Button>

        {/* Zoom In */}
        <Button
          variant="secondary"
          size="icon"
          onClick={handleZoomIn}
          className="bg-white/90 hover:bg-white shadow-lg"
          title="Aproximar"
        >
          <ZoomIn className="w-5 h-5" />
        </Button>

        {/* Zoom Out */}
        <Button
          variant="secondary"
          size="icon"
          onClick={handleZoomOut}
          className="bg-white/90 hover:bg-white shadow-lg"
          title="Afastar"
        >
          <ZoomOut className="w-5 h-5" />
        </Button>

        {/* Reset View */}
        <Button
          variant="secondary"
          size="icon"
          onClick={handleResetView}
          className="bg-white/90 hover:bg-white shadow-lg"
          title="Resetar Visualização"
        >
          <Home className="w-5 h-5" />
        </Button>

        {/* Fullscreen */}
        <Button
          variant="secondary"
          size="icon"
          className="bg-white/90 hover:bg-white shadow-lg"
          title="Tela Cheia"
          onClick={() => {
            if (document.fullscreenElement) {
              document.exitFullscreen();
            } else {
              document.documentElement.requestFullscreen();
            }
          }}
        >
          <Maximize2 className="w-5 h-5" />
        </Button>

        {/* Ferramenta de Mão (Pan) */}
        {viewMode === "2d" && (
          <Button
            variant={isPanMode ? "default" : "secondary"}
            size="icon"
            onClick={() => {
              const next = !isPanMode;
              setIsPanMode(next);
              if (next) mapRef.current?.dragging.enable();
              else mapRef.current?.dragging.disable();
            }}
            className={
              isPanMode
                ? "bg-blue-500 hover:bg-blue-600 shadow-lg"
                : "bg-white/90 hover:bg-white shadow-lg"
            }
            title={
              isPanMode ? "Desativar arraste do mapa" : "Ativar arraste do mapa"
            }
            aria-pressed={isPanMode}
          >
            <Hand className="w-5 h-5" />
          </Button>
        )}

        {/* Importar Geometrias */}
        {viewMode === "2d" && canWriteContext && (
          <Button
            variant="secondary"
            size="icon"
            onClick={() => setImportDialogOpen(true)}
            className="bg-white/90 hover:bg-white shadow-lg"
            title="Importar KML/GeoJSON"
          >
            <Upload className="w-5 h-5" />
          </Button>
        )}

        {/* Imprimir Mapa Técnico */}
        {viewMode === "2d" && projectId && (
          <Button
            variant="secondary"
            size="icon"
            onClick={() => setPrintDialogOpen(true)}
            className="bg-white/90 hover:bg-white shadow-lg"
            title="Gerar Mapa Técnico ABNT"
          >
            <Printer className="w-5 h-5" />
          </Button>
        )}

        {/* Busca por Coordenadas */}
        {viewMode === "2d" && (
          <CoordinateSearch
            onNavigate={(lat, lng) => {
              setCurrentPosition({
                latitude: lat,
                longitude: lng,
                altitude: 0.5,
              });
              setMapZoom(14);
            }}
          />
        )}
      </div>

      <GlobalMapPanels
        enabledIds={enabledIds}
        onChange={changeSelection}
        basemapId={activeBasemap.id}
        onBasemapChange={id => {
          if (
            SELECTABLE_BASEMAPS.some(
              basemap => basemap.id === id && basemap.url
            )
          )
            setBasemapId(id);
        }}
        viewMode={viewMode}
        contextualProjectId={projectId}
        selectionReady={selectionReady}
        selectionPending={selectionMutation.isPending}
        selectionError={
          selectionError ??
          (selection.isError
            ? `Seleção persistida indisponível: ${selection.error.message}`
            : undefined)
        }
        onRetrySelection={() => {
          setSelectionError(undefined);
          setSelectedIds(null);
          void selection.refetch();
        }}
      />

      {/* Painel de Camadas */}
      {canWriteContext && (
        <div className="pointer-events-none absolute inset-0 z-[900] [&>button]:pointer-events-auto [&>button]:top-auto [&>button]:bottom-24 [&>aside]:pointer-events-auto [&>aside]:max-w-[calc(100%-4rem)]">
          <LayersPanel projectId={projectId} />
        </div>
      )}

      {/* Painel de Estados de Mapa Salvos */}
      {projectId && (
        <div className="pointer-events-none absolute inset-0 z-[900] [&>div]:pointer-events-auto [&>div]:top-auto [&>div]:bottom-14">
          <SavedMapsPanel
            projectId={projectId}
            currentViewMode={viewMode}
            currentCenter={{
              lat: currentPosition.latitude,
              lon: currentPosition.longitude,
              height: currentPosition.altitude,
            }}
            currentZoom={viewMode === "2d" ? mapZoom : undefined}
            basemap={activeBasemap.id}
            onRestoreState={state => {
              setViewMode(state.viewMode);
              if (
                state.basemap &&
                SELECTABLE_BASEMAPS.some(
                  basemap => basemap.id === state.basemap && basemap.url
                )
              )
                setBasemapId(state.basemap);
              if (state.zoom != null) setMapZoom(state.zoom);
              setCurrentPosition({
                latitude: state.center.lat,
                longitude: state.center.lon,
                altitude: state.center.height || 2,
              });
              globeEl.current?.pointOfView(
                {
                  lat: state.center.lat,
                  lng: state.center.lon,
                  altitude: state.center.height || 2,
                },
                500
              );
              if (onViewModeChange) {
                onViewModeChange(state.viewMode);
              }
            }}
          />
        </div>
      )}

      {/* Info Badge */}
      <div className="absolute bottom-4 left-4 max-w-[calc(100%-5rem)] bg-background/95 text-foreground backdrop-blur px-3 py-2 rounded-lg shadow-lg z-[800]">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-600" />
          <span className="text-xs font-medium sm:text-sm">
            Modo {viewMode === "3d" ? "3D" : "2D"} •{" "}
            {projectId ? `Projeto #${projectId}` : "Visão Global"} •{" "}
            {enabledIds.length} selecionado(s)
          </span>
        </div>
        <div
          className="mt-1 space-y-1 text-xs text-muted-foreground"
          aria-live="polite"
        >
          {requestedProjectId && !projectId && !projectsError && projects && (
            <p>Projeto contextual não disponível para esta conta.</p>
          )}
          {projectsError && (
            <p role="alert">
              Projetos indisponíveis; seleções e overlays não exibidos.
            </p>
          )}
          {selection.isError && (
            <p role="alert">
              Seleção salva indisponível. Abra Projetos para tentar novamente.
            </p>
          )}
          {geometriesError && enabledIds.length > 0 && (
            <p role="alert">
              Geometrias indisponíveis; overlays de geometrias removidos.
            </p>
          )}
          {geometriesLoading && enabledIds.length > 0 && (
            <p>Carregando geometrias…</p>
          )}
          {viewMode === "2d" && !projectId && (
            <p>
              Para desenhar, importar ou exportar, abra o workspace de um
              projeto.
            </p>
          )}
          {viewMode === "2d" && projectId && !canWriteContext && (
            <p>Contexto somente leitura; desenho/importação requerem editor.</p>
          )}
        </div>
      </div>

      {/* Modal de Salvamento de Geometria */}
      <Dialog
        open={saveDialogOpen}
        onOpenChange={open => {
          setSaveDialogOpen(open);
          if (!open && currentShape?.layer) {
            drawFeatureGroup?.removeLayer(currentShape.layer);
            setCurrentShape(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Salvar Geometria</DialogTitle>
            <DialogDescription>
              Adicione informações sobre a geometria desenhada
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome *</Label>
              <Input
                id="name"
                placeholder="Ex: Área de Escavação 1"
                value={shapeName}
                onChange={e => setShapeName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Descrição</Label>
              <Textarea
                id="description"
                placeholder="Descrição opcional da geometria"
                value={shapeDescription}
                onChange={e => setShapeDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="color">Cor</Label>
              <div className="flex gap-2">
                <Input
                  id="color"
                  type="color"
                  value={shapeColor}
                  onChange={e => setShapeColor(e.target.value)}
                  className="w-20 h-10"
                />
                <Input
                  type="text"
                  value={shapeColor}
                  onChange={e => setShapeColor(e.target.value)}
                  placeholder="#3b82f6"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSaveDialogOpen(false);
                setCurrentShape(null);
                // Remover camada desenhada se cancelar
                if (currentShape?.layer) {
                  currentShape.layer.remove();
                }
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSaveGeometry}
              disabled={createGeometryMutation.isPending}
            >
              {createGeometryMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Exibir coordenadas UTM quando em modo 2D */}
      {viewMode === "2d" && mouseCoords && (
        <div className="pointer-events-none absolute inset-0 z-[850] [&>div]:bottom-24">
          <CoordinatesDisplay lat={mouseCoords.lat} lng={mouseCoords.lng} />
        </div>
      )}

      {/* Modal de Importação de Geometrias */}
      {projectId && canWriteContext && (
        <GeometryImport
          projectId={projectId}
          open={importDialogOpen}
          onOpenChange={open => {
            setImportDialogOpen(open);
            if (!open) void utils.geometries.listForProjects.invalidate();
          }}
        />
      )}

      {/* Modal de Impressão de Mapa Técnico */}
      {projectId && (
        <MapPrintPreview
          projectId={projectId}
          projectName={
            projects?.find(p => p.id === projectId)?.name ||
            `Projeto ${projectId}`
          }
          clientName={
            projects?.find(p => p.id === projectId)?.clientName || undefined
          }
          bounds={{
            north: currentPosition.latitude + 0.1,
            south: currentPosition.latitude - 0.1,
            east: currentPosition.longitude + 0.1,
            west: currentPosition.longitude - 0.1,
          }}
          open={printDialogOpen}
          onClose={() => setPrintDialogOpen(false)}
        />
      )}
    </div>
    </InstitutionalLayersProvider>
  );
}
