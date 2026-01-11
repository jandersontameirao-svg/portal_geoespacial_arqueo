import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { 
  Globe, 
  FolderKanban, 
  FileText, 
  Map as MapIcon, 
  Clock, 
  Users,
  LogOut,
  Settings,
  Search
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import GlobeViewer from "@/components/GlobeViewer";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export default function Home() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");

  // Queries
  const { data: projects, isLoading: projectsLoading } = trpc.projects.list.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );

  const { data: recentLogs, isLoading: logsLoading } = trpc.audit.recent.useQuery(
    { limit: 10 },
    { enabled: isAuthenticated && user?.role === "admin" }
  );

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      window.location.href = "/";
    },
  });

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  // Se não estiver autenticado, mostrar página de login
  if (!loading && !isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-primary/10 via-background to-accent/10">
        <div className="text-center space-y-6 p-8">
          <div className="flex items-center justify-center mb-8">
            <Globe className="w-20 h-20 text-primary animate-pulse" />
          </div>
          
          <h1 className="text-4xl font-bold tracking-tight">
            Portal Geoespacial Corporativo
          </h1>
          
          <p className="text-xl text-muted-foreground max-w-2xl">
            Sistema de gerenciamento de projetos geoespaciais do Grupo Arqueo
          </p>

          <div className="pt-8">
            <Button size="lg" asChild className="gradient-header text-white">
              <a href={getLoginUrl()}>
                <Users className="w-5 h-5 mr-2" />
                Acessar Portal
              </a>
            </Button>
          </div>

          <p className="text-sm text-muted-foreground pt-4">
            Acesso restrito a usuários autorizados
          </p>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Globe className="w-12 h-12 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Main Content */}
      <div className="flex-1 relative">
        {/* Sidebar Retrátil com Painéis */}
        <aside className="absolute top-0 left-0 bottom-0 w-96 border-r border-border bg-card/95 backdrop-blur-sm overflow-y-auto scrollbar-thin z-10 transition-transform duration-300">
          <div className="p-6 space-y-6">
            {/* Painel: Meus Projetos */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FolderKanban className="w-5 h-5" />
                  Meus Projetos
                </CardTitle>
                <CardDescription>
                  {projects?.length || 0} projeto(s) ativo(s)
                </CardDescription>
              </CardHeader>
              <CardContent>
                {projectsLoading ? (
                  <p className="text-sm text-muted-foreground">Carregando...</p>
                ) : projects && projects.length > 0 ? (
                  <div className="space-y-2">
                    {projects.slice(0, 5).map((project) => (
                      <Link key={project.id} href={`/projects/${project.id}`}>
                        <div className="p-3 rounded-lg border border-border hover:bg-accent/50 transition-smooth cursor-pointer">
                          <p className="font-medium text-sm">{project.name}</p>
                          <p className="text-xs text-muted-foreground">{project.code}</p>
                        </div>
                      </Link>
                    ))}
                    {projects.length > 5 && (
                      <Button variant="link" size="sm" className="w-full" asChild>
                        <Link href="/projects">Ver todos os projetos →</Link>
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <FolderKanban className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mb-4">
                      Nenhum projeto encontrado
                    </p>
                    {(user?.role === "admin" || user?.role === "editor") && (
                      <Button size="sm" asChild>
                        <Link href="/projects/new">Criar Projeto</Link>
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Separator />

            {/* Painel: Atividades Recentes */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  Atividades Recentes
                </CardTitle>
                <CardDescription>
                  Últimas ações no sistema
                </CardDescription>
              </CardHeader>
              <CardContent>
                {logsLoading ? (
                  <p className="text-sm text-muted-foreground">Carregando...</p>
                ) : recentLogs && recentLogs.length > 0 ? (
                  <div className="space-y-3">
                    {recentLogs.slice(0, 5).map((log) => (
                      <div key={log.id} className="text-sm">
                        <p className="font-medium">{log.action}</p>
                        <p className="text-xs text-muted-foreground">
                          {log.userName || log.userEmail} • {new Date(log.timestamp).toLocaleString('pt-BR')}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Nenhuma atividade recente
                  </p>
                )}
              </CardContent>
            </Card>

            <Separator />

            {/* Painel: Mapas Gerados */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapIcon className="w-5 h-5" />
                  Mapas Gerados
                </CardTitle>
                <CardDescription>
                  Mapas técnicos e atlas
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum mapa gerado ainda
                </p>
              </CardContent>
            </Card>

            <Separator />

            {/* Painel: Ações Rápidas */}
            {(user?.role === "admin" || user?.role === "editor") && (
              <Card>
                <CardHeader>
                  <CardTitle>Ações Rápidas</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button variant="outline" className="w-full justify-start" asChild>
                    <Link href="/projects/new">
                      <FolderKanban className="w-4 h-4 mr-2" />
                      Novo Projeto
                    </Link>
                  </Button>
                  
                  <Button variant="outline" className="w-full justify-start" asChild>
                    <Link href="/files/upload">
                      <FileText className="w-4 h-4 mr-2" />
                      Upload de Arquivo
                    </Link>
                  </Button>

                  {user?.role === "admin" && (
                    <Button variant="outline" className="w-full justify-start" asChild>
                      <Link href="/admin/invitations">
                        <Users className="w-4 h-4 mr-2" />
                        Convidar Usuário
                      </Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </aside>

        {/* Visualizador Principal - Globo 3D (Tela Cheia) */}
        <main className="absolute inset-0">
          <GlobeViewer />
        </main>
      </div>
    </div>
  );
}
