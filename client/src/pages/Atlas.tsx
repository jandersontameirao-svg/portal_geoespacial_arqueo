import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { 
  BookOpen, 
  FileDown, 
  Grid3X3,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowLeft,
  Layers,
  Map as MapIcon
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export default function Atlas() {
  const { user } = useAuth();
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [atlasConfig, setAtlasConfig] = useState({
    name: "",
    title: "",
    pageSize: "A3",
    orientation: "landscape",
    scale: "10000",
    overlap: "0.1",
    templateType: "abnt_tecnico",
    // Default bounds (Brasil central)
    bounds: {
      north: -10,
      south: -25,
      east: -40,
      west: -55,
    },
  });
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const errors = {
    project: !selectedProject && touched.project,
    name: !atlasConfig.name && touched.name,
    title: !atlasConfig.title && touched.title,
  };

  const isFormValid = selectedProject && atlasConfig.name && atlasConfig.title;

  // Queries
  const { data: projects } = trpc.projects.list.useQuery();
  const { data: atlasJobs, isLoading: jobsLoading, refetch: refetchJobs } = trpc.atlas.list.useQuery(
    { projectId: parseInt(selectedProject) },
    { enabled: !!selectedProject && !isNaN(parseInt(selectedProject)) }
  );

  // Mutations
  const createAtlasMutation = trpc.atlas.create.useMutation({
    onSuccess: (data) => {
      toast.success(`Atlas criado com sucesso! ${data.grid.totalPages} páginas serão geradas.`);
      refetchJobs();
      setAtlasConfig(prev => ({ ...prev, name: "", title: "" }));
    },
    onError: (error) => {
      toast.error(`Erro ao criar atlas: ${error.message}`);
    },
  });

  const handleCreateAtlas = () => {
    if (!selectedProject) {
      toast.error("Selecione um projeto");
      return;
    }
    if (!atlasConfig.name) {
      toast.error("Informe o nome do atlas");
      return;
    }
    if (!atlasConfig.title) {
      toast.error("Informe o título do atlas");
      return;
    }

    createAtlasMutation.mutate({
      projectId: parseInt(selectedProject),
      name: atlasConfig.name,
      title: atlasConfig.title,
      pageSize: atlasConfig.pageSize as "A4" | "A3" | "A1" | "A0",
      orientation: atlasConfig.orientation as "portrait" | "landscape",
      scale: parseInt(atlasConfig.scale),
      overlap: parseFloat(atlasConfig.overlap),
      templateType: atlasConfig.templateType as "abnt_tecnico" | "cliente",
      bounds: atlasConfig.bounds,
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"><CheckCircle2 className="w-3 h-3 mr-1" />Concluído</Badge>;
      case "processing":
        return <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Processando</Badge>;
      case "pending":
        return <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"><Clock className="w-3 h-3 mr-1" />Pendente</Badge>;
      case "failed":
        return <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"><AlertCircle className="w-3 h-3 mr-1" />Falhou</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <div className="container py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <BookOpen className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              Atlas Automático
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              Gere atlas multipágina com grid automático e numeração sequencial
            </p>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Formulário de Configuração */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Grid3X3 className="w-5 h-5 text-green-500" />
                  Configuração do Atlas
                </CardTitle>
                <CardDescription>
                  Configure os parâmetros do atlas a ser gerado
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Projeto */}
                <div className="space-y-2">
                  <Label className={errors.project ? "text-red-500" : ""}>Projeto *</Label>
                  <Select 
                    value={selectedProject} 
                    onValueChange={setSelectedProject}
                    onOpenChange={() => setTouched(prev => ({ ...prev, project: true }))}
                  >
                    <SelectTrigger className={errors.project ? "border-red-500 focus:ring-red-500" : ""}>
                      <SelectValue placeholder="Selecione um projeto" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects?.map((project) => (
                        <SelectItem key={project.id} value={project.id.toString()}>
                          {project.name} ({project.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Nome e Título */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className={errors.name ? "text-red-500" : ""}>Nome do Atlas *</Label>
                    <Input 
                      placeholder="Ex: Atlas de Localização - Área Norte"
                      value={atlasConfig.name}
                      onChange={(e) => setAtlasConfig({ ...atlasConfig, name: e.target.value })}
                      onBlur={() => setTouched(prev => ({ ...prev, name: true }))}
                      className={errors.name ? "border-red-500 focus:ring-red-500" : ""}
                    />
                    {errors.name && <p className="text-xs text-red-500">Nome do atlas é obrigatório</p>}
                  </div>
                  <div className="space-y-2">
                    <Label className={errors.title ? "text-red-500" : ""}>Título *</Label>
                    <Input 
                      placeholder="Ex: Atlas de Localização"
                      value={atlasConfig.title}
                      onChange={(e) => setAtlasConfig({ ...atlasConfig, title: e.target.value })}
                      onBlur={() => setTouched(prev => ({ ...prev, title: true }))}
                      className={errors.title ? "border-red-500 focus:ring-red-500" : ""}
                    />
                    {errors.title && <p className="text-xs text-red-500">Título do atlas é obrigatório</p>}
                  </div>
                </div>

                <Separator />

                {/* Configurações de Página */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Tamanho da Página</Label>
                    <Select value={atlasConfig.pageSize} onValueChange={(v) => setAtlasConfig({ ...atlasConfig, pageSize: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="A4">A4 (210 × 297 mm)</SelectItem>
                        <SelectItem value="A3">A3 (297 × 420 mm)</SelectItem>
                        <SelectItem value="A1">A1 (594 × 841 mm)</SelectItem>
                        <SelectItem value="A0">A0 (841 × 1189 mm)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Orientação</Label>
                    <Select value={atlasConfig.orientation} onValueChange={(v) => setAtlasConfig({ ...atlasConfig, orientation: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="landscape">Paisagem</SelectItem>
                        <SelectItem value="portrait">Retrato</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Escala</Label>
                    <Select value={atlasConfig.scale} onValueChange={(v) => setAtlasConfig({ ...atlasConfig, scale: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1000">1:1.000</SelectItem>
                        <SelectItem value="2500">1:2.500</SelectItem>
                        <SelectItem value="5000">1:5.000</SelectItem>
                        <SelectItem value="10000">1:10.000</SelectItem>
                        <SelectItem value="25000">1:25.000</SelectItem>
                        <SelectItem value="50000">1:50.000</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Sobreposição</Label>
                    <Select value={atlasConfig.overlap} onValueChange={(v) => setAtlasConfig({ ...atlasConfig, overlap: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0.05">5%</SelectItem>
                        <SelectItem value="0.1">10%</SelectItem>
                        <SelectItem value="0.15">15%</SelectItem>
                        <SelectItem value="0.2">20%</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Template</Label>
                    <Select value={atlasConfig.templateType} onValueChange={(v) => setAtlasConfig({ ...atlasConfig, templateType: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="abnt_tecnico">ABNT Técnico</SelectItem>
                        <SelectItem value="cliente">Cliente</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Separator />

                {/* Área de Cobertura */}
                <div className="space-y-4">
                  <Label>Área de Cobertura (Coordenadas)</Label>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs text-slate-500">Norte (Lat)</Label>
                      <Input 
                        type="number"
                        step="0.0001"
                        value={atlasConfig.bounds.north}
                        onChange={(e) => setAtlasConfig({ 
                          ...atlasConfig, 
                          bounds: { ...atlasConfig.bounds, north: parseFloat(e.target.value) || 0 }
                        })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-slate-500">Sul (Lat)</Label>
                      <Input 
                        type="number"
                        step="0.0001"
                        value={atlasConfig.bounds.south}
                        onChange={(e) => setAtlasConfig({ 
                          ...atlasConfig, 
                          bounds: { ...atlasConfig.bounds, south: parseFloat(e.target.value) || 0 }
                        })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-slate-500">Leste (Lon)</Label>
                      <Input 
                        type="number"
                        step="0.0001"
                        value={atlasConfig.bounds.east}
                        onChange={(e) => setAtlasConfig({ 
                          ...atlasConfig, 
                          bounds: { ...atlasConfig.bounds, east: parseFloat(e.target.value) || 0 }
                        })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-slate-500">Oeste (Lon)</Label>
                      <Input 
                        type="number"
                        step="0.0001"
                        value={atlasConfig.bounds.west}
                        onChange={(e) => setAtlasConfig({ 
                          ...atlasConfig, 
                          bounds: { ...atlasConfig.bounds, west: parseFloat(e.target.value) || 0 }
                        })}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">
                    Defina a área de cobertura do atlas em coordenadas geográficas (WGS84)
                  </p>
                </div>

                {/* Botão de Gerar */}
                <Button 
                  onClick={handleCreateAtlas}
                  disabled={createAtlasMutation.isPending || !selectedProject || !atlasConfig.name || !atlasConfig.title}
                  className="w-full bg-green-600 hover:bg-green-700"
                  size="lg"
                >
                  {createAtlasMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <BookOpen className="w-4 h-4 mr-2" />
                  )}
                  Gerar Atlas
                </Button>
              </CardContent>
            </Card>

            {/* Info Card */}
            <Card className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900">
              <CardContent className="pt-6">
                <div className="flex gap-4">
                  <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30 h-fit">
                    <Layers className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-green-800 dark:text-green-300">Como funciona o Atlas Automático</h3>
                    <p className="text-sm text-green-700 dark:text-green-400 mt-1">
                      O sistema calcula automaticamente o grid de páginas necessário para cobrir toda a área definida, 
                      gerando um PDF multipágina com numeração sequencial (01/N, 02/N, etc.) e mapa índice na primeira página.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Lista de Atlas */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-orange-500" />
                  Atlas Recentes
                </CardTitle>
                <CardDescription>
                  Atlas gerados recentemente
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!selectedProject ? (
                  <p className="text-sm text-slate-500 text-center py-8">
                    Selecione um projeto para ver os atlas
                  </p>
                ) : jobsLoading ? (
                  <div className="space-y-3">
                    {[1,2,3].map(i => (
                      <div key={i} className="h-20 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse"></div>
                    ))}
                  </div>
                ) : atlasJobs && atlasJobs.length > 0 ? (
                  <div className="space-y-3">
                    {atlasJobs.map((job) => (
                      <div key={job.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{job.name}</p>
                            <p className="text-xs text-slate-500">
                              {job.pageSize} • 1:{job.scale} • {(job.gridConfig as any)?.totalPages || "?"} páginas
                            </p>
                          </div>
                          {getStatusBadge(job.status)}
                        </div>
                        {job.status === "completed" && job.outputUrl && (
                          <Button variant="outline" size="sm" className="w-full mt-2" asChild>
                            <a href={job.outputUrl} target="_blank" rel="noopener noreferrer">
                              <FileDown className="w-4 h-4 mr-1" />
                              Baixar PDF
                            </a>
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 text-center py-8">
                    Nenhum atlas gerado ainda
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
