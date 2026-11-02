import { useEffect, useMemo, useRef, useState } from "react";
import Globe from "react-globe.gl";
import { MapContainer, TileLayer, Marker, Popup, Polygon, Polyline, FeatureGroup } from "react-leaflet";
import "leaflet-draw/dist/leaflet.draw.css";
import { Button } from "./ui/button";
import { Globe as GlobeIcon, Map, Layers, ZoomIn, ZoomOut, Home, Maximize2, Save, Hand, Upload, Printer } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
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
import { DEFAULT_BASEMAP } from "@/lib/basemaps";
import LeafletDrawControl from "./LeafletDrawControl";

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
  if (typeof value[0] === "number" && typeof value[1] === "number") return [value[0], value[1]];
  return firstStoredPosition(value[0]);
}

export default function GlobeViewer({ 
  projectId, 
  initialPosition = { latitude: -15.7801, longitude: -47.9292, altitude: 2 }, // Brasília
  onViewModeChange 
}: GlobeViewerProps) {
  const globeEl = useRef<any>(null);
  const [viewMode, setViewMode] = useState<"2d" | "3d">("3d");
  const [drawnShapes, setDrawnShapes] = useState<any[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [currentShape, setCurrentShape] = useState<any>(null);
  const [shapeName, setShapeName] = useState("");
  const [shapeDescription, setShapeDescription] = useState("");
  const [shapeColor, setShapeColor] = useState("#3b82f6");
  const [isLoading, setIsLoading] = useState(true);
  const [currentPosition, setCurrentPosition] = useState(initialPosition);
  const [isPanMode, setIsPanMode] = useState(false);
  const [mouseCoords, setMouseCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [drawFeatureGroup, setDrawFeatureGroup] = useState<L.FeatureGroup | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  
  // Buscar projetos do banco
  const { data: projects } = trpc.projects.list.useQuery();
  
  // Buscar geometrias do projeto
  const { data: savedGeometries } = trpc.geometries.list.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );
  const drawOptions = useMemo<L.Control.DrawOptions>(() => ({
    rectangle: false, circle: false, circlemarker: false, marker: {}, polyline: {}, polygon: {},
  }), []);
  
  // Mutation para salvar geometria
  const createGeometryMutation = trpc.geometries.create.useMutation({
    onSuccess: () => {
      toast.success("Geometria salva com sucesso!");
      setSaveDialogOpen(false);
      setShapeName("");
      setShapeDescription("");
      setShapeColor("#3b82f6");
      setCurrentShape(null);
    },
    onError: (error) => {
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
  const markersData = projects?.filter(p => p.aoiBounds).map(p => {
    const bounds = p.aoiBounds!;
    const lat = (bounds.north + bounds.south) / 2;
    const lng = (bounds.east + bounds.west) / 2;
    
    // Criar GeoJSON do polígono AOI
    const aoiGeoJSON = JSON.stringify({
      type: "Polygon",
      coordinates: [[
        [bounds.west, bounds.north],
        [bounds.east, bounds.north],
        [bounds.east, bounds.south],
        [bounds.west, bounds.south],
        [bounds.west, bounds.north]
      ]]
    });
    
    return {
      lat,
      lng,
      size: 0.5,
      color: "#3b82f6",
      label: p.name,
      id: p.id,
      code: p.code,
      aoiBounds: aoiGeoJSON
    };
  }) || [];

  useEffect(() => {
    if (globeEl.current) {
      // Posicionar câmera inicial
      globeEl.current.pointOfView({
        lat: initialPosition.latitude,
        lng: initialPosition.longitude,
        altitude: initialPosition.altitude
      }, 1000);
      
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
        altitude: pov.altitude
      });
    }
    
    const newMode = viewMode === "3d" ? "2d" : "3d";
    setViewMode(newMode);
    onViewModeChange?.(newMode);
  };

  const handleZoomIn = () => {
    if (globeEl.current) {
      const pov = globeEl.current.pointOfView();
      globeEl.current.pointOfView({ altitude: Math.max(pov.altitude - 0.5, 0.5) }, 500);
    }
  };

  const handleZoomOut = () => {
    if (globeEl.current) {
      const pov = globeEl.current.pointOfView();
      globeEl.current.pointOfView({ altitude: Math.min(pov.altitude + 0.5, 5) }, 500);
    }
  };

  const handleResetView = () => {
    if (globeEl.current) {
      globeEl.current.pointOfView({
        lat: initialPosition.latitude,
        lng: initialPosition.longitude,
        altitude: initialPosition.altitude
      }, 1000);
    }
  };

  return (
    <div className="relative w-full h-full bg-slate-950">
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
          width={window.innerWidth}
          height={window.innerHeight - 64}
          animateIn={true}
          waitForGlobeReady={true}
          onGlobeReady={() => setIsLoading(false)}
          // Marcadores de projetos
          pointsData={markersData}
          pointAltitude={0.01}
          pointRadius={0.5}
          pointColor={() => "#3b82f6"}
          pointLabel={(d: any) => `
            <div style="background: white; padding: 8px 12px; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.15);">
              <strong style="color: #1e293b; font-size: 14px;">${d.label}</strong><br/>
              <span style="color: #64748b; font-size: 12px;">${d.code}</span>
            </div>
          `}
          onPointClick={(point: any) => {
            window.location.href = `/projects/${point.id}`;
          }}
        />
      ) : (
        <MapContainer
          center={[currentPosition.latitude, currentPosition.longitude]}
          zoom={Math.round(10 - currentPosition.altitude * 2)}
          style={{ width: "100%", height: "calc(100vh - 64px)" }}
          zoomControl={false}
        >
          {/* Capturar eventos do mouse */}
          <MapEventsHandler onMouseMove={(lat, lng) => setMouseCoords({ lat, lng })} />
          <TileLayer
            attribution={DEFAULT_BASEMAP.attribution}
            url={DEFAULT_BASEMAP.url!}
          />
          {/* Ferramentas de Medição */}
          <MeasurementTools />
          
          {/* Ferramentas de Desenho */}
          <FeatureGroup ref={setDrawFeatureGroup}>
            {drawFeatureGroup && <LeafletDrawControl
              featureGroup={drawFeatureGroup}
              draw={drawOptions}
              onCreated={(e: any) => {
                const { layerType, layer } = e;
                const shape = {
                  type: layerType,
                  coordinates: layerType === "marker" 
                    ? [layer.getLatLng().lat, layer.getLatLng().lng]
                    : layerType === "polyline"
                    ? layer.getLatLngs().map((ll: any) => [ll.lat, ll.lng])
                    : layer.getLatLngs()[0].map((ll: any) => [ll.lat, ll.lng]),
                  id: Date.now(),
                  layer // Guardar referência da camada
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
            />}
          </FeatureGroup>

          {/* Marcadores de Projetos */}
          {markersData.map((marker) => {
            const utmCoords = formatUTMCoordinates(marker.lat, marker.lng);
            return (
              <Marker key={marker.id} position={[marker.lat, marker.lng]}>
                <Popup>
                  <div>
                    <strong>{marker.label}</strong><br/>
                    <span style={{ color: "#64748b", fontSize: "12px" }}>{marker.code}</span><br/>
                    <Link href={`/projects/${marker.id}`}>
                      <a style={{ color: "#3b82f6", textDecoration: "underline" }}>Ver projeto</a>
                    </Link>
                    <div style={{ marginTop: "8px", padding: "6px", background: "#f3f4f6", borderRadius: "4px" }}>
                      <div style={{ fontSize: "11px", color: "#6b7280", fontWeight: "600" }}>COORDENADAS UTM</div>
                      <div style={{ fontSize: "12px", fontFamily: "monospace", marginTop: "2px" }}>{utmCoords}</div>
                      <div style={{ fontSize: "10px", color: "#9ca3af", marginTop: "4px" }}>Lat: {marker.lat.toFixed(6)}°, Lng: {marker.lng.toFixed(6)}°</div>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {/* Geometrias Salvas do Projeto */}
          {savedGeometries?.filter(g => g.visible === 1).map((geometry) => {
            try {
              const coords = JSON.parse(geometry.coordinates);
              const opacity = geometry.opacity / 100;
              const color = geometry.color || "#3b82f6";
              
              if (geometry.type === "marker") {
                const utmCoords = formatUTMCoordinates(coords[0], coords[1]);
                return (
                  <Marker key={`geom-${geometry.id}`} position={[coords[0], coords[1]]}>
                    <Popup>
                      <div>
                        <strong>{geometry.name}</strong><br/>
                        {geometry.description && (
                          <><span style={{ fontSize: "12px" }}>{geometry.description}</span><br/></>
                        )}
                        <div style={{ marginTop: "8px", padding: "6px", background: "#f3f4f6", borderRadius: "4px" }}>
                          <div style={{ fontSize: "11px", color: "#6b7280", fontWeight: "600" }}>COORDENADAS UTM</div>
                          <div style={{ fontSize: "12px", fontFamily: "monospace", marginTop: "2px" }}>{utmCoords}</div>
                          <div style={{ fontSize: "10px", color: "#9ca3af", marginTop: "4px" }}>Lat: {coords[0].toFixed(6)}°, Lng: {coords[1].toFixed(6)}°</div>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                );
              } else if (geometry.type === "polyline") {
                const positions = coords.map((c: number[]) => [c[0], c[1]]);
                const firstPoint = positions[0];
                const utmCoords = formatUTMCoordinates(firstPoint[0], firstPoint[1]);
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
                        <strong>{geometry.name}</strong><br/>
                        {geometry.description && (
                          <><span style={{ fontSize: "12px" }}>{geometry.description}</span><br/></>
                        )}
                        <div style={{ marginTop: "8px", padding: "6px", background: "#f3f4f6", borderRadius: "4px" }}>
                          <div style={{ fontSize: "11px", color: "#6b7280", fontWeight: "600" }}>PONTO INICIAL (UTM)</div>
                          <div style={{ fontSize: "12px", fontFamily: "monospace", marginTop: "2px" }}>{utmCoords}</div>
                        </div>
                      </div>
                    </Popup>
                  </Polyline>
                );
              } else if (geometry.type === "polygon") {
                const positions = coords as L.LatLngExpression[][] | L.LatLngExpression[][][];
                const firstPoint = firstStoredPosition(coords);
                if (!firstPoint) return null;
                const utmCoords = formatUTMCoordinates(firstPoint[0], firstPoint[1]);
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
                        <strong>{geometry.name}</strong><br/>
                        {geometry.description && (
                          <><span style={{ fontSize: "12px" }}>{geometry.description}</span><br/></>
                        )}
                        <div style={{ marginTop: "8px", padding: "6px", background: "#f3f4f6", borderRadius: "4px" }}>
                          <div style={{ fontSize: "11px", color: "#6b7280", fontWeight: "600" }}>PONTO INICIAL (UTM)</div>
                          <div style={{ fontSize: "12px", fontFamily: "monospace", marginTop: "2px" }}>{utmCoords}</div>
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
          })}
          
          {/* Polígonos de AOI dos Projetos */}
          {markersData.map((marker) => {
            if (marker.aoiBounds) {
              try {
                const bounds = JSON.parse(marker.aoiBounds);
                if (bounds.type === "Polygon" && bounds.coordinates) {
                  const coords = bounds.coordinates[0].map((coord: number[]) => [coord[1], coord[0]]);
                  return (
                    <Polygon
                      key={`aoi-${marker.id}`}
                      positions={coords}
                      pathOptions={{
                        color: "#3b82f6",
                        fillColor: "#3b82f6",
                        fillOpacity: 0.2,
                        weight: 2
                      }}
                    >
                      <Popup>
                        <div>
                          <strong>AOI: {marker.label}</strong><br/>
                          <span style={{ color: "#64748b", fontSize: "12px" }}>Área de Interesse do Projeto</span>
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
      <div className="absolute top-4 right-4 flex flex-col gap-2 z-20">
        {/* Toggle 2D/3D */}
        <Button
          variant="secondary"
          size="icon"
          onClick={handleToggleView}
          className="bg-white/90 hover:bg-white shadow-lg"
          title={viewMode === "3d" ? "Alternar para 2D" : "Alternar para 3D"}
        >
          {viewMode === "3d" ? <Map className="w-5 h-5" /> : <GlobeIcon className="w-5 h-5" />}
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
            onClick={() => setIsPanMode(!isPanMode)}
            className={isPanMode ? "bg-blue-500 hover:bg-blue-600 shadow-lg" : "bg-white/90 hover:bg-white shadow-lg"}
            title="Ferramenta de Mão (Arrastar)"
          >
            <Hand className="w-5 h-5" />
          </Button>
        )}
        
        {/* Importar Geometrias */}
        {viewMode === "2d" && projectId && (
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
              setCurrentPosition({ latitude: lat, longitude: lng, altitude: 0.5 });
              // Forçar re-render do mapa com nova posição
              window.location.hash = `#${lat},${lng}`;
            }}
          />
        )}
      </div>

      {/* Painel de Camadas */}
      <LayersPanel projectId={projectId} />
      
      {/* Painel de Estados de Mapa Salvos */}
      {projectId && (
        <SavedMapsPanel
          projectId={projectId}
          currentViewMode={viewMode}
          currentCenter={{ lat: currentPosition.latitude, lon: currentPosition.longitude, height: currentPosition.altitude }}
          currentZoom={viewMode === "2d" ? 12 : undefined}
          onRestoreState={(state) => {
            setViewMode(state.viewMode);
            setCurrentPosition({
              latitude: state.center.lat,
              longitude: state.center.lon,
              altitude: state.center.height || 2,
            });
            if (onViewModeChange) {
              onViewModeChange(state.viewMode);
            }
          }}
        />
      )}
      
      {/* Info Badge */}
      <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur px-4 py-2 rounded-lg shadow-lg z-20">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-medium">
            Modo {viewMode === "3d" ? "3D" : "2D"} • {projectId ? `Projeto #${projectId}` : "Visão Global"}
          </span>
        </div>
      </div>
      
      {/* Modal de Salvamento de Geometria */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
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
                onChange={(e) => setShapeName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Descrição</Label>
              <Textarea
                id="description"
                placeholder="Descrição opcional da geometria"
                value={shapeDescription}
                onChange={(e) => setShapeDescription(e.target.value)}
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
                  onChange={(e) => setShapeColor(e.target.value)}
                  className="w-20 h-10"
                />
                <Input
                  type="text"
                  value={shapeColor}
                  onChange={(e) => setShapeColor(e.target.value)}
                  placeholder="#3b82f6"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setSaveDialogOpen(false);
              setCurrentShape(null);
              // Remover camada desenhada se cancelar
              if (currentShape?.layer) {
                currentShape.layer.remove();
              }
            }}>
              Cancelar
            </Button>
            <Button onClick={handleSaveGeometry} disabled={createGeometryMutation.isPending}>
              {createGeometryMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Exibir coordenadas UTM quando em modo 2D */}
      {viewMode === "2d" && mouseCoords && (
        <CoordinatesDisplay lat={mouseCoords.lat} lng={mouseCoords.lng} />
      )}
      
      {/* Modal de Importação de Geometrias */}
      {projectId && (
        <GeometryImport
          projectId={projectId}
          open={importDialogOpen}
          onOpenChange={setImportDialogOpen}
        />
      )}
      
      {/* Modal de Impressão de Mapa Técnico */}
      {projectId && (
        <MapPrintPreview
          projectId={projectId}
          projectName={projects?.find(p => p.id === projectId)?.name || `Projeto ${projectId}`}
          clientName={projects?.find(p => p.id === projectId)?.clientName || undefined}
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
  );
}
