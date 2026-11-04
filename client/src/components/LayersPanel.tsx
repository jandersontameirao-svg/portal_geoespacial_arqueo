import { useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { Slider } from "./ui/slider";
import { ChevronRight, ChevronLeft, Layers, MapPin, Route, Square, Trash2, Download } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { mimeForFilename } from "@/lib/exportMime";
import { toast } from "sonner";

interface LayersPanelProps {
  projectId?: number;
}

export default function LayersPanel({ projectId }: LayersPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Valor em arraste do slider de opacidade, por geometria. Dá feedback
  // instantâneo sem gravar no backend a cada passo (grava só ao soltar).
  const [opacityDraft, setOpacityDraft] = useState<Record<number, number>>({});

  // Buscar geometrias do projeto
  const { data: geometries, refetch } = trpc.geometries.list.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );
  
  // Mutations
  const updateVisibilityMutation = trpc.geometries.updateVisibility.useMutation({
    onSuccess: () => {
      refetch();
    },
  });
  
  const updateOpacityMutation = trpc.geometries.updateOpacity.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  const clearOpacityDraft = (id: number) =>
    setOpacityDraft((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });

  // Limite do servidor por exportação (geometriesRouter: max 500 ids).
  const EXPORT_LIMIT = 500;
  const exportGeometries = (format: "geojson" | "kml") => {
    if (!geometries || geometries.length === 0) return;
    const ids = geometries.slice(0, EXPORT_LIMIT).map((g) => g.id);
    if (geometries.length > EXPORT_LIMIT) {
      toast.warning(
        `Exportando as primeiras ${EXPORT_LIMIT} de ${geometries.length} geometrias (limite por exportação).`
      );
    }
    exportMutation.mutate({ geometryIds: ids, format });
  };
  
  const exportMutation = trpc.geometries.export.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([data.data], { type: mimeForFilename(data.filename) });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Exportação concluída!");
    },
    onError: () => {
      toast.error("Erro ao exportar geometrias");
    },
  });
  
  const deleteGeometryMutation = trpc.geometries.delete.useMutation({
    onSuccess: () => {
      toast.success("Geometria excluída");
      refetch();
    },
    onError: (error) => {
      toast.error(`Erro ao excluir: ${error.message}`);
    },
  });
  
  const getIcon = (type: string) => {
    switch (type) {
      case "marker":
        return <MapPin className="w-4 h-4" />;
      case "polyline":
        return <Route className="w-4 h-4" />;
      case "polygon":
        return <Square className="w-4 h-4" />;
      default:
        return <Layers className="w-4 h-4" />;
    }
  };
  
  const getTypeLabel = (type: string) => {
    switch (type) {
      case "marker":
        return "Ponto";
      case "polyline":
        return "Linha";
      case "polygon":
        return "Polígono";
      default:
        return type;
    }
  };
  
  if (!projectId) return null;
  
  return (
    <>
      {/* Botão Toggle */}
      <Button
        variant="secondary"
        size="icon"
        onClick={() => setIsOpen(!isOpen)}
        className="absolute top-4 right-4 z-20 bg-white/90 hover:bg-white shadow-lg"
        title={isOpen ? "Fechar painel de camadas" : "Abrir painel de camadas"}
      >
        {isOpen ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
      </Button>
      
      {/* Painel Lateral */}
      <aside
        className={`absolute top-0 right-0 bottom-0 w-80 border-l border-border bg-card/95 backdrop-blur-sm overflow-y-auto scrollbar-thin z-10 transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="p-4 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Layers className="w-5 h-5" />
                  Camadas
                </CardTitle>
                {geometries && geometries.length > 0 && (
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={exportMutation.isPending}
                      onClick={() => exportGeometries("geojson")}
                      title="Exportar como GeoJSON"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      GeoJSON
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={exportMutation.isPending}
                      onClick={() => exportGeometries("kml")}
                      title="Exportar como KML"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      KML
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!geometries || geometries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma geometria desenhada ainda
                </p>
              ) : (
                <div className="space-y-4">
                  {geometries.map((geometry) => (
                    <div
                      key={geometry.id}
                      className="p-3 rounded-lg border border-border bg-background/50 space-y-3"
                    >
                      {/* Header da Camada */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 flex-1 min-w-0">
                          <Checkbox
                            checked={geometry.visible === 1}
                            onCheckedChange={(checked) => {
                              updateVisibilityMutation.mutate({
                                id: geometry.id,
                                visible: checked ? 1 : 0,
                              });
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              {getIcon(geometry.type)}
                              <span className="font-medium text-sm truncate">
                                {geometry.name}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {getTypeLabel(geometry.type)}
                            </p>
                            {geometry.description && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                {geometry.description}
                              </p>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => {
                            if (confirm("Deseja realmente excluir esta geometria?")) {
                              deleteGeometryMutation.mutate({ id: geometry.id });
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                      
                      {/* Controle de Opacidade */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Opacidade</span>
                          <span className="text-xs font-medium">{opacityDraft[geometry.id] ?? geometry.opacity}%</span>
                        </div>
                        <Slider
                          value={[opacityDraft[geometry.id] ?? geometry.opacity]}
                          onValueChange={([value]) => {
                            setOpacityDraft((current) => ({ ...current, [geometry.id]: value }));
                          }}
                          onValueCommit={([value]) => {
                            clearOpacityDraft(geometry.id);
                            if (value !== geometry.opacity) {
                              updateOpacityMutation.mutate({ id: geometry.id, opacity: value });
                            }
                          }}
                          max={100}
                          step={10}
                          className="w-full"
                        />
                      </div>
                      
                      {/* Cor */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Cor:</span>
                        <div
                          className="w-6 h-6 rounded border border-border"
                          style={{ backgroundColor: geometry.color || "#3b82f6" }}
                        />
                        <span className="text-xs font-mono">{geometry.color}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </aside>
    </>
  );
}
