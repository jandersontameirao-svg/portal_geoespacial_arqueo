import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { 
  Printer, 
  FileDown, 
  Map as MapIcon,
  Compass,
  Ruler,
  Grid3X3,
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowLeft
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

export default function TechnicalMaps() {
  const { user } = useAuth();
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [mapConfig, setMapConfig] = useState({
    name: "",
    title: "",
    subtitle: "",
    pageSize: "A3",
    orientation: "landscape",
    scale: "10000",
    templateType: "abnt_tecnico",
    showNorthArrow: true,
    showScaleBar: true,
    showLegend: true,
    showGrid: true,
    showFrame: true,
  });
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const errors = {
    project: !selectedProject && touched.project,
    name: !mapConfig.name && touched.name,
    title: !mapConfig.title && touched.title,
  };

  const isFormValid = selectedProject && mapConfig.name && mapConfig.title;

  // Queries
  const { data: projects } = trpc.projects.list.useQuery();
  const { data: printJobs, isLoading: jobsLoading, refetch: refetchJobs } = trpc.printJobs.list.useQuery(
    { projectId: parseInt(selectedProject) },
    { enabled: !!selectedProject && !isNaN(parseInt(selectedProject)) }
  );

  // Mutations
  const createJobMutation = trpc.printJobs.create.useMutation({
    onSuccess: () => {
      toast.success("Job de impressão criado com sucesso!");
      refetchJobs();
      setMapConfig(prev => ({ ...prev, name: "", title: "", subtitle: "" }));
    },
    onError: (error) => {
      toast.error(`Erro ao criar job: ${error.message}`);
    },
  });

  const handleCreateJob = () => {
    if (!selectedProject) {
      toast.error("Selecione um projeto");
      return;
    }
    if (!mapConfig.name) {
      toast.error("Informe o nome do job");
      return;
    }
    if (!mapConfig.title) {
      toast.error("Informe o título do mapa");
      return;
    }

    createJobMutation.mutate({
      projectId: parseInt(selectedProject),
      name: mapConfig.name,
      title: mapConfig.title,
      subtitle: mapConfig.subtitle || undefined,
      pageSize: mapConfig.pageSize as "A4" | "A3" | "A1" | "A0",
      orientation: mapConfig.orientation as "portrait" | "landscape",
      scale: parseInt(mapConfig.scale),
      templateType: mapConfig.templateType as "abnt_tecnico" | "cliente",
      showNorthArrow: mapConfig.showNorthArrow,
      showScaleBar: mapConfig.showScaleBar,
      showLegend: mapConfig.showLegend,
      showGrid: mapConfig.showGrid,
      showFrame: mapConfig.showFrame,
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
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Printer className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              Mapas Técnicos ABNT
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              Gere mapas técnicos padronizados com elementos cartográficos completos
            </p>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Formulário de Configuração */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapIcon className="w-5 h-5 text-blue-500" />
                  Configuração do Mapa
                </CardTitle>
                <CardDescription>
                  Configure os parâmetros do mapa técnico a ser gerado
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

                {/* Nome do Job */}
                <div className="space-y-2">
                  <Label className={errors.name ? "text-red-500" : ""}>Nome do Job *</Label>
                  <Input 
                    placeholder="Ex: Mapa de Localização - Versão 1"
                    value={mapConfig.name}
                    onChange={(e) => setMapConfig({ ...mapConfig, name: e.target.value })}
                    onBlur={() => setTouched(prev => ({ ...prev, name: true }))}
                    className={errors.name ? "border-red-500 focus:ring-red-500" : ""}
                  />
                  {errors.name && <p className="text-xs text-red-500">Nome do job é obrigatório</p>}
                </div>

                {/* Título e Subtítulo */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className={errors.title ? "text-red-500" : ""}>Título do Mapa *</Label>
                    <Input 
                      placeholder="Ex: Mapa de Localização"
                      value={mapConfig.title}
                      onChange={(e) => setMapConfig({ ...mapConfig, title: e.target.value })}
                      onBlur={() => setTouched(prev => ({ ...prev, title: true }))}
                      className={errors.title ? "border-red-500 focus:ring-red-500" : ""}
                    />
                    {errors.title && <p className="text-xs text-red-500">Título do mapa é obrigatório</p>}
                  </div>
                  <div className="space-y-2">
                    <Label>Subtítulo (opcional)</Label>
                    <Input 
                      placeholder="Ex: Área de Estudo"
                      value={mapConfig.subtitle}
                      onChange={(e) => setMapConfig({ ...mapConfig, subtitle: e.target.value })}
                    />
                  </div>
                </div>

                <Separator />

                {/* Configurações de Página */}
                <div className="grid md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Tamanho da Página</Label>
                    <Select value={mapConfig.pageSize} onValueChange={(v) => setMapConfig({ ...mapConfig, pageSize: v })}>
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
                    <Select value={mapConfig.orientation} onValueChange={(v) => setMapConfig({ ...mapConfig, orientation: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="landscape">Paisagem</SelectItem>
                        <SelectItem value="portrait">Retrato</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Escala</Label>
                    <Select value={mapConfig.scale} onValueChange={(v) => setMapConfig({ ...mapConfig, scale: v })}>
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
                        <SelectItem value="100000">1:100.000</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Separator />

                {/* Template */}
                <div className="space-y-2">
                  <Label>Template</Label>
                  <Select value={mapConfig.templateType} onValueChange={(v) => setMapConfig({ ...mapConfig, templateType: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="abnt_tecnico">ABNT Técnico (completo)</SelectItem>
                      <SelectItem value="cliente">Cliente (simplificado)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500">
                    O template ABNT Técnico inclui todos os elementos cartográficos obrigatórios.
                  </p>
                </div>

                <Separator />

                {/* Elementos do Mapa */}
                <div className="space-y-4">
                  <Label>Elementos do Mapa</Label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-2">
                        <Compass className="w-4 h-4 text-blue-500" />
                        <span className="text-sm">Norte</span>
                      </div>
                      <Switch 
                        checked={mapConfig.showNorthArrow}
                        onCheckedChange={(v) => setMapConfig({ ...mapConfig, showNorthArrow: v })}
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-2">
                        <Ruler className="w-4 h-4 text-green-500" />
                        <span className="text-sm">Escala</span>
                      </div>
                      <Switch 
                        checked={mapConfig.showScaleBar}
                        onCheckedChange={(v) => setMapConfig({ ...mapConfig, showScaleBar: v })}
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-purple-500" />
                        <span className="text-sm">Legenda</span>
                      </div>
                      <Switch 
                        checked={mapConfig.showLegend}
                        onCheckedChange={(v) => setMapConfig({ ...mapConfig, showLegend: v })}
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-2">
                        <Grid3X3 className="w-4 h-4 text-orange-500" />
                        <span className="text-sm">Grade UTM</span>
                      </div>
                      <Switch 
                        checked={mapConfig.showGrid}
                        onCheckedChange={(v) => setMapConfig({ ...mapConfig, showGrid: v })}
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-2">
                        <MapIcon className="w-4 h-4 text-slate-500" />
                        <span className="text-sm">Moldura</span>
                      </div>
                      <Switch 
                        checked={mapConfig.showFrame}
                        onCheckedChange={(v) => setMapConfig({ ...mapConfig, showFrame: v })}
                      />
                    </div>
                  </div>
                </div>

                {/* Botão de Gerar */}
                <Button 
                  onClick={handleCreateJob}
                  disabled={createJobMutation.isPending || !selectedProject || !mapConfig.name || !mapConfig.title}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                  size="lg"
                >
                  {createJobMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Printer className="w-4 h-4 mr-2" />
                  )}
                  Gerar Mapa Técnico
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Lista de Jobs */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-orange-500" />
                  Jobs Recentes
                </CardTitle>
                <CardDescription>
                  Mapas gerados recentemente
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!selectedProject ? (
                  <p className="text-sm text-slate-500 text-center py-8">
                    Selecione um projeto para ver os jobs
                  </p>
                ) : jobsLoading ? (
                  <div className="space-y-3">
                    {[1,2,3].map(i => (
                      <div key={i} className="h-20 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse"></div>
                    ))}
                  </div>
                ) : printJobs && printJobs.length > 0 ? (
                  <div className="space-y-3">
                    {printJobs.map((job) => (
                      <div key={job.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{job.name}</p>
                            <p className="text-xs text-slate-500">
                              {job.pageSize} • 1:{job.scale}
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
                    Nenhum mapa gerado ainda
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
