import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Globe2, Loader2 } from "lucide-react";

const CMR_ORGANIZATION = "inde-service-7780c680bcf29d1b";
const TERRITORY_LAYER = "CMR-PUBLICO:lim_terra_indigena_a";

/** Reuses the existing allowlisted catalog; never copies/updates the legacy FUNAI base. */
export default function FunaiOnlineSourceCard() {
  const { isAuthenticated } = useAuth();
  const [requested, setRequested] = useState(false);
  const catalog = trpc.indeCatalog.layers.useQuery({ organizationId: CMR_ORGANIZATION }, {
    enabled: isAuthenticated && requested, retry: false, staleTime: 0, refetchOnWindowFocus: false,
  });
  const valid = catalog.data?.organizationId === CMR_ORGANIZATION && catalog.data.layers.some(layer => layer.name === TERRITORY_LAYER);
  const query = () => { if (!requested) setRequested(true); else void catalog.refetch(); };
  return <Card data-testid="funai-online-source-card">
    <CardHeader>
      <CardTitle className="flex flex-wrap items-center gap-2 text-lg"><Globe2 className="h-5 w-5" />FUNAI/CMR — serviço on-line<Badge variant={catalog.isError ? "destructive" : valid ? "default" : "secondary"}>{catalog.isFetching ? "Consultando capacidades" : catalog.isError ? "Falha na reconsulta" : valid ? "Camada anunciada no serviço" : "Verificação sob demanda"}</Badge></CardTitle>
      <CardDescription>Limites públicos de terras indígenas · Fonte: FUNAI/CMR · WMS remoto do Centro de Monitoramento Remoto.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3 text-sm">
      <p>No mapa, abra GeoServer, busque FUNAI/CMR e marque a camada <code className="break-all">{TERRITORY_LAYER}</code>. WMS mostra uma imagem, não importa feições nem altera a base FUNAI antiga.</p>
      <p className="text-xs text-amber-800 dark:text-amber-300">O serviço principal da FUNAI é independente. A versão, data de atualização e equivalência de seus limites com o CMR não são presumidas. Não há troca silenciosa de bases nem download em massa.</p>
      {valid && <p>{catalog.data?.layers.length} camadas anunciadas · WMS {catalog.data?.version}. Isso não certifica todas as camadas nem a renderização de cada imagem.</p>}
      {catalog.isError && <p role="alert" className="text-destructive">Não foi possível reconsultar o CMR: {catalog.error.message}. A última lista em memória não certifica disponibilidade atual.</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={!isAuthenticated || catalog.isFetching} onClick={query}>{catalog.isFetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{requested ? "Reconsultar catálogo CMR" : "Verificar serviço FUNAI/CMR"}</Button>
        <Link href="/"><Button variant="ghost">Abrir mapa — GeoServer</Button></Link>
      </div>
      <p className="text-xs text-muted-foreground">Consulta manual de capacidades, com cache do servidor de até 5 minutos. As imagens WMS são solicitadas pelo enquadramento do mapa; desligar e ligar esta camada solicita nova imagem. Isso não força a atualização do banco institucional FUNAI.</p>
      {!isAuthenticated && <p className="text-xs text-muted-foreground">Autentique-se normalmente para consultar o serviço pelo Portal.</p>}
    </CardContent>
  </Card>;
}
