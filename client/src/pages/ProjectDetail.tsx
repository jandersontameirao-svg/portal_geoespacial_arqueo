import { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Users, FileText, History, Settings, UserPlus, Trash2, Upload, Download, Eye, Map, Sparkles } from "lucide-react";
import FileUpload from "@/components/FileUpload";
import FileList from "@/components/FileList";
import ProjectGeoWorkspace from "@/components/ProjectGeoWorkspace";
import { Link, useLocation, useParams, useSearch } from "wouter";

const projectTabs = new Set(["overview", "members", "files", "map", "history"]);

function tabFromLocation(location: string): string {
  const tab = new URLSearchParams(location.replace(/^\?/, "")).get("tab");
  return tab && projectTabs.has(tab) ? tab : "overview";
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id || "0");
  const { user, isAuthenticated } = useAuth();
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const [activeTab, setActiveTab] = useState(() => tabFromLocation(search));
  const [isAddMemberDialogOpen, setIsAddMemberDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedRole, setSelectedRole] = useState<"viewer" | "editor" | "owner">("viewer");

  useEffect(() => {
    setActiveTab(tabFromLocation(search));
  }, [search]);

  const canEdit = user?.role === "admin" || user?.role === "editor";
  const isMapWorkspace = activeTab === "map";

  // Queries
  const { data: project, isLoading: projectLoading, refetch: refetchProject } = trpc.projects.get.useQuery(
    { id: projectId },
    { enabled: isAuthenticated && projectId > 0 }
  );

  const { data: members, isLoading: membersLoading, refetch: refetchMembers } = trpc.projects.listMembers.useQuery(
    { projectId },
    { enabled: isAuthenticated && projectId > 0 }
  );

  const { data: activities, isLoading: activitiesLoading } = trpc.projects.getActivities.useQuery(
    { projectId },
    { enabled: isAuthenticated && projectId > 0 }
  );

  const { data: availableUsers } = trpc.users.list.useQuery(
    { search: "" },
    { enabled: isAuthenticated && canEdit }
  );

  // Mutations
  const addMemberMutation = trpc.projects.addMember.useMutation({
    onSuccess: () => {
      toast.success("Membro adicionado com sucesso!");
      setIsAddMemberDialogOpen(false);
      setSelectedUserId("");
      refetchMembers();
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao adicionar membro");
    },
  });

  const removeMemberMutation = trpc.projects.removeMember.useMutation({
    onSuccess: () => {
      toast.success("Membro removido com sucesso!");
      refetchMembers();
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao remover membro");
    },
  });

  const handleAddMember = () => {
    if (!selectedUserId) {
      toast.error("Selecione um usuário");
      return;
    }

    addMemberMutation.mutate({
      projectId,
      userId: parseInt(selectedUserId),
      role: selectedRole,
    });
  };

  const handleRemoveMember = (userId: number) => {
    if (confirm("Tem certeza que deseja remover este membro do projeto?")) {
      removeMemberMutation.mutate({
        projectId,
        userId,
      });
    }
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    const target = tab === "overview" ? `/projects/${projectId}` : `/projects/${projectId}?tab=${tab}`;
    if (location !== target) setLocation(target);
  };

  if (projectLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Projeto não encontrado</CardTitle>
            <CardDescription>O projeto que você está procurando não existe ou você não tem permissão para acessá-lo.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/projects">Voltar para Projetos</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={`${isMapWorkspace ? "h-[calc(100dvh-4rem)] overflow-hidden" : "min-h-screen"} bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900`}>
      <div className={`container ${isMapWorkspace ? "flex h-full min-h-0 flex-col py-3" : "py-8"}`}>
        {/* Header */}
        <div className={isMapWorkspace ? "mb-2 flex shrink-0 items-center justify-between gap-3" : "mb-6"}>
          <Button variant="ghost" size="sm" asChild className={isMapWorkspace ? "" : "mb-4"}>
            <Link href="/projects">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Voltar para Projetos
            </Link>
          </Button>

          <div className="flex min-w-0 items-start justify-between gap-3">
            <div>
              <h1 className={`${isMapWorkspace ? "truncate text-xl" : "text-4xl mb-2"} font-bold text-slate-900 dark:text-slate-50`}>{project.name}</h1>
              <div className={`flex items-center gap-3 ${isMapWorkspace ? "mt-1" : ""}`}>
                <Badge variant="outline" className="font-mono">{project.code}</Badge>
                <Badge
                  className={
                    project.status === "active"
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : project.status === "completed"
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                      : "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400"
                  }
                >
                  {project.status === "active" ? "Ativo" : project.status === "completed" ? "Concluído" : "Arquivado"}
                </Badge>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button variant="outline" asChild className="gap-2">
                <Link href={`/atena?projectId=${projectId}`}><Sparkles className="w-4 h-4" />Atena</Link>
              </Button>
            {canEdit && (
              <Button variant="outline" className="gap-2">
                <Settings className="w-4 h-4" />
                Configurações
              </Button>
            )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className={isMapWorkspace ? "flex min-h-0 flex-1 flex-col space-y-2" : "space-y-6"}>
          <TabsList className="grid w-full grid-cols-5 lg:w-auto">
            <TabsTrigger value="overview" className="gap-2">
              <FileText className="w-4 h-4" />
              Visão Geral
            </TabsTrigger>
            <TabsTrigger value="members" className="gap-2">
              <Users className="w-4 h-4" />
              Membros ({members?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="files" className="gap-2">
              <Upload className="w-4 h-4" />
              Arquivos
            </TabsTrigger>
            <TabsTrigger value="map" className="gap-2">
              <Map className="w-4 h-4" />
              Mapa & Análise
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="w-4 h-4" />
              Histórico
            </TabsTrigger>
          </TabsList>

          {/* Aba: Visão Geral */}
          <TabsContent value="overview" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Informações do Projeto</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {project.description && (
                  <div>
                    <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Descrição</h3>
                    <p className="text-slate-600 dark:text-slate-400">{project.description}</p>
                  </div>
                )}

                <Separator />

                <div className="grid gap-4 md:grid-cols-2">
                  {project.clientName && (
                    <div>
                      <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cliente</h3>
                      <p className="text-slate-900 dark:text-slate-50">{project.clientName}</p>
                    </div>
                  )}

                  <div>
                    <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Criado em</h3>
                    <p className="text-slate-900 dark:text-slate-50">
                      {new Date(project.createdAt).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "long",
                        year: "numeric",
                      })}
                    </p>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Última atualização</h3>
                    <p className="text-slate-900 dark:text-slate-50">
                      {new Date(project.updatedAt).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "long",
                        year: "numeric",
                      })}
                    </p>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Membros</h3>
                    <p className="text-slate-900 dark:text-slate-50">{members?.length || 0} membro(s)</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Aba: Membros */}
          <TabsContent value="members" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Membros da Equipe</CardTitle>
                    <CardDescription>Usuários com acesso a este projeto</CardDescription>
                  </div>

                  {canEdit && (
                    <Dialog open={isAddMemberDialogOpen} onOpenChange={setIsAddMemberDialogOpen}>
                      <DialogTrigger asChild>
                        <Button className="gap-2">
                          <UserPlus className="w-4 h-4" />
                          Adicionar Membro
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Adicionar Membro ao Projeto</DialogTitle>
                          <DialogDescription>
                            Selecione um usuário para dar acesso a este projeto.
                          </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4 py-4">
                          <div>
                            <label className="text-sm font-medium mb-2 block">Usuário</label>
                            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione um usuário" />
                              </SelectTrigger>
                              <SelectContent>
                                {availableUsers && availableUsers.length > 0 ? (
                                  availableUsers.map((u) => (
                                    <SelectItem key={u.id} value={u.id.toString()}>
                                      {u.name || u.email || `Usuário #${u.id}`}
                                    </SelectItem>
                                  ))
                                ) : (
                                  <SelectItem value="0" disabled>
                                    Nenhum usuário disponível
                                  </SelectItem>
                                )}
                              </SelectContent>
                            </Select>
                          </div>

                          <div>
                            <label className="text-sm font-medium mb-2 block">Permissão</label>
                            <Select value={selectedRole} onValueChange={(v: "viewer" | "editor" | "owner") => setSelectedRole(v)}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="viewer">Visualizador</SelectItem>
                                <SelectItem value="editor">Editor</SelectItem>
                                <SelectItem value="owner">Proprietário</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <DialogFooter>
                          <Button variant="outline" onClick={() => setIsAddMemberDialogOpen(false)}>
                            Cancelar
                          </Button>
                          <Button onClick={handleAddMember} disabled={addMemberMutation.isPending}>
                            {addMemberMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            Adicionar
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {membersLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : members && members.length > 0 ? (
                  <div className="space-y-3">
                    {members.map((member: any) => (
                      <div
                        key={member.userId}
                        className="flex items-center justify-between p-4 border rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/50"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <Users className="w-5 h-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium text-slate-900 dark:text-slate-50">
                              Usuário #{member.userId}
                            </p>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                              Adicionado em {new Date(member.addedAt).toLocaleDateString("pt-BR")}
                            </p>
                          </div>
                        </div>

                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => handleRemoveMember(member.userId)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Users className="w-12 h-12 text-slate-300 dark:text-slate-700 mx-auto mb-3" />
                    <p className="text-slate-600 dark:text-slate-400">Nenhum membro adicionado ainda</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Aba: Arquivos */}
          <TabsContent value="files" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Arquivos do Projeto</CardTitle>
                    <CardDescription>Documentos e dados geoespaciais</CardDescription>
                  </div>

                  {canEdit && (
                    <Button className="gap-2">
                      <Upload className="w-4 h-4" />
                      Upload de Arquivo
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <FileUpload
                  projectId={projectId}
                  onUploadComplete={() => {
                    toast.success("Arquivos enviados com sucesso!");
                    // Recarregar lista de arquivos
                    setTimeout(() => window.location.reload(), 1000);
                  }}
                />

                <div className="mt-8">
                  <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-4">Arquivos do Projeto</h3>
                  <FileList projectId={projectId} canEdit={canEdit} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="map" className={isMapWorkspace ? "mt-0 min-h-0 flex-1" : "space-y-6"}>
            <ProjectGeoWorkspace projectId={projectId} canEdit={canEdit} projectName={project.name} clientName={project.clientName || undefined} />
          </TabsContent>

          {/* Aba: Histórico */}
          <TabsContent value="history" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Histórico de Atividades</CardTitle>
                <CardDescription>Registro de todas as ações realizadas no projeto</CardDescription>
              </CardHeader>
              <CardContent>
                {activitiesLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : activities && activities.length > 0 ? (
                  <div className="space-y-4">
                    {activities.map((activity: any) => (
                      <div key={activity.id} className="flex gap-4 pb-4 border-b last:border-0">
                        <div className="w-2 h-2 rounded-full bg-primary mt-2" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-50">{activity.action}</p>
                          <p className="text-sm text-slate-600 dark:text-slate-400">
                            {activity.userName || activity.userEmail} •{" "}
                            {new Date(activity.timestamp).toLocaleString("pt-BR")}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <History className="w-12 h-12 text-slate-300 dark:text-slate-700 mx-auto mb-3" />
                    <p className="text-slate-600 dark:text-slate-400">Nenhuma atividade registrada</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
