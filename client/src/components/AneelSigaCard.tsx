import { useEffect, useMemo, useState } from "react";
import { getQueryKey } from "@trpc/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  ANEEL_SIGA_ATTRIBUTION,
  ANEEL_SIGA_GEO_NOTICE,
  ANEEL_SIGA_SOURCE_URL,
  ANEEL_SIGA_UFS,
} from "@shared/aneelSiga";
import {
  ANEEL_SIGA_ALL_UFS,
  ANEEL_SIGA_PAGE_SIZE,
  aneelSigaGeneratedDates,
  aneelSigaInput,
  aneelSigaPower,
  aneelSigaQueriedAt,
  aneelSigaStatus,
  isAneelSigaUfFilter,
  type AneelSigaUfFilter,
} from "@/lib/aneelSigaPresentation";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { AlertTriangle, ExternalLink, Loader2, RefreshCw } from "lucide-react";

/** Identity changes remount local state and evict only this public source's query cache. */
export default function AneelSigaCard() {
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const identity =
    isAuthenticated && user ? `${user.id}:${user.openId}` : "anonymous";

  useEffect(() => {
    return () => {
      const queryKey = getQueryKey(trpc.aneelSiga);
      void queryClient.cancelQueries({ queryKey });
      queryClient.removeQueries({ queryKey });
    };
  }, [identity, queryClient]);

  return <AneelSigaSession key={identity} isAuthenticated={isAuthenticated} />;
}

