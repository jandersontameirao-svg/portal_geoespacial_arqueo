import { useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { ChevronDown, ChevronRight, ExternalLink, Folder } from "lucide-react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { toast } from "sonner";
import LayersTree from "./LayersTree";

interface MyProjectsPanelProps {
  enabledIds: number[];
  onChange: (ids: number[]) => void;
  selectionReady: boolean;
  selectionPending: boolean;
  selectionError?: string;
  onRetrySelection: () => void;
  contextualProjectId?: number;
}
const SELECTION_LIMIT = 500;

function ProjectGeometryExport({ projectId }: { projectId: number }) {
  const {
    data: geometries,
    isLoading,
    isError,
  } = trpc.geometries.list.useQuery({ projectId });
  const exportGeometries = trpc.geometries.export.useMutation({
    onSuccess: data => {
      const url = URL.createObjectURL(
        new Blob([data.data], { type: "text/plain;charset=utf-8" })
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = data.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success("Geometrias exportadas");
    },
    onError: error => toast.error(`Exportação não concluída: ${error.message}`),
  });
  return (
    <div className="mb-3 space-y-2 text-xs">
      <p className="text-muted-foreground">
        {isLoading
          ? "Carregando geometrias para exportar…"
          : isError
            ? "Exportação indisponível: falha ao carregar geometrias."
            : `${geometries?.length ?? 0} geometria(s) desenhada(s) no projeto. Vetores e resultados completos podem ser exportados no workspace.`}
      </p>
      {!!geometries?.length && !isError && (
        <div className="flex flex-wrap gap-2">
          {(["geojson", "kml"] as const).map(format => (
            <Button
              key={format}
              type="button"
              size="sm"
              variant="outline"
              disabled={exportGeometries.isPending}
              onClick={() =>
                exportGeometries.mutate({
                  geometryIds: geometries.map(geometry => geometry.id),
                  format,
                })
              }
              aria-label={`Exportar geometrias do projeto como ${format.toUpperCase()}`}
            >
              {exportGeometries.isPending
                ? "Exportando…"
                : format.toUpperCase()}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

// Padrão PR8/stage: seleção global, busca nome/código e árvore por projeto.
// A persistência é confirmada pelo servidor; nenhum ID da URL concede acesso.
export default function MyProjectsPanel({
  enabledIds,
  onChange,
  selectionReady,
  selectionPending,
  selectionError,
  onRetrySelection,
  contextualProjectId,
}: MyProjectsPanelProps) {
  const { user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "editor";
  const {
    data: projects,
    isLoading,
    isError,
    refetch,
  } = trpc.projects.list.useQuery();
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const all = useMemo(() => projects ?? [], [projects]);
  const matches = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase("pt-BR");
    return all.filter(
      project =>
        !query ||
        `${project.name} ${project.code ?? ""}`
          .toLocaleLowerCase("pt-BR")
          .includes(query)
    );
  }, [all, filter]);
  const enabled = new Set(enabledIds);
  const onCount = all.filter(project => enabled.has(project.id)).length;
  const masterState =
    onCount === 0 ? false : onCount === all.length ? true : "indeterminate";
  const busy = !selectionReady || selectionPending || isError;

  return (
    <div className="space-y-3 p-2 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Checkbox
          checked={masterState}
          disabled={
            busy ||
            all.length === 0 ||
            (masterState !== true && all.length > SELECTION_LIMIT)
          }
          onCheckedChange={() =>
            onChange(masterState === true ? [] : all.map(project => project.id))
          }
          aria-label="Mostrar todos os projetos autorizados (não apenas os filtrados)"
        />
        <Folder className="h-4 w-4 shrink-0" />
        <span>Meus projetos</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {onCount}/{all.length}
        </span>
      </div>
      <Input
        value={filter}
        onChange={event => setFilter(event.target.value)}
        placeholder="Buscar projeto ou código"
        aria-label="Buscar projetos autorizados"
        className="h-9 text-sm"
      />
      <p className="text-xs text-muted-foreground">
        A caixa controla a exibição no mapa global. “Workspace” abre Mapa &
        Análise do projeto.
      </p>
      <div
        aria-live="polite"
        className="space-y-2 text-xs text-muted-foreground"
      >
        {isLoading && <p>Carregando projetos autorizados…</p>}
        {!selectionReady && !selectionError && <p>Carregando seleção salva…</p>}
        {selectionPending && <p>Salvando seleção…</p>}
        {isError && (
          <p role="alert">
            Não foi possível carregar os projetos.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => void refetch()}
            >
              Tentar novamente
            </button>
          </p>
        )}
        {selectionError && (
          <p role="alert">
            {selectionError}{" "}
            <button
              type="button"
              className="underline"
              onClick={onRetrySelection}
            >
              Recarregar seleção
            </button>
          </p>
        )}
        {all.length > SELECTION_LIMIT && (
          <p>
            Selecione até {SELECTION_LIMIT} projetos. A seleção de todos está
            indisponível acima desse limite.
          </p>
        )}
        {!isLoading && !isError && all.length === 0 && (
          <p>Nenhum projeto autorizado disponível.</p>
        )}
        {!isLoading && !isError && all.length > 0 && matches.length === 0 && (
          <p>Nenhum projeto corresponde à busca.</p>
        )}
      </div>
      <div className="space-y-2">
        {matches.slice(0, 200).map(project => {
          const isExpanded = expanded.has(project.id);
          return (
            <div
              key={project.id}
              className="rounded-lg border border-border p-2"
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground focus-visible:outline-2"
                  aria-label={`${isExpanded ? "Recolher" : "Expandir"} camadas de ${project.name}`}
                  aria-expanded={isExpanded}
                  aria-controls={`project-layers-${project.id}`}
                  onClick={() =>
                    setExpanded(previous => {
                      const next = new Set(previous);
                      if (next.has(project.id)) next.delete(project.id);
                      else next.add(project.id);
                      return next;
                    })
                  }
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
                <Checkbox
                  checked={enabled.has(project.id)}
                  disabled={
                    busy ||
                    (!enabled.has(project.id) && onCount >= SELECTION_LIMIT)
                  }
                  onCheckedChange={() =>
                    onChange(
                      enabled.has(project.id)
                        ? enabledIds.filter(id => id !== project.id)
                        : [...enabledIds, project.id]
                    )
                  }
                  aria-label={`Mostrar projeto ${project.name}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium" title={project.name}>
                    {project.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {project.code}
                    {contextualProjectId === project.id
                      ? " · projeto em contexto"
                      : ""}
                  </p>
                </div>
              </div>
              <Link
                href={`/projects/${project.id}?tab=map`}
                className="ml-9 mt-1 inline-flex items-center gap-1 text-xs text-orange-700 underline underline-offset-2 dark:text-orange-300"
                aria-label={`Abrir workspace Mapa e Análise de ${project.name}`}
              >
                Workspace <ExternalLink className="h-3 w-3" />
              </Link>
              {isExpanded && (
                <div
                  id={`project-layers-${project.id}`}
                  className="mt-2 overflow-x-auto border-t border-border pt-2"
                >
                  <ProjectGeometryExport projectId={project.id} />
                  <LayersTree projectId={project.id} canEdit={canEdit} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {matches.length > 200 && (
        <p className="text-xs text-muted-foreground">
          Mostrando 200 de {matches.length} resultados. Refine a busca.
        </p>
      )}
    </div>
  );
}
