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
  ChevronLeft,
  ChevronRight,
  Layers,
  FileUp,
  Printer,
  BookOpen,
  Shield,
  Database,
  BarChart3,
  ArrowRight,
  Sparkles
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import GlobeViewer from "@/components/GlobeViewer";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Queries
  const { data: projects, isLoading: projectsLoading } = trpc.projects.list.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );

  const { data: recentLogs, isLoading: logsLoading } = trpc.audit.recent.useQuery(
    { limit: 10 },
    { enabled: isAuthenticated && user?.role === "admin" }
  );

  // Se não estiver autenticado, mostrar página de login elegante
  if (!loading && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiMyMDIwMjAiIGZpbGwtb3BhY2l0eT0iMC4xIj48cGF0aCBkPSJNMzYgMzRjMC0yLjIwOS0xLjc5MS00LTQtNHMtNCAxLjc5MS00IDQgMS43OTEgNCA0IDQgNC0xLjc5MSA0LTR6bTAtMThjMC0yLjIwOS0xLjc5MS00LTQtNHMtNCAxLjc5MS00IDQgMS43OTEgNCA0IDQgNC0xLjc5MSA0LTR6bTE4IDBjMC0yLjIwOS0xLjc5MS00LTQtNHMtNCAxLjc5MS00IDQgMS43OTEgNCA0IDQgNC0xLjc5MSA0LTR6Ii8+PC9nPjwvZz48L3N2Zz4=')] opacity-20"></div>
        
        {/* Gradient Orbs */}
        <div className="absolute top-20 left-20 w-96 h-96 bg-orange-500/20 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-20 right-20 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl animate-pulse delay-1000"></div>
        
        <div className="relative z-10 min-h-screen flex flex-col">
          {/* Hero Section */}
          <div className="flex-1 flex items-center justify-center px-4">
            <div className="max-w-4xl mx-auto text-center space-y-8">
              {/* Logo */}
              <div className="flex items-center justify-center mb-6">
                <div className="relative">
                  <div className="absolute inset-0 bg-orange-500/30 blur-2xl rounded-full"></div>
                  <img 
                    src="/grupo-arqueo-logo.webp" 
                    alt="Grupo Arqueo" 
                    className="relative w-24 h-24 object-contain"
                  />
                </div>
              </div>
              
              {/* Title */}
              <div className="space-y-4">
                <h1 className="text-5xl md:text-6xl font-bold text-white tracking-tight">
                  Portal Geoespacial
                  <span className="block text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-orange-600">
                    Corporativo
                  </span>
                </h1>
                
                <p className="text-xl md:text-2xl text-slate-300 max-w-2xl mx-auto">
                  Sistema completo de gerenciamento de projetos geoespaciais do Grupo Arqueo
                </p>
              </div>

              {/* Features Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto mt-12">
                {[
                  { icon: Globe, label: "Globo 3D" },
                  { icon: Layers, label: "Camadas" },
                  { icon: Printer, label: "Mapas ABNT" },
                  { icon: BookOpen, label: "Atlas" },
                ].map((feature, i) => (
                  <div key={i} className="flex flex-col items-center gap-2 p-4 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10">
                    <feature.icon className="w-8 h-8 text-orange-400" />
                    <span className="text-sm text-slate-300">{feature.label}</span>
                  </div>
                ))}
              </div>

              {/* CTA Button */}
              <div className="pt-8">
                <Button 
                  size="lg" 
                  asChild 
                  className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white shadow-lg shadow-orange-500/25 px-8 py-6 text-lg"
                >
                  <a href={getLoginUrl()}>
                    <Users className="w-5 h-5 mr-2" />
                    Acessar Portal
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </a>
                </Button>
              </div>

              <p className="text-sm text-slate-500">
                Acesso restrito a usuários autorizados
              </p>
            </div>
          </div>

          {/* Footer */}
          <footer className="py-6 text-center text-slate-500 text-sm">
            © {new Date().getFullYear()} Grupo Arqueo. Todos os direitos reservados.
          </footer>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="text-center space-y-4">
          <div className="relative">
            <Globe className="w-16 h-16 text-orange-500 animate-spin" />
            <div className="absolute inset-0 bg-orange-500/20 blur-xl rounded-full"></div>
          </div>
          <p className="text-slate-600 dark:text-slate-400 font-medium">Carregando portal...</p>
        </div>
      </div>
    );
  }

  // Dashboard autenticado
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900">
      {/* Main Content */}
      <div className="flex-1 relative">
        {/* Botão Toggle Sidebar */}
        <Button
          variant="secondary"
          size="icon"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="absolute top-4 left-4 z-20 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 shadow-lg border border-slate-200 dark:border-slate-700"
          title={sidebarOpen ? "Recolher painel" : "Expandir painel"}
        >
          {sidebarOpen ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
        </Button>

        {/* Sidebar Retrátil com Painéis */}
        <aside 
          data-tour="control-panel"
          className={`absolute top-0 left-0 bottom-0 w-[420px] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 overflow-y-auto scrollbar-thin z-10 transition-transform duration-300 shadow-xl ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="p-6 space-y-6 pt-16">
            {/* Header do Sidebar */}
            <div className="flex items-center gap-3 pb-2">
              <div className="p-2 rounded-lg bg-gradient-to-br from-orange-500 to-orange-600">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-white">Painel de Controle</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Bem-vindo, {user?.name?.split(' ')[0]}</p>
              </div>
            </div>

            <Separator />

            {/* Ferramentas Rápidas */}
            <div>
              <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                Ferramentas
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <Link href="/projects">
                  <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2 hover:bg-orange-50 dark:hover:bg-orange-950/20 hover:border-orange-300 dark:hover:border-orange-800 transition-all">
                    <FolderKanban className="w-6 h-6 text-orange-500" />
                    <span className="text-xs font-medium">Projetos</span>
                  </Button>
                </Link>
                <Link href="/technical-maps">
                  <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2 hover:bg-blue-50 dark:hover:bg-blue-950/20 hover:border-blue-300 dark:hover:border-blue-800 transition-all">
                    <Printer className="w-6 h-6 text-blue-500" />
                    <span className="text-xs font-medium">Mapas ABNT</span>
                  </Button>
                </Link>
                <Link href="/atlas">
                  <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2 hover:bg-green-50 dark:hover:bg-green-950/20 hover:border-green-300 dark:hover:border-green-800 transition-all">
                    <BookOpen className="w-6 h-6 text-green-500" />
                    <span className="text-xs font-medium">Atlas</span>
                  </Button>
                </Link>
                <Link href="/projects">
                  <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2 hover:bg-purple-50 dark:hover:bg-purple-950/20 hover:border-purple-300 dark:hover:border-purple-800 transition-all">
                    <FileUp className="w-6 h-6 text-purple-500" />
                    <span className="text-xs font-medium">Arquivos</span>
                  </Button>
                </Link>
              </div>
            </div>

            {/* Admin Tools */}
            {user?.role === "admin" && (
              <>
                <Separator />
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                    Administração
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <Link href="/admin">
                      <Button variant="outline" className="w-full h-auto py-3 flex-col gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all">
                        <BarChart3 className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                        <span className="text-xs">Dashboard</span>
                      </Button>
                    </Link>
                    <Link href="/admin/users">
                      <Button variant="outline" className="w-full h-auto py-3 flex-col gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all">
                        <Users className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                        <span className="text-xs">Usuários</span>
                      </Button>
                    </Link>
                    <Link href="/invitations">
                      <Button variant="outline" className="w-full h-auto py-3 flex-col gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all">
                        <FileText className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                        <span className="text-xs">Convites</span>
                      </Button>
                    </Link>
                    <Link href="/admin">
                      <Button variant="outline" className="w-full h-auto py-3 flex-col gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all">
                        <Database className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                        <span className="text-xs">Backups</span>
                      </Button>
                    </Link>
                  </div>
                </div>
              </>
            )}

            <Separator />

            {/* Painel: Meus Projetos */}
            <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FolderKanban className="w-5 h-5 text-orange-500" />
                  Meus Projetos
                </CardTitle>
                <CardDescription>
                  {projects?.length || 0} projeto(s) ativo(s)
                </CardDescription>
              </CardHeader>
              <CardContent>
                {projectsLoading ? (
                  <div className="space-y-2">
                    {[1,2,3].map(i => (
                      <div key={i} className="h-16 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse"></div>
                    ))}
                  </div>
                ) : projects && projects.length > 0 ? (
                  <div className="space-y-2">
                    {projects.slice(0, 5).map((project) => (
                      <Link key={project.id} href={`/projects/${project.id}`}>
                        <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-orange-300 dark:hover:border-orange-700 transition-all cursor-pointer group">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium text-sm text-slate-900 dark:text-white group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors">{project.name}</p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">{project.code}</p>
                            </div>
                            <Badge variant="outline" className="text-xs">
                              {project.status === 'active' ? 'Ativo' : project.status}
                            </Badge>
                          </div>
                        </div>
                      </Link>
                    ))}
                    {projects.length > 5 && (
                      <Button variant="ghost" size="sm" className="w-full text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300" asChild>
                        <Link href="/projects">
                          Ver todos os {projects.length} projetos
                          <ArrowRight className="w-4 h-4 ml-1" />
                        </Link>
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <FolderKanban className="w-10 h-10 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                      Nenhum projeto encontrado
                    </p>
                    {(user?.role === "admin" || user?.role === "editor") && (
                      <Button size="sm" className="bg-orange-500 hover:bg-orange-600" asChild>
                        <Link href="/projects">
                          Criar Projeto
                        </Link>
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Painel: Atividades Recentes */}
            {user?.role === "admin" && (
              <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Clock className="w-5 h-5 text-blue-500" />
                    Atividades Recentes
                  </CardTitle>
                  <CardDescription>
                    Últimas ações no sistema
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {logsLoading ? (
                    <div className="space-y-2">
                      {[1,2,3].map(i => (
                        <div key={i} className="h-12 bg-slate-100 dark:bg-slate-800 rounded animate-pulse"></div>
                      ))}
                    </div>
                  ) : recentLogs && recentLogs.length > 0 ? (
                    <div className="space-y-3">
                      {recentLogs.slice(0, 5).map((log) => (
                        <div key={log.id} className="flex items-start gap-3 text-sm">
                          <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 flex-shrink-0"></div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-slate-700 dark:text-slate-300 truncate">{log.action}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {log.userName || log.userEmail} • {new Date(log.timestamp).toLocaleString('pt-BR')}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">
                      Nenhuma atividade recente
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </aside>

        {/* Visualizador Principal - Globo 3D (Tela Cheia) */}
        <main className="absolute inset-0" data-tour="globe">
          <GlobeViewer />
        </main>
      </div>
    </div>
  );
}
