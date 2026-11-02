import { useState, useRef, useEffect } from "react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Search, X, Folder, FileText, MapPin, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

interface GlobalSearchProps {
  className?: string;
}

export default function GlobalSearch({ className }: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [, setLocation] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Buscar sugestões
  const { data: suggestions, isLoading } = trpc.search.suggestions.useQuery(
    { query, limit: 8 },
    { 
      enabled: query.length >= 2,
      staleTime: 1000,
    }
  );

  // Fechar ao clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Atalho de teclado (Ctrl+K ou Cmd+K)
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setIsOpen(true);
        inputRef.current?.focus();
      }
      if (event.key === "Escape") {
        setIsOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSelect = (item: { type: string; id: number; projectId?: number }) => {
    setIsOpen(false);
    setQuery("");

    switch (item.type) {
      case "project":
        setLocation(`/projects/${item.id}`);
        break;
      case "file":
        if (item.projectId) {
          setLocation(`/projects/${item.projectId}?tab=files`);
        }
        break;
      case "layer":
        if (item.projectId) {
          setLocation(`/projects/${item.projectId}?tab=map`);
        }
        break;
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "project":
        return <Folder className="w-4 h-4 text-blue-500" />;
      case "file":
        return <FileText className="w-4 h-4 text-green-500" />;
      case "layer":
        return <MapPin className="w-4 h-4 text-orange-500" />;
      default:
        return <Search className="w-4 h-4" />;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "project":
        return "Projeto";
      case "file":
        return "Arquivo";
      case "layer":
        return "Camada";
      default:
        return type;
    }
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Botão de busca (mobile) */}
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => {
          setIsOpen(!isOpen);
          setTimeout(() => inputRef.current?.focus(), 100);
        }}
      >
        <Search className="w-5 h-5" />
      </Button>

      {/* Campo de busca (desktop) */}
      <div className={cn(
        "hidden md:flex items-center gap-2 bg-white/10 rounded-lg px-3 py-1.5 transition-all",
        isOpen && "ring-2 ring-primary"
      )}>
        <Search className="w-4 h-4 text-gray-400" />
        <Input
          ref={inputRef}
          type="text"
          placeholder="Buscar projetos, arquivos... (Ctrl+K)"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          className="border-0 bg-transparent focus-visible:ring-0 w-64 placeholder:text-gray-400"
        />
        {query && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Dropdown de resultados */}
      {isOpen && query.length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden z-50 min-w-[320px]">
          {isLoading ? (
            <div className="p-4 flex items-center justify-center text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Buscando...
            </div>
          ) : suggestions && suggestions.length > 0 ? (
            <ul className="py-2">
              {suggestions.map((item, index) => (
                <li key={`${item.type}-${item.id}-${index}`}>
                  <button
                    className="w-full px-4 py-2 flex items-center gap-3 hover:bg-gray-100 text-left transition-colors"
                    onClick={() => handleSelect(item)}
                  >
                    {getIcon(item.type)}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 truncate">
                        {item.name}
                      </div>
                      {item.projectName && item.type !== "project" && (
                        <div className="text-xs text-gray-500 truncate">
                          em {item.projectName}
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                      {getTypeLabel(item.type)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4 text-center text-gray-500">
              Nenhum resultado encontrado para "{query}"
            </div>
          )}

          {/* Dica de atalho */}
          <div className="px-4 py-2 bg-gray-50 border-t text-xs text-gray-500 flex items-center justify-between">
            <span>Pressione Enter para buscar</span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white border rounded text-xs">Esc</kbd>
              para fechar
            </span>
          </div>
        </div>
      )}

      {/* Modal de busca (mobile) */}
      {isOpen && (
        <div className="md:hidden fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-20">
          <div className="bg-white rounded-lg shadow-xl w-[90%] max-w-md">
            <div className="p-4 border-b flex items-center gap-2">
              <Search className="w-5 h-5 text-gray-400" />
              <Input
                ref={inputRef}
                type="text"
                placeholder="Buscar projetos, arquivos..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="border-0 focus-visible:ring-0"
                autoFocus
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setIsOpen(false);
                  setQuery("");
                }}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            {query.length >= 2 && (
              <div className="max-h-[60vh] overflow-auto">
                {isLoading ? (
                  <div className="p-4 flex items-center justify-center text-gray-500">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Buscando...
                  </div>
                ) : suggestions && suggestions.length > 0 ? (
                  <ul className="py-2">
                    {suggestions.map((item, index) => (
                      <li key={`${item.type}-${item.id}-${index}`}>
                        <button
                          className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-100 text-left"
                          onClick={() => handleSelect(item)}
                        >
                          {getIcon(item.type)}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 truncate">
                              {item.name}
                            </div>
                            {item.projectName && item.type !== "project" && (
                              <div className="text-xs text-gray-500 truncate">
                                em {item.projectName}
                              </div>
                            )}
                          </div>
                          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                            {getTypeLabel(item.type)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="p-4 text-center text-gray-500">
                    Nenhum resultado encontrado
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
