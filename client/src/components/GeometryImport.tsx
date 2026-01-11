import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Upload, FileText, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Alert, AlertDescription } from "./ui/alert";
import { MapContainer, TileLayer, Marker, Polyline, Polygon } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import JSZip from "jszip";

// Fix Leaflet default marker icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

interface GeometryImportProps {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ParsedGeometry {
  type: "marker" | "polyline" | "polygon";
  name: string;
  description?: string;
  coordinates: any;
  color?: string;
}

// Função auxiliar para calcular o centro das geometrias
function calculateCenter(geometries: ParsedGeometry[]): [number, number] {
  if (geometries.length === 0) return [-15.7801, -47.9292]; // Brasília como padrão

  let totalLat = 0;
  let totalLng = 0;
  let count = 0;

  geometries.forEach((geom) => {
    if (geom.type === "marker") {
      totalLat += geom.coordinates[1];
      totalLng += geom.coordinates[0];
      count++;
    } else if (geom.type === "polyline" || geom.type === "polygon") {
      geom.coordinates.forEach((coord: any) => {
        totalLat += coord[1];
        totalLng += coord[0];
        count++;
      });
    }
  });

  if (count === 0) return [-15.7801, -47.9292];
  return [totalLat / count, totalLng / count];
}

export default function GeometryImport({ projectId, open, onOpenChange }: GeometryImportProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedGeometries, setParsedGeometries] = useState<ParsedGeometry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const importBatchMutation = trpc.geometries.importBatch.useMutation({
    onSuccess: () => {
      toast.success(`${parsedGeometries.length} geometria(s) importada(s) com sucesso!`);
      utils.geometries.list.invalidate();
      handleClose();
    },
    onError: (error) => {
      toast.error(`Erro ao importar: ${error.message}`);
    },
  });

