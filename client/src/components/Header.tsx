import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import { 
  Globe, 
  LogOut, 
  Menu, 
  Settings, 
  User, 
  FolderKanban,
  Printer,
  BookOpen,
  FileUp,
  Users,
  Database,
  BarChart3,
  Shield,
  ChevronDown,
  Layers,
  Map as MapIcon,
  Sparkles,
  Server,
  MessageSquare,
  MessageSquarePlus,
  Grid3x3
} from "lucide-react";
import GlobalSearch from "./GlobalSearch";
import { NotificationBell } from "./NotificationBell";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

export default function Header() {
  const { user, isAuthenticated } = useAuth();
  const [location] = useLocation();
  const logoutMutation = trpc.auth.logout.useMutation();

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
      toast.success("Logout realizado com sucesso");
      window.location.href = "/";
    } catch (error) {
      toast.error("Erro ao fazer logout");
    }
  };

  const isActive = (path: string) => {
    if (path === "/") return location === "/";
    return location.startsWith(path);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-sm">
      <div className="container flex h-16 items-center justify-between">
        {/* Logo e Nome */}
        <Link href="/">
          <a className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <img 
              src="/grupo-arqueo-logo.webp" 
              alt="Grupo Arqueo" 
              className="w-10 h-10 object-contain"
            />
            <div className="flex flex-col">
              <span className="font-bold text-lg leading-none text-slate-900 dark:text-white">
                Portal Geoespacial
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Grupo Arqueo
              </span>
            </div>
          </a>
        </Link>

        {/* Navegação Desktop */}
        {isAuthenticated && (
          <nav className="hidden lg:flex items-center gap-1">
            {/* Início */}
            <Link href="/">
              <a className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive("/") && location === "/"
                  ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400"
                  : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}>
                <Globe className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
                Início
              </a>
            </Link>

            {/* Projetos */}
            <Link href="/projects">
              <a data-tour="projects" className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive("/projects")
                  ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400"
                  : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}>
                <FolderKanban className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
                Projetos
              </a>
            </Link>

            {/* Menu Ferramentas */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button data-tour="tools-menu" className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1 ${
                  isActive("/maps") || isActive("/atlas") || isActive("/files") || isActive("/atena")
                    ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400"
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}>
                  <Layers className="w-4 h-4" />
                  Ferramentas
                  <ChevronDown className="w-3 h-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Ferramentas Geoespaciais</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <Link href="/atena">
                    <DropdownMenuItem className="cursor-pointer">
                      <Sparkles className="mr-2 h-4 w-4 text-orange-500" />
                      <div>
                        <span>Atena Cartógrafa</span>
                        <p className="text-xs text-slate-500">Planos, análises e modelos por projeto</p>
                      </div>
                    </DropdownMenuItem>
                  </Link>
                  <Link href="/assistente">
                    <DropdownMenuItem className="cursor-pointer">
                      <MessageSquare className="mr-2 h-4 w-4 text-orange-500" />
                      <div>
                        <span>Assistente Atena</span>
                        <p className="text-xs text-slate-500">Chat operacional, memórias e ações</p>
                      </div>
                    </DropdownMenuItem>
                  </Link>
                  <Link href="/observacoes">
                    <DropdownMenuItem className="cursor-pointer">
                      <MessageSquarePlus className="mr-2 h-4 w-4 text-rose-500" />
                      <div>
                        <span>Observações</span>
                        <p className="text-xs text-slate-500">Feedback, bugs e melhorias do sistema</p>
                      </div>
                    </DropdownMenuItem>
                  </Link>
                  <Link href="/malha-campo">
                    <DropdownMenuItem className="cursor-pointer">
                      <Grid3x3 className="mr-2 h-4 w-4 text-teal-500" />
                      <div>
                        <span>Malha de Campo</span>
                        <p className="text-xs text-slate-500">Gerar malha de pontos e cruzar municípios</p>
                      </div>
                    </DropdownMenuItem>
                  </Link>
                  <Link href="/technical-maps">
                    <DropdownMenuItem className="cursor-pointer">
                      <Printer className="mr-2 h-4 w-4 text-blue-500" />
                      <div>
                        <span>Mapas Técnicos ABNT</span>
                        <p className="text-xs text-slate-500">Gerar mapas com padrão técnico</p>
                      </div>
                    </DropdownMenuItem>
                  </Link>
                  <Link href="/atlas">
                    <DropdownMenuItem className="cursor-pointer">
                      <BookOpen className="mr-2 h-4 w-4 text-green-500" />
                      <div>
                        <span>Atlas Automático</span>
                        <p className="text-xs text-slate-500">Gerar atlas multipágina</p>
                      </div>
                    </DropdownMenuItem>
                  </Link>
                  <Link href="/files">
                    <DropdownMenuItem className="cursor-pointer">
                      <FileUp className="mr-2 h-4 w-4 text-purple-500" />
                      <div>
                        <span>Repositório de Arquivos</span>
                        <p className="text-xs text-slate-500">Upload e gestão de arquivos</p>
                      </div>
                    </DropdownMenuItem>
                  </Link>
                  <Link href="/base-layers">
                    <DropdownMenuItem className="cursor-pointer">
                      <Database className="mr-2 h-4 w-4 text-amber-500" />
                      <div>
                        <span>Camadas Base</span>
                        <p className="text-xs text-slate-500">Dados oficiais (FUNAI, INCRA, IPHAN)</p>
                      </div>
                    </DropdownMenuItem>
                  </Link>
                  <Link href="/gis-uploads">
                    <DropdownMenuItem className="cursor-pointer">
                      <FileUp className="mr-2 h-4 w-4 text-indigo-500" />
                      <div>
                        <span>Upload de Arquivos GIS</span>
                        <p className="text-xs text-slate-500">Enviar e validar shapefiles, KML, GeoJSON</p>
                      </div>
                    </DropdownMenuItem>
                  </Link>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Administração Dropdown (apenas admin) */}
            {user?.role === "admin" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1 ${
                    isActive("/admin") || isActive("/invitations")
                      ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400"
                      : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`}>
                    <Settings className="w-4 h-4" />
                    Administração
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuLabel>Painel Administrativo</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <Link href="/admin">
                      <DropdownMenuItem className="cursor-pointer">
                        <BarChart3 className="mr-2 h-4 w-4 text-blue-500" />
                        <div>
                          <span>Dashboard</span>
                          <p className="text-xs text-slate-500">Métricas e estatísticas</p>
                        </div>
                      </DropdownMenuItem>
                    </Link>
                    <Link href="/admin/users">
                      <DropdownMenuItem className="cursor-pointer">
                        <Users className="mr-2 h-4 w-4 text-green-500" />
                        <div>
                          <span>Usuários</span>
                          <p className="text-xs text-slate-500">Gerenciar usuários</p>
                        </div>
                      </DropdownMenuItem>
                    </Link>
                    <Link href="/invitations">
                      <DropdownMenuItem className="cursor-pointer">
                        <FileUp className="mr-2 h-4 w-4 text-orange-500" />
                        <div>
                          <span>Convites</span>
                          <p className="text-xs text-slate-500">Gerenciar convites</p>
                        </div>
                      </DropdownMenuItem>
                    </Link>
                    <Link href="/admin/backups">
                      <DropdownMenuItem className="cursor-pointer">
                        <Database className="mr-2 h-4 w-4 text-purple-500" />
                        <div>
                          <span>Backups</span>
                          <p className="text-xs text-slate-500">Backup do sistema</p>
                        </div>
                      </DropdownMenuItem>
                    </Link>
                    <Link href="/admin/ogc-catalog">
                      <DropdownMenuItem className="cursor-pointer">
                        <Server className="mr-2 h-4 w-4 text-cyan-600" />
                        <div>
                          <span>Catálogo OGC</span>
                          <p className="text-xs text-slate-500">WMS/WFS, saúde e fallback</p>
                        </div>
                      </DropdownMenuItem>
                    </Link>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </nav>
        )}

        {/* Busca Global e Menu do Usuário */}
        <div className="flex items-center gap-3">
          {/* Busca Global */}
          {isAuthenticated && <div data-tour="search"><GlobalSearch /></div>}
          
          {/* Notificações */}
          {isAuthenticated && <div data-tour="notifications"><NotificationBell /></div>}
          
          {isAuthenticated && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button data-tour="user-menu" variant="outline" size="sm" className="gap-2 border-slate-200 dark:border-slate-700">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white text-xs font-bold">
                    {user.name?.charAt(0).toUpperCase() || user.email?.charAt(0).toUpperCase()}
                  </div>
                  <span className="hidden sm:inline max-w-[120px] truncate">{user.name || user.email}</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white font-bold">
                      {user.name?.charAt(0).toUpperCase() || user.email?.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex flex-col">
                      <p className="text-sm font-medium leading-none">{user.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {user.email}
                      </p>
                      <p className="text-xs text-orange-600 dark:text-orange-400 mt-1 font-medium">
                        {user.role === "admin" && "Administrador"}
                        {user.role === "editor" && "Editor Interno"}
                        {user.role === "client" && "Cliente"}
                      </p>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <Link href="/security">
                    <DropdownMenuItem className="cursor-pointer">
                      <Shield className="mr-2 h-4 w-4" />
                      <span>Segurança & MFA</span>
                    </DropdownMenuItem>
                  </Link>
                  <Link href="/profile">
                    <DropdownMenuItem className="cursor-pointer">
                      <User className="mr-2 h-4 w-4" />
                      <span>Meu Perfil</span>
                    </DropdownMenuItem>
                  </Link>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-red-600 dark:text-red-400 cursor-pointer">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sair</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button asChild size="sm" className="bg-orange-500 hover:bg-orange-600">
              <a href="/api/oauth/login">Entrar</a>
            </Button>
          )}

          {/* Menu Mobile */}
          {isAuthenticated && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild className="lg:hidden">
                <Button variant="outline" size="icon" className="border-slate-200 dark:border-slate-700">
                  <Menu className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Navegação</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <Link href="/">
                  <DropdownMenuItem className="cursor-pointer">
                    <Globe className="mr-2 h-4 w-4" />
                    Início
                  </DropdownMenuItem>
                </Link>
                <Link href="/projects">
                  <DropdownMenuItem className="cursor-pointer">
                    <FolderKanban className="mr-2 h-4 w-4" />
                    Projetos
                  </DropdownMenuItem>
                </Link>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Ferramentas</DropdownMenuLabel>
                <Link href="/atena">
                  <DropdownMenuItem className="cursor-pointer">
                    <Sparkles className="mr-2 h-4 w-4 text-orange-500" />
                    Atena Cartógrafa
                  </DropdownMenuItem>
                </Link>
                <Link href="/assistente">
                  <DropdownMenuItem className="cursor-pointer">
                    <MessageSquare className="mr-2 h-4 w-4 text-orange-500" />
                    Assistente Atena
                  </DropdownMenuItem>
                </Link>
                <Link href="/observacoes">
                  <DropdownMenuItem className="cursor-pointer">
                    <MessageSquarePlus className="mr-2 h-4 w-4 text-rose-500" />
                    Observações
                  </DropdownMenuItem>
                </Link>
                <Link href="/malha-campo">
                  <DropdownMenuItem className="cursor-pointer">
                    <Grid3x3 className="mr-2 h-4 w-4 text-teal-500" />
                    Malha de Campo
                  </DropdownMenuItem>
                </Link>
                <Link href="/technical-maps">
                  <DropdownMenuItem className="cursor-pointer">
                    <Printer className="mr-2 h-4 w-4" />
                    Mapas ABNT
                  </DropdownMenuItem>
                </Link>
                <Link href="/atlas">
                  <DropdownMenuItem className="cursor-pointer">
                    <BookOpen className="mr-2 h-4 w-4" />
                    Atlas
                  </DropdownMenuItem>
                </Link>
                <Link href="/files">
                  <DropdownMenuItem className="cursor-pointer">
                    <FileUp className="mr-2 h-4 w-4" />
                    Arquivos
                  </DropdownMenuItem>
                </Link>
                {user?.role === "admin" && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Administração</DropdownMenuLabel>
                    <Link href="/admin">
                      <DropdownMenuItem className="cursor-pointer">
                        <BarChart3 className="mr-2 h-4 w-4" />
                        Dashboard
                      </DropdownMenuItem>
                    </Link>
                    <Link href="/admin/users">
                      <DropdownMenuItem className="cursor-pointer">
                        <Users className="mr-2 h-4 w-4" />
                        Usuários
                      </DropdownMenuItem>
                    </Link>
                    <Link href="/invitations">
                      <DropdownMenuItem className="cursor-pointer">
                        <FileUp className="mr-2 h-4 w-4" />
                        Convites
                      </DropdownMenuItem>
                    </Link>
                    <Link href="/admin/backups">
                      <DropdownMenuItem className="cursor-pointer">
                        <Database className="mr-2 h-4 w-4" />
                        Backups
                      </DropdownMenuItem>
                    </Link>
                    <Link href="/admin/ogc-catalog">
                      <DropdownMenuItem className="cursor-pointer">
                        <Server className="mr-2 h-4 w-4" />
                        Catálogo OGC
                      </DropdownMenuItem>
                    </Link>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}