function AneelSigaSession({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [uf, setUf] = useState<AneelSigaUfFilter>(ANEEL_SIGA_ALL_UFS);
  const [offset, setOffset] = useState(0);
  const [requested, setRequested] = useState(false);
  const input = useMemo(() => aneelSigaInput(uf, offset), [uf, offset]);
  const query = trpc.aneelSiga.query.useQuery(input, {
    enabled: isAuthenticated && requested,
    retry: false,
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    staleTime: 0,
    gcTime: 0,
    trpc: { abortOnUnmount: true },
  });
  const page = isAuthenticated && requested ? query.data : undefined;
  const fetching = isAuthenticated && requested && query.isFetching;
  const failed = requested && query.isError;
  const status = aneelSigaStatus({
    requested,
    fetching,
    failed,
    hasPreviousPage: Boolean(page),
  });
  const generatedDates = page ? aneelSigaGeneratedDates(page) : [];

  function consult() {
    if (!isAuthenticated || fetching) return;
    if (requested) {
      // A refresh/retry retains the exact current input (including its offset).
      void query.refetch();
    } else {
      setRequested(true);
    }
  }

  function changeUf(value: string) {
    if (!isAneelSigaUfFilter(value)) return;
    setUf(value);
    setOffset(0);
    // Selecting a filter alone never starts another remote query.
    setRequested(false);
  }

  return (
    <Card data-testid="aneel-siga-card">
      <CardHeader>
        <CardTitle className="text-lg">{ANEEL_SIGA_ATTRIBUTION}</CardTitle>
        <CardDescription>
          Sistema de Informações de Geração · consulta tabular manual, sem
          download ou camada no mapa.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="flex items-start gap-2">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <span>
              <strong>Limitação geográfica:</strong> {ANEEL_SIGA_GEO_NOTICE} Sem
              geometria precisa no mapa; não usado para interseção territorial.
            </span>
          </p>
        </div>
        <p className="text-muted-foreground">
          Abrir esta página não consulta a ANEEL. Cada consulta solicita até 20
          registros; não há agregação de potência nem deduplicação por CEG ou
          nome.
        </p>
        <a
          href={ANEEL_SIGA_SOURCE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 underline underline-offset-4"
        >
          Fonte oficial ANEEL — SIGA
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only"> (abre em nova aba)</span>
        </a>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="aneel-siga-uf" className="block font-medium">
              UF
            </label>
            <select
              id="aneel-siga-uf"
              value={uf}
              disabled={fetching}
              onChange={event => changeUf(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <option value={ANEEL_SIGA_ALL_UFS}>Todas as UFs</option>
              {ANEEL_SIGA_UFS.map(value => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            disabled={!isAuthenticated || fetching}
            onClick={consult}
          >
            {fetching ? (
              <Loader2
                className="mr-2 h-4 w-4 animate-spin"
                aria-hidden="true"
              />
            ) : page ? (
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            ) : null}
            {page ? "Atualizar dados" : "Consultar ANEEL"}
          </Button>
        </div>
        {!isAuthenticated && (
          <p className="text-muted-foreground">Entre para consultar a ANEEL.</p>
        )}
        <p
          role={failed && !fetching ? "alert" : "status"}
          className={
            failed && !fetching ? "text-destructive" : "text-muted-foreground"
          }
        >
          {status.message}
        </p>
        {failed && !fetching && (
          <p className="break-words text-destructive">
            Detalhe: {query.error?.message}
          </p>
        )}
        {page && (
          <section
            className="space-y-3"
            aria-label="Resultados da consulta ANEEL"
          >
            {status.oldData && (
              <Badge variant="secondary">Dados antigos — não atualizados</Badge>
            )}
            <p>
              <strong>{page.totalRecords.toLocaleString("pt-BR")}</strong>{" "}
              registros, não usinas únicas
              {uf !== ANEEL_SIGA_ALL_UFS ? ` · UF ${uf}` : " · Todas as UFs"}.
            </p>
            <dl className="space-y-1 text-xs text-muted-foreground">
              <div>
                <dt className="inline font-medium">
                  Consulta retornada (queriedAt):{" "}
                </dt>
                <dd className="inline">
                  <time dateTime={page.queriedAt}>
                    {aneelSigaQueriedAt(page.queriedAt)}
                  </time>
                </dd>
              </div>
              <div>
                <dt className="inline font-medium">
                  Datas de geração informadas nos registros desta página:{" "}
                </dt>
                <dd className="inline">
                  {generatedDates.length
                    ? generatedDates.join(" · ")
                    : "não informadas"}
                  .
                </dd>
              </div>
            </dl>
            {page.rows.length ? (
              <Table>
                <TableCaption>
                  Registros individuais da ANEEL — SIGA; repetições são
                  preservadas. Potência em kW, sem soma.
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Nome</TableHead>
                    <TableHead scope="col">CEG</TableHead>
                    <TableHead scope="col">UF</TableHead>
                    <TableHead scope="col">Fase</TableHead>
                    <TableHead scope="col" className="text-right">
                      Potência outorgada (kW)
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      Potência fiscalizada (kW)
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.rows.map((row, index) => (
                    <TableRow key={`${page.offset + index}:${row.recordId}`}>
                      <TableCell className="min-w-48 whitespace-normal">
                        {row.name || "—"}
                      </TableCell>
                      <TableCell>{row.ceg || "—"}</TableCell>
                      <TableCell>{row.uf || "—"}</TableCell>
                      <TableCell>{row.phase || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {aneelSigaPower(row.authorizedPowerKw)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {aneelSigaPower(row.monitoredPowerKw)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p>Nenhum registro retornado para esta seleção.</p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!isAuthenticated || fetching || offset === 0}
                onClick={() =>
                  setOffset(current =>
                    Math.max(0, current - ANEEL_SIGA_PAGE_SIZE)
                  )
                }
              >
                Anterior
              </Button>
              <span>
                Página {Math.floor(page.offset / ANEEL_SIGA_PAGE_SIZE) + 1} ·
                até 20 registros por página
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!isAuthenticated || fetching || !page.hasNext}
                onClick={() =>
                  setOffset(current => current + ANEEL_SIGA_PAGE_SIZE)
                }
              >
                Próxima
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Licença: {page.license}. Datas de geração não são garantia de
              atualidade; o horário da consulta não é a data de atualização do
              conjunto.
            </p>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