  const extractKMLFromKMZ = async (file: File): Promise<string | null> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);
      
      // Procurar arquivo .kml dentro do ZIP
      const kmlFileName = Object.keys(zip.files).find(name => 
        name.toLowerCase().endsWith('.kml') && !zip.files[name].dir
      );
      
      if (!kmlFileName) {
        toast.error('Nenhum arquivo KML encontrado dentro do KMZ');
        return null;
      }
      
      const kmlContent = await zip.files[kmlFileName].async('string');
      return kmlContent;
    } catch (error) {
      console.error('Erro ao extrair KMZ:', error);
      toast.error('Erro ao descompactar arquivo KMZ');
      return null;
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setError(null);
    setParsedGeometries([]);

    // Validar extensão
    const extension = selectedFile.name.split(".").pop()?.toLowerCase();
    if (!["kml", "kmz", "geojson", "json"].includes(extension || "")) {
      setError("Formato não suportado. Use KML, KMZ ou GeoJSON.");
      return;
    }

    // Validar tamanho (10MB)
    if (selectedFile.size > 10 * 1024 * 1024) {
      setError("Arquivo muito grande. Tamanho máximo: 10MB.");
      return;
    }

    setIsProcessing(true);

    try {
      const text = await selectedFile.text();
      let geometries: ParsedGeometry[] = [];

      if (extension === "geojson" || extension === "json") {
        geometries = parseGeoJSON(text);
      } else if (extension === "kml") {
        geometries = parseKML(text);
      } else if (extension === "kmz") {
        // Descompactar KMZ e extrair KML
        const kmlText = await extractKMLFromKMZ(selectedFile);
        if (!kmlText) {
          setError("Não foi possível extrair KML do arquivo KMZ.");
          setIsProcessing(false);
          return;
        }
        geometries = parseKML(kmlText);
      }

      if (geometries.length === 0) {
        setError("Nenhuma geometria encontrada no arquivo.");
      } else {
        setParsedGeometries(geometries);
      }
    } catch (err) {
      console.error("Erro ao processar arquivo:", err);
      setError("Erro ao processar arquivo. Verifique o formato.");
    } finally {
      setIsProcessing(false);
    }
  };

  const parseGeoJSON = (text: string): ParsedGeometry[] => {
    const geojson = JSON.parse(text);
    const geometries: ParsedGeometry[] = [];

    const processFeature = (feature: any, index: number) => {
      const geometry = feature.geometry;
      const properties = feature.properties || {};

      if (geometry.type === "Point") {
        geometries.push({
          type: "marker",
          name: properties.name || `Ponto ${index + 1}`,
          description: properties.description || "",
          coordinates: geometry.coordinates,
          color: properties.stroke || "#3b82f6",
        });
      } else if (geometry.type === "LineString") {
        geometries.push({
          type: "polyline",
          name: properties.name || `Linha ${index + 1}`,
          description: properties.description || "",
          coordinates: geometry.coordinates,
          color: properties.stroke || "#3b82f6",
        });
      } else if (geometry.type === "Polygon") {
        geometries.push({
          type: "polygon",
          name: properties.name || `Polígono ${index + 1}`,
          description: properties.description || "",
          coordinates: geometry.coordinates[0], // Primeiro anel
          color: properties.stroke || "#3b82f6",
        });
      }
    };

    if (geojson.type === "FeatureCollection") {
      geojson.features.forEach(processFeature);
    } else if (geojson.type === "Feature") {
      processFeature(geojson, 0);
    }

    return geometries;
  };

  const parseKML = (text: string): ParsedGeometry[] => {
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, "text/xml");
    const geometries: ParsedGeometry[] = [];

    // Buscar todos os Placemarks
    const placemarks = xml.getElementsByTagName("Placemark");

    for (let i = 0; i < placemarks.length; i++) {
      const placemark = placemarks[i];
      const name = placemark.getElementsByTagName("name")[0]?.textContent || `Feature ${i + 1}`;
      const description = placemark.getElementsByTagName("description")[0]?.textContent || "";

      // Buscar cor do estilo
      let color = "#3b82f6";
      const styleUrl = placemark.getElementsByTagName("styleUrl")[0]?.textContent;
      if (styleUrl) {
        const styleId = styleUrl.replace("#", "");
        const style = xml.getElementById(styleId);
        if (style) {
          const lineColor = style.getElementsByTagName("color")[0]?.textContent;
          if (lineColor) {
            // Converter KML color (aabbggrr) para hex (#rrggbb)
            color = `#${lineColor.slice(6, 8)}${lineColor.slice(4, 6)}${lineColor.slice(2, 4)}`;
          }
        }
      }

      // Point
      const point = placemark.getElementsByTagName("Point")[0];
      if (point) {
        const coords = point.getElementsByTagName("coordinates")[0]?.textContent?.trim();
        if (coords) {
          const [lng, lat] = coords.split(",").map(parseFloat);
          geometries.push({
            type: "marker",
            name,
            description,
            coordinates: [lng, lat],
            color,
          });
        }
      }

      // LineString
      const lineString = placemark.getElementsByTagName("LineString")[0];
      if (lineString) {
        const coords = lineString.getElementsByTagName("coordinates")[0]?.textContent?.trim();
        if (coords) {
          const points = coords.split(/\s+/).map((coord) => {
            const [lng, lat] = coord.split(",").map(parseFloat);
            return [lng, lat];
          });
          geometries.push({
            type: "polyline",
            name,
            description,
            coordinates: points,
            color,
          });
        }
      }

      // Polygon
      const polygon = placemark.getElementsByTagName("Polygon")[0];
      if (polygon) {
        const outerBoundary = polygon.getElementsByTagName("outerBoundaryIs")[0];
        if (outerBoundary) {
          const coords = outerBoundary.getElementsByTagName("coordinates")[0]?.textContent?.trim();
          if (coords) {
            const points = coords.split(/\s+/).map((coord) => {
              const [lng, lat] = coord.split(",").map(parseFloat);
              return [lng, lat];
            });
            geometries.push({
              type: "polygon",
              name,
              description,
              coordinates: points,
              color,
            });
          }
        }
      }
    }

    return geometries;
  };

  const handleImport = () => {
    if (parsedGeometries.length === 0) {
      toast.error("Nenhuma geometria para importar");
      return;
    }

    importBatchMutation.mutate({
      projectId,
      geometries: parsedGeometries.map((g) => ({
        type: g.type,
        name: g.name,
        description: g.description || "",
        coordinates: JSON.stringify(g.coordinates),
        color: g.color || "#3b82f6",
      })),
    });
  };

  const handleClose = () => {
    setFile(null);
    setParsedGeometries([]);
    setError(null);
    setIsProcessing(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar Geometrias</DialogTitle>
          <DialogDescription>
            Faça upload de arquivos KML ou GeoJSON para importar geometrias em lote.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Upload Area */}
          <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
            <input
              type="file"
              accept=".kml,.kmz,.geojson,.json"
              onChange={handleFileChange}
              className="hidden"
              id="geometry-file-input"
            />
            <label htmlFor="geometry-file-input" className="cursor-pointer">
              <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm font-medium mb-1">
                {file ? file.name : "Clique para selecionar arquivo"}
              </p>
              <p className="text-xs text-muted-foreground">
                KML, KMZ ou GeoJSON (máx. 10MB)
              </p>
            </label>
          </div>

          {/* Error Alert */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Processing */}
          {isProcessing && (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <span className="ml-3 text-sm text-muted-foreground">Processando arquivo...</span>
            </div>
          )}

          {/* Preview */}
          {parsedGeometries.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span>{parsedGeometries.length} geometria(s) encontrada(s)</span>
              </div>

              {/* Preview do Mapa */}
              <div className="border rounded-lg overflow-hidden mb-3">
                <MapContainer
                  center={calculateCenter(parsedGeometries)}
                  zoom={13}
                  style={{ height: "300px", width: "100%" }}
                  scrollWheelZoom={false}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  {parsedGeometries.map((geom, index) => {
                    if (geom.type === "marker") {
                      return (
                        <Marker
                          key={index}
                          position={[geom.coordinates[1], geom.coordinates[0]]}
                        />
                      );
                    } else if (geom.type === "polyline") {
                      return (
                        <Polyline
                          key={index}
                          positions={geom.coordinates.map((c: any) => [c[1], c[0]])}
                          color={geom.color}
                        />
                      );
                    } else if (geom.type === "polygon") {
                      return (
                        <Polygon
                          key={index}
                          positions={geom.coordinates.map((c: any) => [c[1], c[0]])}
                          color={geom.color}
                          fillColor={geom.color}
                          fillOpacity={0.2}
                        />
                      );
                    }
                    return null;
                  })}
                </MapContainer>
              </div>

              {/* Lista de Geometrias */}
              <div className="border rounded-lg divide-y max-h-60 overflow-y-auto">
                {parsedGeometries.map((geom, index) => (
                  <div key={index} className="p-3 flex items-start gap-3">
                    <FileText className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{geom.name}</p>
                      {geom.description && (
                        <p className="text-xs text-muted-foreground truncate">{geom.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs px-2 py-0.5 rounded bg-secondary">
                          {geom.type === "marker" && "Ponto"}
                          {geom.type === "polyline" && "Linha"}
                          {geom.type === "polygon" && "Polígono"}
                        </span>
                        <div
                          className="w-4 h-4 rounded border"
                          style={{ backgroundColor: geom.color }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleImport}
            disabled={parsedGeometries.length === 0 || importBatchMutation.isPending}
          >
            {importBatchMutation.isPending ? "Importando..." : `Importar ${parsedGeometries.length} geometria(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
