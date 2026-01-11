import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Bookmark, Save, Trash2, Eye, MoreVertical, Plus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface SavedMapsPanelProps {
  projectId: number;
  currentViewMode: "2d" | "3d";
  currentCenter: { lat: number; lon: number; height?: number };
  currentZoom?: number;
  currentHeading?: number;
  currentPitch?: number;
  activeLayers?: Array<{ layerId: number; opacity: number; zIndex: number }>;
  basemap?: string;
  onRestoreState: (state: {
    viewMode: "2d" | "3d";
    center: { lat: number; lon: number; height?: number };
    zoom?: number;
    heading?: number;
    pitch?: number;
    activeLayers?: Array<{ layerId: number; opacity: number; zIndex: number }>;
    basemap?: string;
  }) => void;
}

export default function SavedMapsPanel({
  projectId,
  currentViewMode,
  currentCenter,
  currentZoom,
  currentHeading,
  currentPitch,
  activeLayers,
  basemap,
  onRestoreState,
}: SavedMapsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const { data: savedMaps, refetch } = trpc.savedMaps.list.useQuery({ projectId });

  const createMutation = trpc.savedMaps.create.useMutation({
    onSuccess: () => {
      toast.success("Estado do mapa salvo com sucesso!");
      setSaveDialogOpen(false);
      setName("");
      setDescription("");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao salvar estado do mapa");
    },
  });

  const deleteMutation = trpc.savedMaps.delete.useMutation({
    onSuccess: () => {
      toast.success("Estado do mapa excluído");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao excluir");
    },
  });

  const handleSave = () => {
    if (!name.trim()) {
      toast.error("Digite um nome para o estado do mapa");
      return;
    }

    createMutation.mutate({
      projectId,
      name: name.trim(),
      description: description.trim() || undefined,
      viewMode: currentViewMode,
      center: currentCenter,
      zoom: currentZoom,
      heading: currentHeading,
      pitch: currentPitch,
      activeLayers,
      basemap,
    });
  };

  const handleRestore = (savedMap: any) => {
    onRestoreState({
      viewMode: savedMap.viewMode,
      center: savedMap.center,
      zoom: savedMap.zoom ? parseFloat(savedMap.zoom) : undefined,
      heading: savedMap.heading ? parseFloat(savedMap.heading) : undefined,
      pitch: savedMap.pitch ? parseFloat(savedMap.pitch) : undefined,
      activeLayers: savedMap.activeLayers,
      basemap: savedMap.basemap,
    });
    toast.success(`Estado "${savedMap.name}" restaurado`);
    setIsOpen(false);
  };

  const handleDelete = (id: number) => {
    if (confirm("Tem certeza que deseja excluir este estado salvo?")) {
      deleteMutation.mutate({ id });
    }
  };

  return (
    <>
      {/* Botão de Toggle do Painel */}
      <div className="absolute top-4 right-4 z-30">
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              className="bg-white/90 hover:bg-white shadow-lg"
              title="Estados de Mapa Salvos"
            >
              <Bookmark className="w-5 h-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <div className="px-2 py-2 border-b">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">Estados Salvos</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setIsOpen(false);
                    setSaveDialogOpen(true);
                  }}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Salvar Atual
                </Button>
              </div>
            </div>

            {savedMaps && savedMaps.length > 0 ? (
              <div className="max-h-64 overflow-y-auto">
                {savedMaps.map((map) => (
                  <div
                    key={map.id}
                    className="flex items-center justify-between px-2 py-2 hover:bg-gray-100"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{map.name}</div>
                      {map.description && (
                        <div className="text-xs text-gray-500 truncate">{map.description}</div>
                      )}
                      <div className="text-xs text-gray-400">
                        {map.viewMode.toUpperCase()} •{" "}
                        {new Date(map.createdAt).toLocaleDateString("pt-BR")}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => handleRestore(map)}
                        title="Restaurar"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-red-500 hover:text-red-600"
                        onClick={() => handleDelete(map.id)}
                        title="Excluir"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-6 text-center text-sm text-gray-500">
                Nenhum estado salvo.
                <br />
                Clique em "Salvar Atual" para criar um.
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Dialog de Salvar Estado */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Salvar Estado do Mapa</DialogTitle>
            <DialogDescription>
              Salve a configuração atual do mapa para restaurar depois
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Vista da área de escavação"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Descrição</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descrição opcional..."
                rows={3}
              />
            </div>
            <div className="bg-gray-50 p-3 rounded-lg text-sm">
              <div className="font-medium mb-2">Será salvo:</div>
              <ul className="text-gray-600 space-y-1">
                <li>• Modo de visualização: {currentViewMode.toUpperCase()}</li>
                <li>• Posição central: {currentCenter.lat.toFixed(4)}, {currentCenter.lon.toFixed(4)}</li>
                {currentZoom && <li>• Nível de zoom: {currentZoom.toFixed(1)}</li>}
                {activeLayers && <li>• {activeLayers.length} camadas ativas</li>}
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={createMutation.isPending}>
              <Save className="w-4 h-4 mr-2" />
              {createMutation.isPending ? "Salvando..." : "Salvar Estado"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
