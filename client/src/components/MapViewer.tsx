import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, X, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { toast } from "sonner";

interface MapViewerProps {
  fileUrl: string;
  fileName: string;
  fileType: "kml" | "kmz";
  isOpen: boolean;
  onClose: () => void;
}

export default function MapViewer({
  fileUrl,
  fileName,
  fileType,
  isOpen,
  onClose,
}: MapViewerProps) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !mapContainerRef.current) return;

    // Inicializar mapa
    if (!mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current, {
        center: [-15.7801, -47.9292], // Brasília (centro do Brasil)
        zoom: 4,
        zoomControl: false,
      });

      // Adicionar camada base
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(mapRef.current);

      // Adicionar controles de zoom customizados
      L.control.zoom({ position: "topright" }).addTo(mapRef.current);
    }

    // Carregar arquivo KML/KMZ
    loadGeospatialFile();

    return () => {
      // Limpar mapa ao fechar
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [isOpen, fileUrl]);

  const loadGeospatialFile = async () => {
    if (!mapRef.current) return;

    setIsLoading(true);
    setError(null);

    try {
      // Buscar arquivo
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error("Erro ao carregar arquivo");
      }

      const text = await response.text();

      // Parse KML (simplificado - em produção usar biblioteca como leaflet-omnivore)
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, "text/xml");

      // Verificar erros de parsing
      const parserError = xmlDoc.querySelector("parsererror");
      if (parserError) {
        throw new Error("Erro ao fazer parse do arquivo KML");
      }

      // Extrair coordenadas (simplificado)
      const placemarks = xmlDoc.querySelectorAll("Placemark");
      
      if (placemarks.length === 0) {
        throw new Error("Nenhuma geometria encontrada no arquivo");
      }

      const bounds = L.latLngBounds([]);
      let featuresAdded = 0;

      placemarks.forEach((placemark) => {
        const name = placemark.querySelector("name")?.textContent || "Sem nome";
        const description = placemark.querySelector("description")?.textContent || "";

        // Tentar extrair coordenadas de Point
        const pointCoords = placemark.querySelector("Point coordinates")?.textContent;
        if (pointCoords) {
          const [lng, lat] = pointCoords.trim().split(",").map(Number);
          if (!isNaN(lat) && !isNaN(lng)) {
            const marker = L.marker([lat, lng]).addTo(mapRef.current!);
            marker.bindPopup(`<b>${name}</b><br>${description}`);
            bounds.extend([lat, lng]);
            featuresAdded++;
          }
        }

        // Tentar extrair coordenadas de LineString
        const lineCoords = placemark.querySelector("LineString coordinates")?.textContent;
        if (lineCoords) {
          const coords = lineCoords
            .trim()
            .split(/\s+/)
            .map((coord) => {
              const [lng, lat] = coord.split(",").map(Number);
              return [lat, lng] as L.LatLngTuple;
            })
            .filter(([lat, lng]) => !isNaN(lat) && !isNaN(lng));

          if (coords.length > 0) {
            const polyline = L.polyline(coords, { color: "blue" }).addTo(mapRef.current!);
            polyline.bindPopup(`<b>${name}</b><br>${description}`);
            coords.forEach((coord) => bounds.extend(coord));
            featuresAdded++;
          }
        }

        // Tentar extrair coordenadas de Polygon
        const polygonCoords = placemark.querySelector("Polygon outerBoundaryIs LinearRing coordinates")?.textContent;
        if (polygonCoords) {
          const coords = polygonCoords
            .trim()
            .split(/\s+/)
            .map((coord) => {
              const [lng, lat] = coord.split(",").map(Number);
              return [lat, lng] as L.LatLngTuple;
            })
            .filter(([lat, lng]) => !isNaN(lat) && !isNaN(lng));

          if (coords.length > 0) {
            const polygon = L.polygon(coords, { color: "green", fillOpacity: 0.3 }).addTo(mapRef.current!);
            polygon.bindPopup(`<b>${name}</b><br>${description}`);
            coords.forEach((coord) => bounds.extend(coord));
            featuresAdded++;
          }
        }
      });

      if (featuresAdded === 0) {
        throw new Error("Não foi possível extrair geometrias válidas do arquivo");
      }

      // Ajustar zoom para mostrar todas as features
      if (bounds.isValid()) {
        mapRef.current!.fitBounds(bounds, { padding: [50, 50] });
      }

      toast.success(`${featuresAdded} geometria(s) carregada(s) com sucesso!`);
    } catch (err) {
      console.error("Erro ao carregar arquivo geoespacial:", err);
      setError(err instanceof Error ? err.message : "Erro desconhecido");
      toast.error("Erro ao carregar arquivo geoespacial");
    } finally {
      setIsLoading(false);
    }
  };

  const handleZoomIn = () => {
    if (mapRef.current) {
      mapRef.current.zoomIn();
    }
  };

  const handleZoomOut = () => {
    if (mapRef.current) {
      mapRef.current.zoomOut();
    }
  };

  const handleFitBounds = () => {
    if (mapRef.current) {
      const bounds = L.latLngBounds([]);
      mapRef.current.eachLayer((layer) => {
        if (layer instanceof L.Marker) {
          bounds.extend(layer.getLatLng());
        } else if (layer instanceof L.Polyline || layer instanceof L.Polygon) {
          bounds.extend(layer.getBounds());
        }
      });
      if (bounds.isValid()) {
        mapRef.current.fitBounds(bounds, { padding: [50, 50] });
      }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl h-[80vh] p-0">
        <DialogHeader className="p-6 pb-4">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl">{fileName}</DialogTitle>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="relative flex-1 h-full">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-slate-900 z-10">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-2" />
                <p className="text-sm text-slate-600 dark:text-slate-400">Carregando mapa...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-slate-900 z-10">
              <div className="text-center max-w-md p-6">
                <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
                <Button onClick={loadGeospatialFile}>Tentar Novamente</Button>
              </div>
            </div>
          )}

          <div ref={mapContainerRef} className="w-full h-full" />

          {/* Controles customizados */}
          {!isLoading && !error && (
            <div className="absolute bottom-6 right-6 flex flex-col gap-2 z-[1000]">
              <Button size="icon" variant="secondary" onClick={handleZoomIn} title="Aumentar zoom">
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="secondary" onClick={handleZoomOut} title="Diminuir zoom">
                <ZoomOut className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="secondary" onClick={handleFitBounds} title="Ajustar visualização">
                <Maximize2 className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
