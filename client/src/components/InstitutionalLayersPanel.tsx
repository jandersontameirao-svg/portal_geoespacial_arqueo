import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { useInstitutionalLayers } from "./InstitutionalMapLayers";
import { Checkbox } from "./ui/checkbox";
import { Button } from "./ui/button";
import { IBGE_MUNICIPALITIES_2010 } from "@/lib/institutionalLayers";

export default function InstitutionalLayersPanel() {
  const { user } = useAuth();
  const {
    layers,
    isLoading,
    isError,
    refetch,
    viewMode,
    enabled,
    toggle,
    statuses,
    queryViewport,
  } = useInstitutionalLayers();
  const is3d = viewMode === "3d";
  return (
    <section
      className="min-w-0 space-y-3 p-2 text-sm"
      aria-label="IBGE remoto"
      data-testid="institutional-layers-panel"
    >
      <div>
        <h3 className="font-semibold">IBGE · serviços remotos</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          WMS visual e WFS consultado sob demanda. Nenhum dado é importado para
          o projeto.
        </p>
      </div>
      {is3d && (
        <p
          className="rounded border border-amber-500/40 p-2 text-xs"
          role="status"
        >
          Volte ao modo 2D para exibir e consultar camadas institucionais. A
          navegação do globo permanece disponível.
        </p>
      )}
      {isLoading && (
        <p role="status" className="text-xs">
          Carregando catálogo publicado…
        </p>
      )}
      {isError && (
        <p role="alert" className="text-xs text-destructive">
          Catálogo indisponível.{" "}
          <button type="button" onClick={refetch} className="underline">
            Tentar novamente
          </button>
        </p>
      )}
      {!isLoading && !isError && layers.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nenhuma camada IBGE publicada e disponível neste catálogo. Não há
          conexão remota habilitada automaticamente.
        </p>
      )}
      {layers.map(layer => {
        const variant = layer.selected;
        const reference = variant ?? layer.primary;
        const isWfs = reference?.serviceType === "wfs";
        const status = variant ? statuses[variant.id] : undefined;
        const checked = !!variant && enabled.includes(variant.id);
        return (
          <article
            key={layer.logicalLayer}
            className="min-w-0 space-y-2 rounded-lg border border-border p-2"
          >
            <label className="flex items-start gap-2">
              <Checkbox
                className="mt-0.5 shrink-0"
                checked={checked}
                disabled={is3d || !variant || isError}
                onCheckedChange={value =>
                  variant && toggle(variant.id, value === true)
                }
                aria-label={`${isWfs ? "Habilitar consulta WFS" : "Exibir WMS"} ${reference?.remoteLayer ?? layer.logicalLayer}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium break-words">
                  {reference?.remoteLayer === IBGE_MUNICIPALITIES_2010
                    ? "Municípios · referência 2010"
                    : layer.logicalLayer}
                </span>
                <span className="block text-xs text-muted-foreground">
                  Fonte: IBGE · {reference?.serviceType.toUpperCase() ?? "OGC"}
                  {reference?.remoteLayer !== IBGE_MUNICIPALITIES_2010
                    ? " · ano conforme catálogo"
                    : " · ano 2010"}
                </span>
              </span>
            </label>
            {reference && (
              <p className="break-all text-[10px] text-muted-foreground">
                {reference.remoteLayer}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Saúde do catálogo: {reference?.health ?? "indisponível"}
              {layer.isFallback ? " · fonte alternativa" : ""}. {layer.reason}
            </p>
            {isWfs ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Feições apenas em memória. Aproxime para até 2° por eixo;
                  limite de 50 feições por consulta.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={
                    is3d || !checked || !variant || status?.state === "loading"
                  }
                  onClick={() => variant && queryViewport(variant.id)}
                >
                  {status?.state === "loading"
                    ? "Consultando…"
                    : "Consultar recorte"}
                </Button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Imagem WMS; não oferece contagem vetorial nem análise.
              </p>
            )}
            <div
              aria-live="polite"
              className={`text-xs ${status?.state === "error" ? "text-destructive" : "text-muted-foreground"}`}
            >
              {is3d
                ? "Exibição disponível somente em 2D."
                : (status?.message ??
                  (checked
                    ? isWfs
                      ? "Consulta habilitada. Clique em Consultar recorte; nenhum WFS foi solicitado."
                      : "Aguardando carregamento das imagens…"
                    : "Desligada por padrão; habilite manualmente."))}
              {checked && status?.queriedAt && (
                <p className="mt-1">
                  Consulta: {new Date(status.queriedAt).toLocaleString("pt-BR")}
                  . Mover o mapa não atualiza o recorte automaticamente;
                  consulte novamente.
                </p>
              )}
              {checked && status?.attribution && (
                <p className="mt-1 break-words">{status.attribution}</p>
              )}
            </div>
          </article>
        );
      })}
      <p className="text-xs text-muted-foreground">
        API estatística indisponível / verificação pendente. Nenhum indicador
        estatístico é calculado nesta visualização.
      </p>
      {user?.role === "admin" && (
        <Link
          href="/admin/ogc-catalog"
          className="inline-block text-xs text-orange-700 underline dark:text-orange-300"
        >
          Gerenciar catálogo GeoServer
        </Link>
      )}
    </section>
  );
}
