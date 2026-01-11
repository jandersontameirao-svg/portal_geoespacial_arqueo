import { useEffect, useRef, useState } from "react";
import Globe from "react-globe.gl";
import { Button } from "./ui/button";
import { Globe as GlobeIcon, Map, Layers, ZoomIn, ZoomOut, Home, Maximize2 } from "lucide-react";

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
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950 z-10">
          <div className="text-center">
            <GlobeIcon className="w-12 h-12 animate-spin mx-auto mb-4 text-blue-500" />
            <p className="text-white">Carregando globo 3D...</p>
          </div>
        </div>
      )}

      <Globe
        ref={globeEl}
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
        width={window.innerWidth - 384} // Subtrair largura do sidebar
        height={window.innerHeight - 64} // Subtrair altura do header
        animateIn={true}
        waitForGlobeReady={true}
        onGlobeReady={() => setIsLoading(false)}
      />

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
