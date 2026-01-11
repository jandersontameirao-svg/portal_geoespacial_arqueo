import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Plus, MapPin, Users, Calendar, FileText, Trash2, Edit } from "lucide-react";
import { Link } from "wouter";

export default function Projects() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newProject, setNewProject] = useState({
    name: "",
    code: "",
    description: "",
    clientName: "",
    status: "active" as "active" | "archived" | "completed",
  });

  // Queries
  const { data: projects, isLoading, refetch } = trpc.projects.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // Mutations
  const createMutation = trpc.projects.create.useMutation({
    onSuccess: () => {
      toast.success("Projeto criado com sucesso!");
      setIsCreateDialogOpen(false);
      setNewProject({ name: "", code: "", description: "", clientName: "", status: "active" });
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao criar projeto");
    },
  });

  const handleCreateProject = () => {
    if (!newProject.name || !newProject.code) {
      toast.error("Nome e código são obrigatórios");
      return;
    }

    createMutation.mutate({
      name: newProject.name,
      code: newProject.code,
      description: newProject.description || undefined,
      clientName: newProject.clientName || undefined,
    });
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Acesso Restrito</CardTitle>
            <CardDescription>Você precisa estar autenticado para acessar esta página.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const canCreate = user?.role === "admin" || user?.role === "editor";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-50">Projetos</h1>
            <p className="text-slate-600 dark:text-slate-400 mt-2">
              Gerencie seus projetos geoespaciais
            </p>
          </div>

          {canCreate && (
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button size="lg" className="gap-2">
                  <Plus className="w-5 h-5" />
                  Novo Projeto
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                  <DialogTitle>Criar Novo Projeto</DialogTitle>
                  <DialogDescription>
                    Preencha as informações do projeto. Você poderá adicionar membros e arquivos depois.
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="name">Nome do Projeto *</Label>
                    <Input
                      id="name"
                      placeholder="Ex: Levantamento Topográfico - Área Industrial"
                      value={newProject.name}
                      onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="code">Código do Projeto *</Label>
                    <Input
                      id="code"
                      placeholder="Ex: TOPO-2025-001"
                      value={newProject.code}
                      onChange={(e) => setNewProject({ ...newProject, code: e.target.value })}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="clientName">Cliente</Label>
                    <Input
                      id="clientName"
                      placeholder="Nome do cliente"
                      value={newProject.clientName}
                      onChange={(e) => setNewProject({ ...newProject, clientName: e.target.value })}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="description">Descrição</Label>
                    <Textarea
                      id="description"
                      placeholder="Descreva o objetivo e escopo do projeto..."
                      rows={4}
                      value={newProject.description}
                      onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="status">Status</Label>
                    <Select
                      value={newProject.status}
                      onValueChange={(value: "active" | "archived" | "completed") =>
                        setNewProject({ ...newProject, status: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Ativo</SelectItem>
                        <SelectItem value="completed">Concluído</SelectItem>
                        <SelectItem value="archived">Arquivado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={handleCreateProject} disabled={createMutation.isPending}>
                    {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Criar Projeto
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {/* Lista de Projetos */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : projects && projects.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-xl mb-1">{project.name}</CardTitle>
                        <CardDescription className="font-mono text-xs">{project.code}</CardDescription>
                      </div>
                      <div
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          project.status === "active"
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : project.status === "completed"
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                            : "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400"
                        }`}
                      >
                        {project.status === "active" ? "Ativo" : project.status === "completed" ? "Concluído" : "Arquivado"}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {project.description && (
                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 line-clamp-2">
                        {project.description}
                      </p>
                    )}

                    {project.clientName && (
                      <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 mb-2">
                        <Users className="w-4 h-4" />
                        <span>{project.clientName}</span>
                      </div>
                    )}

                    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                      <Calendar className="w-4 h-4" />
                      <span>Criado em {new Date(project.createdAt).toLocaleDateString("pt-BR")}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <MapPin className="w-16 h-16 text-slate-300 dark:text-slate-700 mb-4" />
              <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-50 mb-2">
                Nenhum projeto encontrado
              </h3>
              <p className="text-slate-600 dark:text-slate-400 text-center mb-6">
                {canCreate
                  ? "Comece criando seu primeiro projeto geoespacial."
                  : "Você ainda não foi adicionado a nenhum projeto."}
              </p>
              {canCreate && (
                <Button onClick={() => setIsCreateDialogOpen(true)} className="gap-2">
                  <Plus className="w-5 h-5" />
                  Criar Primeiro Projeto
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
