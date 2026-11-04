import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_BASEMAP } from "@/lib/basemaps";
import {
  createSafeKmlPopup,
  extractKmlFromKmz,
  KML_VIEW_LIMITS,
  parseKmlDocument,
  readResponseBytesLimited,
  type KmlMapFeature,
} from "@/lib/kml-file-viewer";

interface MapViewerProps {
  fileUrl: string;
  fileName: string;
  fileType: "kml" | "kmz";
  fileSizeBytes?: number;
  isOpen: boolean;
  onClose: () => void;
}

function createLeafletLayer(feature: KmlMapFeature): L.Layer {
  if (feature.kind === "marker") {
    return L.marker(feature.coordinates).bindPopup(createSafeKmlPopup(document, feature.name, feature.description));
  }
  if (feature.kind === "line") {
    return L.polyline(feature.coordinates, { color: "#2563eb", weight: 3 })
      .bindPopup(createSafeKmlPopup(document, feature.name, feature.description));
  }
  return L.polygon(feature.coordinates, { color: "#15803d", fillColor: "#22c55e", fillOpacity: 0.3, weight: 2 })
    .bindPopup(createSafeKmlPopup(document, feature.name, feature.description));
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("O arquivo KML não está codificado em UTF-8 válido.");
  }
}

export default function MapViewer({
  fileUrl,
  fileName,
  fileType,
  fileSizeBytes,
  isOpen,
  onClose,
}: MapViewerProps) {
  const mapRef = useRef<L.Map | null>(null);
  const [mapContainer, setMapContainer] = useState<HTMLDivElement | null>(null);
  const mapContainerRef = useCallback((node: HTMLDivElement | null) => setMapContainer(node), []);
  const loadedFeaturesRef = useRef<L.FeatureGroup | null>(null);
  const requestGenerationRef = useRef(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const container = mapContainer;
    if (!isOpen || !container) return;

    const requestGeneration = ++requestGenerationRef.current;
    const controller = new AbortController();
    const map = L.map(container, {
      center: [-15.7801, -47.9292],
      zoom: 4,
      zoomControl: false,
    });
    mapRef.current = map;
    loadedFeaturesRef.current = L.featureGroup().addTo(map);

    L.tileLayer(DEFAULT_BASEMAP.url!, {
      attribution: DEFAULT_BASEMAP.attribution,
      maxZoom: DEFAULT_BASEMAP.maxZoom ?? 19,
      crossOrigin: DEFAULT_BASEMAP.crossOrigin,
    }).addTo(map);
    L.control.zoom({ position: "topright" }).addTo(map);

    setIsLoading(true);
    setError(null);

    const isCurrentRequest = () =>
      requestGenerationRef.current === requestGeneration &&
      mapRef.current === map &&
      !controller.signal.aborted;

    const load = async () => {
      try {
        if (fileSizeBytes !== undefined && fileSizeBytes > KML_VIEW_LIMITS.maxArchiveBytes) {
          throw new Error(`Arquivo excede o limite de visualização de ${Math.floor(KML_VIEW_LIMITS.maxArchiveBytes / 1024 / 1024)} MB.`);
        }

        const response = await fetch(fileUrl, { signal: controller.signal });
        const bytes = await readResponseBytesLimited(response, KML_VIEW_LIMITS.maxArchiveBytes, controller.signal);
        const kmlText = fileType === "kmz"
          ? await extractKmlFromKmz(bytes, { signal: controller.signal })
          : decodeUtf8(bytes);
        if (!isCurrentRequest()) return;

        const features = parseKmlDocument(kmlText);
        if (!isCurrentRequest()) return;

        const renderedFeatures = L.featureGroup();
        const bounds = L.latLngBounds([]);
        for (const feature of features) {
          const layer = createLeafletLayer(feature);
          renderedFeatures.addLayer(layer);
          if (layer instanceof L.Marker) {
            bounds.extend(layer.getLatLng());
          } else if (layer instanceof L.Polyline) {
            bounds.extend(layer.getBounds());
          }
        }
        if (!bounds.isValid()) throw new Error("O KML não contém coordenadas válidas para enquadrar no mapa.");
        if (!isCurrentRequest()) return;

        if (loadedFeaturesRef.current) map.removeLayer(loadedFeaturesRef.current);
        renderedFeatures.addTo(map);
        loadedFeaturesRef.current = renderedFeatures;
        map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 });
        toast.success(`${features.length} geometria(s) carregada(s) com sucesso.`);
      } catch (cause) {
        if (!isCurrentRequest()) return;
        const message = cause instanceof Error ? cause.message : "Erro ao carregar arquivo geoespacial.";
        setError(message);
        toast.error("Erro ao carregar arquivo geoespacial", { description: message });
      } finally {
        if (isCurrentRequest()) setIsLoading(false);
      }
    };

    void load();

    return () => {
      controller.abort(new Error("Carga cancelada porque o arquivo ou o visualizador foi alterado."));
      if (requestGenerationRef.current === requestGeneration) requestGenerationRef.current += 1;
      if (mapRef.current === map) {
        map.remove();
        mapRef.current = null;
        loadedFeaturesRef.current = null;
      }
    };
  }, [fileUrl, fileName, fileType, fileSizeBytes, isOpen, mapContainer, retryToken]);

  const handleZoomIn = () => mapRef.current?.zoomIn();
  const handleZoomOut = () => mapRef.current?.zoomOut();
  const handleFitBounds = () => {
    const bounds = loadedFeaturesRef.current?.getBounds();
    if (bounds?.isValid()) mapRef.current?.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} className="flex h-[80vh] w-[calc(100vw-1rem)] max-w-5xl flex-col overflow-hidden p-0">
        <DialogHeader className="flex-row items-center justify-between p-4 pb-3 text-left sm:p-6 sm:pb-4">
          <DialogTitle className="min-w-0 truncate text-base sm:text-xl">{fileName}</DialogTitle>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar visualizador">
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        <div className="relative min-h-0 flex-1">
          {isLoading && (
            <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-slate-100/90 dark:bg-slate-900/90">
              <div className="text-center">
                <Loader2 className="mx-auto mb-2 h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-slate-600 dark:text-slate-400">Carregando mapa…</p>
              </div>
            </div>
          )}

          {error && !isLoading && (
            <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-slate-100/95 dark:bg-slate-900/95">
              <div className="max-w-md p-6 text-center">
                <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>
                <Button onClick={() => setRetryToken((current) => current + 1)}>Tentar novamente</Button>
              </div>
            </div>
          )}

          <div ref={mapContainerRef} className="h-full w-full" aria-label="Mapa do arquivo geoespacial" />

          {!isLoading && !error && (
            <div className="absolute bottom-4 right-4 z-[1000] flex flex-col gap-2 sm:bottom-6 sm:right-6">
              <Button size="icon" variant="secondary" onClick={handleZoomIn} title="Aumentar zoom" aria-label="Aumentar zoom">
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="secondary" onClick={handleZoomOut} title="Diminuir zoom" aria-label="Diminuir zoom">
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="secondary" onClick={handleFitBounds} title="Ajustar visualização" aria-label="Ajustar visualização">
                <Maximize2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
