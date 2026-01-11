import { useEffect, useRef, useState } from "react";
import { Viewer, Ion, Cartesian3, Math as CesiumMath, Terrain } from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { Button } from "./ui/button";
import { Globe, Map, Layers, ZoomIn, ZoomOut, Home } from "lucide-react";
import { Card } from "./ui/card";

// Configurar token do Cesium Ion (usar token gratuito)
Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlYWE1OWUxNy1mMWZiLTQzYjYtYTQ0OS1kMWFjYmFkNjc5YzciLCJpZCI6NTc3MzMsImlhdCI6MTYyNzg0NTE4Mn0.XcKpgANiY19MC4bdFUXMVEBToBmqS8kuYpUlxJHYZxk";

interface GlobeViewerProps {
  projectId?: number;
  initialPosition?: {
    latitude: number;
    longitude: number;
    height: number;
  };
  onViewModeChange?: (mode: "2d" | "3d") => void;
}

export default function GlobeViewer({ 
  projectId, 
  initialPosition = { latitude: -15.7801, longitude: -47.9292, height: 2000000 }, // Brasília
  onViewModeChange 
}: GlobeViewerProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const cesiumViewerRef = useRef<Viewer | null>(null);
  const [viewMode, setViewMode] = useState<"2d" | "3d">("3d");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!viewerRef.current) return;

    try {
      // Criar visualizador Cesium
      const viewer = new Viewer(viewerRef.current, {
        terrain: Terrain.fromWorldTerrain(),
        animation: false,
        baseLayerPicker: true,
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
        infoBox: true,
        sceneModePicker: false,
        selectionIndicator: true,
        timeline: false,
        navigationHelpButton: false,
        navigationInstructionsInitiallyVisible: false,
        scene3DOnly: false,
        shouldAnimate: false,
      });

      cesiumViewerRef.current = viewer;

      // Configurar posição inicial
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(
          initialPosition.longitude,
          initialPosition.latitude,
          initialPosition.height
        ),
      });

      // Habilitar iluminação baseada no sol
      viewer.scene.globe.enableLighting = true;

      setIsLoading(false);

      return () => {
        if (cesiumViewerRef.current) {
          cesiumViewerRef.current.destroy();
          cesiumViewerRef.current = null;
        }
      };
    } catch (error) {
      console.error("Erro ao inicializar Cesium:", error);
      setIsLoading(false);
    }
  }, []);

  const handleZoomIn = () => {
    if (!cesiumViewerRef.current) return;
    const camera = cesiumViewerRef.current.camera;
    camera.zoomIn(camera.positionCartographic.height * 0.5);
  };

  const handleZoomOut = () => {
    if (!cesiumViewerRef.current) return;
    const camera = cesiumViewerRef.current.camera;
    camera.zoomOut(camera.positionCartographic.height * 0.5);
  };

  const handleResetView = () => {
    if (!cesiumViewerRef.current) return;
    cesiumViewerRef.current.camera.flyTo({
      destination: Cartesian3.fromDegrees(
        initialPosition.longitude,
        initialPosition.latitude,
        initialPosition.height
      ),
      duration: 2,
    });
  };

  const handleToggleViewMode = () => {
    const newMode = viewMode === "3d" ? "2d" : "3d";
    setViewMode(newMode);
    onViewModeChange?.(newMode);

    if (!cesiumViewerRef.current) return;

    if (newMode === "2d") {
      cesiumViewerRef.current.scene.mode = 2; // SceneMode.SCENE2D
    } else {
      cesiumViewerRef.current.scene.mode = 3; // SceneMode.SCENE3D
    }
  };

  return (
    <div className="relative w-full h-full">
      {/* Visualizador Cesium */}
      <div ref={viewerRef} className="w-full h-full" />

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="text-center">
            <Globe className="w-12 h-12 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground">Carregando visualizador...</p>
          </div>
        </div>
      )}

      {/* Controles personalizados */}
      <Card className="absolute top-4 right-4 glass-panel p-2 space-y-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleToggleViewMode}
          title={viewMode === "3d" ? "Alternar para 2D" : "Alternar para 3D"}
        >
          {viewMode === "3d" ? <Map className="w-5 h-5" /> : <Globe className="w-5 h-5" />}
        </Button>
        
        <div className="border-t border-border" />
        
        <Button
          variant="ghost"
          size="icon"
          onClick={handleZoomIn}
          title="Aumentar zoom"
        >
          <ZoomIn className="w-5 h-5" />
        </Button>
        
        <Button
          variant="ghost"
          size="icon"
          onClick={handleZoomOut}
          title="Diminuir zoom"
        >
          <ZoomOut className="w-5 h-5" />
        </Button>
        
        <div className="border-t border-border" />
        
        <Button
          variant="ghost"
          size="icon"
          onClick={handleResetView}
          title="Resetar visualização"
        >
          <Home className="w-5 h-5" />
        </Button>
      </Card>

      {/* Informações do projeto */}
      {projectId && (
        <Card className="absolute bottom-4 left-4 glass-panel p-4">
          <p className="text-sm text-muted-foreground">
            Projeto ID: <span className="font-mono text-foreground">{projectId}</span>
          </p>
        </Card>
      )}
    </div>
  );
}
