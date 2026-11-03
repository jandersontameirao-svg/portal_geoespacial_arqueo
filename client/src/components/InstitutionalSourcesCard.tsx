import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  sourceIsRegistered,
  type InstitutionalSource,
} from "@/lib/institutionalLayers";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Badge } from "./ui/badge";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

/** Only explicit administrator actions register a validated fixed preset. No geographic import. */
export default function InstitutionalSourcesCard() {
  const { user, isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const catalog = trpc.institutionalCatalog?.listSources?.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });
  const register = trpc.institutionalCatalog?.registerSource?.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.institutionalCatalog.listSources.invalidate(),
        utils.ogcCatalog.listPublished.invalidate(),
        utils.ogcCatalog.listServices.invalidate(),
      ]);
      toast.success(
        "Origem institucional cadastrada. Exibição e consultas permanecem manuais."
      );
    },
    onError: error => toast.error(error.message),
  });
  const sources = (catalog?.data ?? []) as InstitutionalSource[];
  const failed =
    isAuthenticated &&
    (!catalog || catalog.isError || (!catalog.isLoading && !catalog.data));
  return (
    <Card data-testid="institutional-sources-card">
      <CardHeader>
        <CardTitle className="text-lg">
          IPHAN, FUNAI e INCRA · serviços remotos
        </CardTitle>
        <CardDescription>
          Origens fixas verificadas com TLS estrito. Validação do serviço não é
          cadastro no banco nem garante disponibilidade contínua.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p>
          WMS: imagem direta do serviço. WFS: consulta explícita de até 50
          feições no recorte de até 2° por eixo, somente em memória. Sem
          importação, sem substituir camadas legadas ou alterar downloads.
        </p>
        {!isAuthenticated && (
          <p className="text-muted-foreground">
            Entre para consultar a disponibilidade das origens institucionais.
          </p>
        )}
        {catalog?.isLoading && (
          <p role="status">Consultando origens e tipos cadastrados…</p>
        )}
        {failed && (
          <p role="alert" className="text-destructive">
            Erro no catálogo institucional: não foi possível consultar as
            origens IPHAN, FUNAI e INCRA. O cadastro IBGE acima permanece
            independente. {catalog?.error?.message}{" "}
            <button
              type="button"
              className="underline"
              onClick={() => void catalog?.refetch()}
            >
              Tentar novamente
            </button>
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-3">
          {(["IPHAN", "FUNAI", "INCRA"] as const).map(publisher => {
            const source = sources.find(item => item.publisher === publisher);
            const registered = source ? sourceIsRegistered(source) : false;
            return (
              <article
                key={publisher}
                className="min-w-0 space-y-2 rounded-lg border p-3"
                data-publisher={publisher}
              >
                <h3 className="font-semibold">{source?.label || publisher}</h3>
                {source ? (
                  <>
                    <p className="break-words">{source.title}</p>
                    <Badge
                      variant={
                        source.status === "blocked"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {source.status === "validated"
                        ? "Origem validada"
                        : "Origem bloqueada"}
                    </Badge>
                    <p className="text-xs text-muted-foreground">
                      Edição: {source.edition || "não declarada"} · CRS de
                      origem: {source.sourceCrs || "não declarado"} · mapa
                      EPSG:3857.
                    </p>
                    <p className="text-xs">
                      Tipos conectados no banco:{" "}
                      {source.registeredTypes.length
                        ? source.registeredTypes
                            .map(type => type.toUpperCase())
                            .join(", ")
                        : "nenhum"}
                      .{" "}
                      {registered
                        ? "Cadastro dos tipos disponíveis concluído."
                        : "Cadastro remoto pendente ou parcial."}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Capacidades validadas:{" "}
                      {source.status === "validated"
                        ? [
                            source.supportsWms && "WMS 1.1.1",
                            source.supportsWfs && "WFS",
                          ]
                            .filter(Boolean)
                            .join(" · ") || "nenhuma"
                        : "indisponíveis"}
                      .
                    </p>
                    {source.status === "blocked" && (
                      <p
                        role="status"
                        className="break-words text-xs text-destructive"
                      >
                        Bloqueio:{" "}
                        {source.blocker || "Validação estrita pendente."}{" "}
                        Nenhuma conexão pode ser cadastrada ou ativada aqui.
                      </p>
                    )}
                    {user?.role === "admin" &&
                      source.status === "validated" &&
                      !registered &&
                      !failed && (
                        <Button
                          type="button"
                          size="sm"
                          disabled={
                            !register ||
                            register.isPending ||
                            catalog?.isFetching
                          }
                          onClick={() => register?.mutate({ publisher })}
                        >
                          {register?.isPending && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          Cadastrar {publisher} remoto
                        </Button>
                      )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Disponibilidade não confirmada; nenhuma conexão automática.
                  </p>
                )}
              </article>
            );
          })}
        </div>
        {user?.role !== "admin" && (
          <p className="text-xs text-muted-foreground">
            Somente administradores podem cadastrar origens validadas. Abrir
            esta tela não cadastra nem ativa serviços.
          </p>
        )}
        <Link href="/">
          <Button type="button" variant="outline">
            Abrir mapa — menu GeoServer
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
