import { useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { Slider } from "./ui/slider";
import { ChevronRight, ChevronLeft, Layers, MapPin, Route, Square, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface LayersPanelProps {
  projectId?: number;
}

export default function LayersPanel({ projectId }: LayersPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  
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
              <CardTitle className="flex items-center gap-2 text-lg">
                <Layers className="w-5 h-5" />
                Camadas
              </CardTitle>
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
                          <span className="text-xs font-medium">{geometry.opacity}%</span>
                        </div>
                        <Slider
                          value={[geometry.opacity]}
                          onValueChange={([value]) => {
                            updateOpacityMutation.mutate({
                              id: geometry.id,
                              opacity: value,
                            });
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
