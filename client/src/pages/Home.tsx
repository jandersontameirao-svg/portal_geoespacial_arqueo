import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoginForm } from "@/components/LoginForm";
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
  PanelLeft,
} from "lucide-react";
import { useState, useEffect } from "react";
import { Link, useSearch } from "wouter";
import GlobeViewer from "@/components/GlobeViewer";
import { createPortal as createHomePanelPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/useMobile";

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const search = useSearch();
  const rawProjectId = new URLSearchParams(search).get("projectId");
  const parsedProjectId =
    rawProjectId && /^\d+$/.test(rawProjectId)
      ? Number(rawProjectId)
      : undefined;
  const contextualProjectId =
    parsedProjectId &&
    Number.isSafeInteger(parsedProjectId) &&
    parsedProjectId > 0
      ? parsedProjectId
      : undefined;
  const isMobile = useIsMobile();

  // Preferência própria deste layout; inicia recolhido sem mexer no login.
  // A sidebar vive encaixada na trilha lateral (preview-home-panel); mantê-la
  // sempre aberta evita o drawer sobreposto da versão antiga.
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("global-map-sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });

  // Destino do portal: o painel da trilha lateral renderizado pelo Header.
  const [previewHomePanel, setPreviewHomePanel] = useState<HTMLElement | null>(null);
  useEffect(() => setPreviewHomePanel(document.getElementById("preview-home-panel")), []);

  // Salvar preferências no localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        "global-map-sidebar-open",
        JSON.stringify(sidebarOpen)
      );
    } catch {
      /* armazenamento bloqueado */
    }
  }, [sidebarOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "global-map-sidebar-collapsed",
        JSON.stringify(sidebarCollapsed)
      );
    } catch {
      /* armazenamento bloqueado */
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        setSidebarOpen(false);
        window.requestAnimationFrame(() =>
          document.getElementById("home-sidebar-toggle")?.focus()
        );
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [sidebarOpen]);

  // Queries
  const { data: projects, isLoading: projectsLoading } =
    trpc.projects.list.useQuery(undefined, {
      enabled: isAuthenticated && sidebarOpen && !sidebarCollapsed,
    });

  const { data: recentLogs, isLoading: logsLoading } =
    trpc.audit.recent.useQuery(
      { limit: 10 },
      {
        enabled:
          isAuthenticated &&
          sidebarOpen &&
          !sidebarCollapsed &&
          user?.role === "admin",
      }
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
                  Sistema completo de gerenciamento de projetos geoespaciais do
                  Grupo Arqueo
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
                  <div
                    key={i}
                    className="flex flex-col items-center gap-2 p-4 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10"
                  >
                    <feature.icon className="w-8 h-8 text-orange-400" />
                    <span className="text-sm text-slate-300">
                      {feature.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* CTA — login próprio e-mail+senha */}
              <div className="pt-8">
                <LoginForm />
              </div>
            </div>
          </div>

          {/* Footer */}
          <footer className="py-6 text-center text-slate-500 text-sm">
            © {new Date().getFullYear()} Grupo Arqueo. Todos os direitos
            reservados.
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
          <p className="text-slate-600 dark:text-slate-400 font-medium">
            Carregando portal...
          </p>
        </div>
      </div>
    );
  }

  // Largura do sidebar baseada no estado
  const sidebarWidth = sidebarCollapsed ? "w-16" : "w-72";

  // Dashboard autenticado
  return (
    <TooltipProvider>
      <div className="preview-home-layout min-h-[360px] flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-900">
        {/* Main Content */}
        <div className="min-h-0 flex-1 relative">
          {/* Botão Toggle Sidebar (mostrar/ocultar completamente) */}
          {!sidebarOpen && (
            <Button
              id="home-sidebar-toggle"
              variant="secondary"
              size="icon"
              onClick={() => setSidebarOpen(true)}
              className="absolute top-4 left-3 z-40 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 shadow-lg border border-slate-200 dark:border-slate-700"
              title="Mostrar navegação do portal"
              aria-label="Mostrar navegação do portal"
              aria-expanded={sidebarOpen}
              aria-controls="home-navigation-sidebar"
            >
              <PanelLeft className="w-4 h-4" />
            </Button>
          )}

          {sidebarOpen && (
            <button
              type="button"
              aria-label="Fechar navegação do portal"
              className="absolute inset-0 z-30 bg-black/30 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          {/* Sidebar Compacto — encaixada na trilha lateral via portal */}
          {previewHomePanel && createHomePanelPortal(
          <aside
            id="home-navigation-sidebar"
            aria-label="Navegação do portal"
            aria-hidden={!sidebarOpen}
            inert={!sidebarOpen}
            data-tour="control-panel"
            className={`absolute top-0 left-0 bottom-0 ${sidebarWidth} max-w-[85vw] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 overflow-y-auto scrollbar-thin z-40 transition-transform duration-200 motion-reduce:transition-none shadow-lg ${
              sidebarOpen
                ? "translate-x-0 visible"
                : "-translate-x-full invisible pointer-events-none"
            }`}
          >
            <div className={`${sidebarCollapsed ? "p-2" : "p-4"} space-y-4`}>
              {/* Header do Sidebar com botões de controle */}
              <div
                className={`flex items-center ${sidebarCollapsed ? "justify-center" : "justify-between"} pb-2`}
              >
                {!sidebarCollapsed && (
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-gradient-to-br from-orange-500 to-orange-600">
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-sm text-slate-900 dark:text-white">
                        Painel
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[120px]">
                        {user?.name?.split(" ")[0]}
                      </p>
                    </div>
                  </div>
                )}

                <div
                  className={`flex gap-1 ${sidebarCollapsed ? "flex-col" : ""}`}
                >
                  {/* Botão Colapsar/Expandir */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                        className="h-7 w-7"
                        aria-label={
                          sidebarCollapsed
                            ? "Expandir navegação do portal"
                            : "Compactar navegação do portal"
                        }
                      >
                        {sidebarCollapsed ? (
                          <ChevronRight className="w-4 h-4" />
                        ) : (
                          <ChevronLeft className="w-4 h-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {sidebarCollapsed ? "Expandir" : "Compactar"}
                    </TooltipContent>
                  </Tooltip>

                  {/* Botão Fechar */}
                  {
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setSidebarOpen(false)}
                          className="h-7 w-7"
                          aria-label="Fechar navegação do portal"
                        >
                          <PanelLeftClose className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        Fechar painel
                      </TooltipContent>
                    </Tooltip>
                  }
                </div>
              </div>

              {!sidebarCollapsed && <Separator />}

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
                          {[1, 2, 3].map(i => (
                            <div
                              key={i}
                              className="h-10 bg-slate-100 dark:bg-slate-800 rounded animate-pulse"
                            ></div>
                          ))}
                        </div>
                      ) : projects && projects.length > 0 ? (
                        <div className="space-y-1.5">
                          {projects.slice(0, 4).map(project => (
                            <Link
                              key={project.id}
                              href={`/projects/${project.id}`}
                            >
                              <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-orange-300 dark:hover:border-orange-700 transition-all cursor-pointer group">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="font-medium text-xs text-slate-900 dark:text-white group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors truncate">
                                      {project.name}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                      {project.code}
                                    </p>
                                  </div>
                                  <Badge
                                    variant="outline"
                                    className="text-xs flex-shrink-0 px-1.5 py-0"
                                  >
                                    {project.status === "active"
                                      ? "Ativo"
                                      : project.status}
                                  </Badge>
                                </div>
                              </div>
                            </Link>
                          ))}
                          {projects.length > 4 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="w-full text-xs text-orange-600 dark:text-orange-400 h-7"
                              asChild
                            >
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
                          {(user?.role === "admin" ||
                            user?.role === "editor") && (
                            <Button
                              size="sm"
                              className="bg-orange-500 hover:bg-orange-600 h-7 text-xs"
                              asChild
                            >
                              <Link href="/projects">Criar</Link>
                            </Button>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}

            </div>
          </aside>,
          previewHomePanel)}

          {/* Globe Viewer */}
          <div
            data-tour="globe-viewer"
            className={`absolute inset-0 z-0 transition-[left] duration-200 motion-reduce:transition-none ${
              sidebarOpen && !isMobile
                ? sidebarCollapsed
                  ? "md:left-16"
                  : "md:left-72"
                : "left-0"
            }`}
          >
            <GlobeViewer projectId={contextualProjectId} />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
