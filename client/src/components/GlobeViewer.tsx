import { useEffect, useRef, useState } from "react";
import Globe from "react-globe.gl";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import { Button } from "./ui/button";
import { Globe as GlobeIcon, Map, Layers, ZoomIn, ZoomOut, Home, Maximize2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Fix Leaflet default marker icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

interface GlobeViewerProps {
  projectId?: number;
  initialPosition?: {
    latitude: number;
    longitude: number;
    altitude: number;
  };
  onViewModeChange?: (mode: "2d" | "3d") => void;
}

export default function GlobeViewer({ 
  projectId, 
  initialPosition = { latitude: -15.7801, longitude: -47.9292, altitude: 2 }, // Brasília
  onViewModeChange 
}: GlobeViewerProps) {
  const globeEl = useRef<any>(null);
  const [viewMode, setViewMode] = useState<"2d" | "3d">("3d");
  const [isLoading, setIsLoading] = useState(true);
  const [currentPosition, setCurrentPosition] = useState(initialPosition);
  
  // Buscar projetos do banco
  const { data: projects } = trpc.projects.list.useQuery();
  
  // Preparar dados dos marcadores (calcular centro do AOI)
  const markersData = projects?.filter(p => p.aoiBounds).map(p => {
    const bounds = p.aoiBounds!;
    const lat = (bounds.north + bounds.south) / 2;
    const lng = (bounds.east + bounds.west) / 2;
    return {
      lat,
      lng,
      size: 0.5,
      color: "#3b82f6",
      label: p.name,
      id: p.id,
      code: p.code
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
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {markersData.map((marker) => (
            <Marker key={marker.id} position={[marker.lat, marker.lng]}>
              <Popup>
                <div>
                  <strong>{marker.label}</strong><br/>
                  <span style={{ color: "#64748b", fontSize: "12px" }}>{marker.code}</span><br/>
                  <Link href={`/projects/${marker.id}`}>
                    <a style={{ color: "#3b82f6", textDecoration: "underline" }}>Ver projeto</a>
                  </Link>
                </div>
              </Popup>
            </Marker>
          ))}
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

        {/* Fullscreen (placeholder) */}
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
      </div>

      {/* Info Badge */}
      <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur px-4 py-2 rounded-lg shadow-lg z-20">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-medium">
            Modo {viewMode === "3d" ? "3D" : "2D"} • {projectId ? `Projeto #${projectId}` : "Visão Global"}
          </span>
        </div>
      </div>
    </div>
  );
}
