import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useIndeCatalog } from "./IndeCatalogLayers";
import { Checkbox } from "./ui/checkbox";
import {
  INDE_LIMIT_MESSAGE,
  indeCrsIssue,
  indeErrorMessage,
  indeLayerId,
  indeSelectedLayer,
  type IndeLayersResult,
  type IndeOrganization,
  type IndeOrganizationsResult,
  type IndeSelectedLayer,
} from "@/lib/indeCatalogState";

type CatalogClient = {
  indeCatalog: {
    organizations: {
      query: (
        input: undefined,
        options?: { signal?: AbortSignal }
      ) => Promise<IndeOrganizationsResult>;
    };
    layers: {
      query: (
        input: { organizationId: string },
        options?: { signal?: AbortSignal }
      ) => Promise<IndeLayersResult>;
    };
  };
};
const normalizeSearch = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");

function SelectedLayer({ layer }: { layer: IndeSelectedLayer }) {
  const { statuses, toggle } = useIndeCatalog();
  const status = statuses[layer.id];
  return (
    <li className="min-w-0 space-y-1 rounded border border-border p-2">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 break-words text-xs font-medium">
          {layer.title}
        </span>
        <button
          type="button"
          onClick={() => toggle(layer.id, false)}
          className="shrink-0 rounded px-1 text-xs underline focus-visible:outline-2"
          aria-label={`Desativar ${layer.title}`}
        >
          Desativar
        </button>
      </div>
      {status && (
        <p
          role={status.state === "error" ? "alert" : "status"}
          className={`text-[11px] ${status.state === "error" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {status.message}
        </p>
      )}
      <p className="break-words text-[10px] text-muted-foreground">
        {status?.attribution || layer.attribution}
      </p>
    </li>
  );
}

function OrganizationLayers({
  organization,
  open,
}: {
  organization: IndeOrganization;
  open: boolean;
}) {
  const { selected, toggle, viewMode, authenticated, identity, limit } =
    useIndeCatalog();
  const utils = trpc.useUtils();
  const client = utils.client as unknown as CatalogClient;
  const [search, setSearch] = useState("");
  const capabilities = useQuery({
    queryKey: ["indeCatalog", "layers", identity, organization.id],
    queryFn: ({ signal }) =>
      client.indeCatalog.layers.query(
        { organizationId: organization.id },
        { signal }
      ),
    enabled: authenticated && open && organization.eligible,
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const data =
    capabilities.data?.organizationId === organization.id
      ? capabilities.data
      : undefined;
  const filter = normalizeSearch(search.trim());
  const layers = useMemo(
    () =>
      (data?.layers ?? []).filter(
        layer =>
          !filter ||
          normalizeSearch(`${layer.title} ${layer.name}`).includes(filter)
      ),
    [data, filter]
  );
  if (!open) return null;
  if (!organization.eligible)
    return (
      <p className="p-2 text-xs text-destructive">
        {organization.blocker ||
          "Serviço bloqueado; nenhuma capacidade ou imagem será solicitada."}
      </p>
    );
  return (
    <div className="space-y-2 border-t border-border p-2">
      <p className="text-[10px] text-muted-foreground">
        HTTPS elegível não comprova disponibilidade. As capacidades e imagens
        são verificadas sob demanda.
      </p>
      {capabilities.isLoading && (
        <p role="status" className="text-xs">
          Consultando GetCapabilities desta instituição…
        </p>
      )}
      {capabilities.isError && (
        <div role="alert" className="text-xs text-destructive">
          <p>
            Capacidades indisponíveis: {indeErrorMessage(capabilities.error)}
          </p>
          <button
            type="button"
            className="mt-1 rounded underline focus-visible:outline-2"
            onClick={() => void capabilities.refetch()}
            aria-label={`Tentar novamente capacidades de ${organization.label}`}
          >
            Tentar novamente
          </button>
        </div>
      )}
      {data && (
        <>
          <label className="block space-y-1 text-xs">
            <span>Filtrar camadas desta instituição</span>
            <input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Título ou nome da camada"
              aria-label={`Filtrar camadas de ${organization.label}`}
              className="w-full rounded-md border border-input bg-background p-2 text-foreground focus-visible:outline-2"
            />
          </label>
          <p className="text-[10px] text-muted-foreground">
            {data.layers.length} camada(s) anunciada(s) · WMS {data.version}.{" "}
            {data.truncated
              ? "Lista limitada pelo serviço; nem todas as camadas estão disponíveis nesta resposta."
              : "Sem importação de dados para o projeto."}
          </p>
          {layers.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {search
                ? "Nenhuma camada corresponde ao filtro desta instituição."
                : "Nenhuma camada WMS anunciada por esta instituição."}
            </p>
          )}
          <div className="max-h-72 space-y-1 overflow-y-auto overscroll-contain">
            {layers.map(layer => {
              const id = indeLayerId(organization.id, layer.name);
              const checked = selected.some(item => item.id === id);
              const issue = indeCrsIssue(layer.crs, viewMode);
              const limitReached = selected.length >= limit;
              const disabled = !checked && (!!issue || limitReached);
              return (
                <div
                  key={id}
                  data-testid={`inde-layer-${id}`}
                  className="rounded border border-border/60 p-2"
                >
                  <label className="flex cursor-pointer items-start gap-2">
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={value =>
                        toggle(
                          indeSelectedLayer(organization, layer),
                          value === true
                        )
                      }
                      aria-label={`Exibir ${layer.title || layer.name} — ${organization.label}`}
                      aria-describedby={
                        issue || (!checked && limitReached)
                          ? `inde-layer-note-${id}`
                          : undefined
                      }
                      className="mt-0.5 shrink-0"
                    />
                    <span className="min-w-0 break-words text-xs leading-snug">
                      {layer.title || layer.name}
                    </span>
                  </label>
                  {(issue || (!checked && limitReached)) && (
                    <p
                      id={`inde-layer-note-${id}`}
                      className="mt-1 text-[10px] text-muted-foreground"
                    >
                      {issue || INDE_LIMIT_MESSAGE}
                    </p>
                  )}
                  <details className="mt-1 text-[10px] text-muted-foreground">
                    <summary className="cursor-pointer rounded focus-visible:outline-2">
                      Detalhes e créditos
                    </summary>
                    <p className="mt-1 break-words">
                      Nome da camada: {layer.name}
                    </p>
                    <p className="break-words">
                      CRS anunciado: {layer.crs.join(", ") || "não informado"}.
                    </p>
                    <p className="break-words">
                      {organization.label} — {organization.name} · catálogo
                      INDE.
                    </p>
                    {layer.bounds && (
                      <p>
                        Extensão anunciada: {layer.bounds.west},{" "}
                        {layer.bounds.south}, {layer.bounds.east},{" "}
                        {layer.bounds.north}.
                      </p>
                    )}
                    <p>
                      Crédito retornado pelo serviço aparece na imagem
                      selecionada. Não há licença única INDE inferida; consulte
                      as condições do publicador.
                    </p>
                  </details>
                </div>
              );
            })}
          </div>
          <details className="text-[10px] text-muted-foreground">
            <summary className="cursor-pointer rounded focus-visible:outline-2">
              Proveniência das capacidades
            </summary>
            <p>Consulta: {new Date(data.fetchedAt).toLocaleString("pt-BR")}</p>
            <p className="break-all">SHA-256: {data.capabilitySha256}</p>
          </details>
        </>
      )}
    </div>
  );
}
function OrganizationAccordion({
  organization,
}: {
  organization: IndeOrganization;
}) {
  const [open, setOpen] = useState(false);
  const controlId = `inde-org-content-${encodeURIComponent(organization.id)}`;
  return (
    <article
      data-testid={`inde-org-${organization.id}`}
      className="overflow-hidden rounded-lg border border-border"
    >
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-controls={controlId}
        aria-label={`${open ? "Fechar" : "Abrir"} camadas de ${organization.label}${organization.name !== organization.label ? ` — ${organization.name}` : ""}`}
        className="flex w-full items-start gap-2 p-2 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
      >
        {open ? (
          <ChevronDown
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            aria-hidden="true"
          />
        ) : (
          <ChevronRight
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            aria-hidden="true"
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="block break-words text-xs font-semibold">
            {organization.label}
          </span>
          {organization.name !== organization.label && (
            <span className="block break-words text-[10px] text-muted-foreground">
              {organization.name}
            </span>
          )}
          <span
            className={`mt-1 block text-[10px] ${organization.eligible ? "text-muted-foreground" : "text-destructive"}`}
          >
            {organization.eligible
              ? "WMS · não consultado"
              : organization.endpoint.toLowerCase().startsWith("http:")
                ? "HTTP bloqueado"
                : "WMS · bloqueado"}
          </span>
        </span>
      </button>
      <div id={controlId} hidden={!open}>
        {open && <OrganizationLayers organization={organization} open={open} />}
      </div>
    </article>
  );
}

/** Only mounting this panel requests the literal INDE organizations snapshot. */
export default function IndeCatalogPanel() {
  const { authenticated, identity, selected, clear, notice, limit, viewMode } =
    useIndeCatalog();
  const utils = trpc.useUtils();
  const client = utils.client as unknown as CatalogClient;
  const [search, setSearch] = useState("");
  const catalog = useQuery({
    queryKey: ["indeCatalog", "organizations", identity],
    queryFn: ({ signal }) =>
      client.indeCatalog.organizations.query(undefined, { signal }),
    enabled: authenticated,
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const organizations = catalog.data?.organizations ?? [];
  const groups = useMemo(() => {
    const filter = normalizeSearch(search.trim());
    const grouped = new Map<string, IndeOrganization[]>();
    for (const organization of organizations) {
      if (
        filter &&
        !normalizeSearch(`${organization.label} ${organization.name}`).includes(
          filter
        )
      )
        continue;
      const level = organization.level || "Outros";
      grouped.set(level, [...(grouped.get(level) ?? []), organization]);
    }
    const order = ["nacional", "estadual", "municipal", "academia"];
    const rank = (level: string) => {
      const index = order.indexOf(normalizeSearch(level));
      return index < 0 ? order.length : index;
    };
    return Array.from(grouped.entries()).sort(
      ([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, "pt-BR")
    );
  }, [organizations, search]);
  return (
    <section
      data-testid="inde-catalog-panel"
      aria-label="Catálogo federado INDE por instituições"
      className="min-w-0 space-y-3 p-2 text-sm"
    >
      <header className="space-y-1">
        <h3 className="font-semibold">Catálogo INDE · instituições</h3>
        <p className="text-xs text-muted-foreground">
          Imagens WMS oficiais sob demanda, sem importar dados. Até {limit}{" "}
          camadas simultâneas · modo {viewMode.toUpperCase()}.
        </p>
        <p className="text-[10px] text-muted-foreground">
          2D requer EPSG:3857; 3D requer EPSG:4326. Mudar o modo preserva a
          seleção, mas não converte CRS nem substitui o serviço.
        </p>
      </header>
      {!authenticated ? (
        <p role="status" className="text-xs text-muted-foreground">
          Entre na sua conta para consultar os serviços do catálogo INDE.
        </p>
      ) : (
        <>
          {selected.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-semibold">
                  Selecionadas ({selected.length}/{limit})
                </h4>
                <button
                  type="button"
                  onClick={clear}
                  className="rounded text-xs underline focus-visible:outline-2"
                  aria-label="Desativar todas as camadas INDE"
                >
                  Limpar seleção
                </button>
              </div>
              <ul className="space-y-1">
                {selected.map(layer => (
                  <SelectedLayer key={layer.id} layer={layer} />
                ))}
              </ul>
            </div>
          )}
          {selected.length >= limit && (
            <p
              role="status"
              className="rounded border border-amber-500/40 p-2 text-xs"
            >
              {INDE_LIMIT_MESSAGE}
            </p>
          )}
          {notice && (
            <p role="alert" className="text-xs text-destructive">
              {notice}
            </p>
          )}
          {catalog.isLoading && (
            <p role="status" className="text-xs">
              Carregando serviços de instituições do catálogo INDE…
            </p>
          )}
          {catalog.isError && (
            <div role="alert" className="text-xs text-destructive">
              <p>
                Catálogo INDE indisponível: {indeErrorMessage(catalog.error)}
              </p>
              <button
                type="button"
                className="mt-1 rounded underline focus-visible:outline-2"
                onClick={() => void catalog.refetch()}
              >
                Tentar novamente o catálogo INDE
              </button>
            </div>
          )}
          {catalog.data && !catalog.isError && (
            <>
              <p className="text-xs text-muted-foreground">
                {organizations.length} serviços de instituições no catálogo.
                Presença na INDE não comprova saúde, licença ou disponibilidade
                do serviço.
              </p>
              <label className="block space-y-1 text-xs">
                <span className="flex items-center gap-1">
                  <Search className="h-3 w-3" aria-hidden="true" />
                  Buscar instituição
                </span>
                <input
                  type="search"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Nome ou sigla da instituição"
                  aria-label="Buscar instituição no catálogo INDE"
                  className="w-full rounded-md border border-input bg-background p-2 text-foreground focus-visible:outline-2"
                />
              </label>
              {groups.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {search
                    ? "Nenhuma instituição corresponde à busca."
                    : "Nenhum serviço foi retornado pelo catálogo INDE."}
                </p>
              )}
              {groups.map(([level, group]) => (
                <section
                  key={level}
                  className="space-y-2"
                  aria-label={`Instituições — ${level}`}
                >
                  <h4 className="text-xs font-semibold">
                    {level}{" "}
                    <span className="font-normal text-muted-foreground">
                      ({group.length})
                    </span>
                  </h4>
                  {group.map(organization => (
                    <OrganizationAccordion
                      key={organization.id}
                      organization={organization}
                    />
                  ))}
                </section>
              ))}
              <details className="text-[10px] text-muted-foreground">
                <summary className="cursor-pointer rounded focus-visible:outline-2">
                  Fonte do catálogo
                </summary>
                <p className="mt-1 break-all">{catalog.data.sourceUrl}</p>
                <p>
                  Referência:{" "}
                  {new Date(catalog.data.fetchedAt).toLocaleString("pt-BR")}.
                </p>
                <p>
                  Serviços apenas HTTP permanecem bloqueados; nenhum endereço
                  HTTPS alternativo é presumido. A licença e os créditos são de
                  cada publicador.
                </p>
              </details>
            </>
          )}
        </>
      )}
      <p className="text-[10px] text-muted-foreground">
        WMS é uma imagem, não uma contagem de feições ou indicador estatístico.
        A seleção não altera o enquadramento do mapa.
      </p>
    </section>
  );
}
export { IndeCatalogPanel };
