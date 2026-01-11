import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import { Globe, LogOut, Menu, Settings, User } from "lucide-react";
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

  const navLinks = [
    { path: "/", label: "Início", show: true },
    { path: "/projects", label: "Projetos", show: isAuthenticated },
    { path: "/invitations", label: "Convites", show: isAuthenticated && user?.role === "admin" },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-slate-950/60">
      <div className="container flex h-16 items-center justify-between">
        {/* Logo e Nome */}
        <Link href="/">
          <a className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500">
              <Globe className="w-6 h-6 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-lg leading-none text-slate-900 dark:text-white">
                Portal Geoespacial
              </span>
              <span className="text-xs text-slate-600 dark:text-slate-400">
                Grupo Arqueo
              </span>
            </div>
          </a>
        </Link>

        {/* Navegação Desktop */}
        <nav className="hidden md:flex items-center gap-6">
          {navLinks.map(
            (link) =>
              link.show && (
                <Link key={link.path} href={link.path}>
                  <a
                    className={`text-sm font-medium transition-colors hover:text-blue-600 dark:hover:text-blue-400 ${
                      isActive(link.path)
                        ? "text-blue-600 dark:text-blue-400"
                        : "text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {link.label}
                  </a>
                </Link>
              )
          )}
        </nav>

        {/* Menu do Usuário */}
        <div className="flex items-center gap-4">
          {isAuthenticated && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <User className="w-4 h-4" />
                  <span className="hidden sm:inline">{user.name || user.email}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{user.name}</p>
                    <p className="text-xs leading-none text-slate-500 dark:text-slate-400">
                      {user.email}
                    </p>
                    <p className="text-xs leading-none text-slate-500 dark:text-slate-400 mt-1">
                      {user.role === "admin" && "Administrador"}
                      {user.role === "editor" && "Editor Interno"}
                      {user.role === "client" && "Cliente"}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Configurações</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-red-600 dark:text-red-400">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sair</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button asChild size="sm">
              <a href="/api/oauth/login">Entrar</a>
            </Button>
          )}

          {/* Menu Mobile */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild className="md:hidden">
              <Button variant="outline" size="icon">
                <Menu className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {navLinks.map(
                (link) =>
                  link.show && (
                    <DropdownMenuItem key={link.path} asChild>
                      <Link href={link.path}>
                        <a className="w-full">{link.label}</a>
                      </Link>
                    </DropdownMenuItem>
                  )
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
