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
  Sparkles,
  PanelLeftClose,
  PanelLeft
} from "lucide-react";
import { useState, useEffect } from "react";
import { Link } from "wouter";
import GlobeViewer from "@/components/GlobeViewer";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  
  // Carregar preferência do localStorage
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const saved = localStorage.getItem("sidebar-open");
    return saved !== null ? JSON.parse(saved) : true;
  });
  
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    return saved !== null ? JSON.parse(saved) : false;
  });

  // Salvar preferências no localStorage
  useEffect(() => {
    localStorage.setItem("sidebar-open", JSON.stringify(sidebarOpen));
  }, [sidebarOpen]);

  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", JSON.stringify(sidebarCollapsed));
  }, [sidebarCollapsed]);

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

              {/* CTA */}
              <div className="pt-8">
                <Button 
                  size="lg" 
                  className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white px-8 py-6 text-lg shadow-lg shadow-orange-500/25"
                  asChild
                >
                  <a href={getLoginUrl()}>
                    Acessar Sistema
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </a>
                </Button>
              </div>
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

  // Largura do sidebar baseada no estado
  const sidebarWidth = sidebarCollapsed ? "w-16" : "w-72";

  // Dashboard autenticado
  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900">
        {/* Main Content */}
        <div className="flex-1 relative">
          {/* Botão Toggle Sidebar (mostrar/ocultar completamente) */}
          {!sidebarOpen && (
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setSidebarOpen(true)}
              className="absolute top-4 left-4 z-20 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 shadow-lg border border-slate-200 dark:border-slate-700"
              title="Mostrar painel"
            >
              <PanelLeft className="w-4 h-4" />
            </Button>
          )}

          {/* Sidebar Compacto */}
          <aside 
            data-tour="control-panel"
            className={`absolute top-0 left-0 bottom-0 ${sidebarWidth} bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 overflow-y-auto scrollbar-thin z-10 transition-all duration-300 shadow-lg ${
              sidebarOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <div className={`${sidebarCollapsed ? "p-2" : "p-4"} space-y-4`}>
              {/* Header do Sidebar com botões de controle */}
              <div className={`flex items-center ${sidebarCollapsed ? "justify-center" : "justify-between"} pb-2`}>
                {!sidebarCollapsed && (
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-gradient-to-br from-orange-500 to-orange-600">
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-sm text-slate-900 dark:text-white">Painel</h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[120px]">
                        {user?.name?.split(' ')[0]}
                      </p>
                    </div>
                  </div>
                )}
                
                <div className="flex gap-1">
                  {/* Botão Colapsar/Expandir */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                        className="h-7 w-7"
                      >
                        {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {sidebarCollapsed ? "Expandir" : "Compactar"}
                    </TooltipContent>
                  </Tooltip>
                  
                  {/* Botão Fechar */}
                  {!sidebarCollapsed && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setSidebarOpen(false)}
                          className="h-7 w-7"
                        >
                          <PanelLeftClose className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        Fechar painel
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>

              {!sidebarCollapsed && <Separator />}

              {/* Ferramentas Rápidas */}
              <div>
                {!sidebarCollapsed && (
                  <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                    Ferramentas
                  </h3>
                )}
                <div className={`${sidebarCollapsed ? "space-y-2" : "grid grid-cols-2 gap-1.5"}`}>
                  {[
                    { href: "/projects", icon: FolderKanban, label: "Projetos", color: "text-orange-500", hoverBg: "hover:bg-orange-50 dark:hover:bg-orange-950/20" },
                    { href: "/technical-maps", icon: Printer, label: "Mapas", color: "text-blue-500", hoverBg: "hover:bg-blue-50 dark:hover:bg-blue-950/20" },
                    { href: "/atlas", icon: BookOpen, label: "Atlas", color: "text-green-500", hoverBg: "hover:bg-green-50 dark:hover:bg-green-950/20" },
                    { href: "/files", icon: FileUp, label: "Arquivos", color: "text-purple-500", hoverBg: "hover:bg-purple-50 dark:hover:bg-purple-950/20" },
                  ].map((item) => (
                    <Tooltip key={item.href}>
                      <TooltipTrigger asChild>
                        <Link href={item.href}>
                          <Button 
                            variant="outline" 
                            className={`${sidebarCollapsed ? "w-full h-10 p-0" : "w-full h-auto py-2.5 flex-col gap-1"} ${item.hoverBg} transition-all`}
                          >
                            <item.icon className={`${sidebarCollapsed ? "w-4 h-4" : "w-5 h-5"} ${item.color}`} />
                            {!sidebarCollapsed && <span className="text-xs font-medium">{item.label}</span>}
                          </Button>
                        </Link>
                      </TooltipTrigger>
                      {sidebarCollapsed && (
                        <TooltipContent side="right">{item.label}</TooltipContent>
                      )}
                    </Tooltip>
                  ))}
                </div>
              </div>

              {/* Admin Tools */}
              {user?.role === "admin" && (
                <>
                  {!sidebarCollapsed && <Separator />}
                  <div>
                    {!sidebarCollapsed && (
                      <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                        Admin
                      </h3>
                    )}
                    <div className={`${sidebarCollapsed ? "space-y-2" : "grid grid-cols-2 gap-1.5"}`}>
                      {[
                        { href: "/admin", icon: BarChart3, label: "Dashboard" },
                        { href: "/admin/users", icon: Users, label: "Usuários" },
                        { href: "/invitations", icon: FileText, label: "Convites" },
                        { href: "/admin/backups", icon: Database, label: "Backups" },
                      ].map((item) => (
                        <Tooltip key={item.href}>
                          <TooltipTrigger asChild>
                            <Link href={item.href}>
                              <Button 
                                variant="outline" 
                                className={`${sidebarCollapsed ? "w-full h-10 p-0" : "w-full h-auto py-2 flex-col gap-1"} hover:bg-slate-100 dark:hover:bg-slate-800 transition-all`}
                              >
                                <item.icon className={`${sidebarCollapsed ? "w-4 h-4" : "w-4 h-4"} text-slate-600 dark:text-slate-400`} />
                                {!sidebarCollapsed && <span className="text-xs">{item.label}</span>}
                              </Button>
                            </Link>
                          </TooltipTrigger>
                          {sidebarCollapsed && (
                            <TooltipContent side="right">{item.label}</TooltipContent>
                          )}
                        </Tooltip>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Painel: Meus Projetos (apenas quando expandido) */}
              {!sidebarCollapsed && (
                <>
                  <Separator />
                  <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
                    <CardHeader className="p-3 pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <FolderKanban className="w-4 h-4 text-orange-500" />
                        Meus Projetos
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {projects?.length || 0} projeto(s)
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-3 pt-0">
                      {projectsLoading ? (
                        <div className="space-y-1.5">
                          {[1,2,3].map(i => (
                            <div key={i} className="h-10 bg-slate-100 dark:bg-slate-800 rounded animate-pulse"></div>
                          ))}
                        </div>
                      ) : projects && projects.length > 0 ? (
                        <div className="space-y-1.5">
                          {projects.slice(0, 4).map((project) => (
                            <Link key={project.id} href={`/projects/${project.id}`}>
                              <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-orange-300 dark:hover:border-orange-700 transition-all cursor-pointer group">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="font-medium text-xs text-slate-900 dark:text-white group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors truncate">{project.name}</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{project.code}</p>
                                  </div>
                                  <Badge variant="outline" className="text-xs flex-shrink-0 px-1.5 py-0">
                                    {project.status === 'active' ? 'Ativo' : project.status}
                                  </Badge>
                                </div>
                              </div>
                            </Link>
                          ))}
                          {projects.length > 4 && (
                            <Button variant="ghost" size="sm" className="w-full text-xs text-orange-600 dark:text-orange-400 h-7" asChild>
                              <Link href="/projects">
                                Ver todos ({projects.length})
                                <ArrowRight className="w-3 h-3 ml-1" />
                              </Link>
                            </Button>
                          )}
                        </div>
                      ) : (
                        <div className="text-center py-4">
                          <FolderKanban className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                            Nenhum projeto
                          </p>
                          {(user?.role === "admin" || user?.role === "editor") && (
                            <Button size="sm" className="bg-orange-500 hover:bg-orange-600 h-7 text-xs" asChild>
                              <Link href="/projects">Criar</Link>
                            </Button>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}

              {/* Atividades Recentes (apenas quando expandido e admin) */}
              {!sidebarCollapsed && user?.role === "admin" && (
                <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
                  <CardHeader className="p-3 pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Clock className="w-4 h-4 text-blue-500" />
                      Atividades
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    {logsLoading ? (
                      <div className="space-y-1.5">
                        {[1,2,3].map(i => (
                          <div key={i} className="h-8 bg-slate-100 dark:bg-slate-800 rounded animate-pulse"></div>
                        ))}
                      </div>
                    ) : recentLogs && recentLogs.length > 0 ? (
                      <div className="space-y-2">
                        {recentLogs.slice(0, 4).map((log) => (
                          <div key={log.id} className="flex items-start gap-2 text-xs">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 flex-shrink-0"></div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-slate-700 dark:text-slate-300 truncate">{log.action}</p>
                              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                {log.userName || log.userEmail?.split('@')[0]}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-2">
                        Sem atividades recentes
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </aside>

          {/* Globe Viewer */}
          <div 
            data-tour="globe-viewer"
            className={`absolute inset-0 transition-all duration-300 ${
              sidebarOpen ? (sidebarCollapsed ? "left-16" : "left-72") : "left-0"
            }`}
          >
            <GlobeViewer />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
