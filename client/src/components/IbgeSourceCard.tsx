import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Loader2, Globe2 } from "lucide-react";
import { toast } from "sonner";

/** Metadata only: this card never downloads/imports geographic files. */
export default function IbgeSourceCard() {
  const { user, isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const catalog = trpc.ogcCatalog.listPublished.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const ibge = (catalog.data ?? []).filter(item => item.selected?.remoteLayer === "CGEO:C02_recortes_territoriais_municipio_2010");
  const hasWms = ibge.some(item => item.selected?.serviceType === "wms");
  const hasWfs = ibge.some(item => item.selected?.serviceType === "wfs");
  const registered = hasWms && hasWfs;
  const register = trpc.ogcCatalog.registerIbge.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.ogcCatalog.listPublished.invalidate(), utils.ogcCatalog.listServices.invalidate()]);
      toast.success("Origem IBGE cadastrada: WMS visual e WFS de consulta remota.");
    },
    onError: error => toast.error(error.message),
  });
  return <Card data-testid="ibge-source-card">
    <CardHeader>
      <CardTitle className="flex flex-wrap items-center gap-2 text-lg"><Globe2 className="h-5 w-5" />IBGE<Badge variant={registered ? "default" : "secondary"}>{catalog.isFetching ? "Consultando cadastro" : registered ? "WMS e WFS cadastrados" : "Cadastro remoto pendente"}</Badge></CardTitle>
      <CardDescription>Municípios — edição 2010 · Fonte: IBGE · serviços remotos, sem baixar ou instalar malhas.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3 text-sm">
      <p>WMS: visualização em mapa. WFS: consulta limitada ao recorte visível, em memória. Não é importação permanente e não altera as bases FUNAI, INCRA, IPHAN ou OpenStreetMap.</p>
      <p className="break-all text-xs text-muted-foreground">Camada: CGEO:C02_recortes_territoriais_municipio_2010 · origem EPSG:4674 · mapa EPSG:3857.</p>
      <p className="text-xs text-amber-800 dark:text-amber-300">Estatísticas/Agregados e união com população: indisponíveis nesta etapa; conexão JSON ainda não validada. A malha 2025 usada pela Atena permanece separada e preservada.</p>
      {catalog.error && <p role="alert" className="text-destructive">Não foi possível consultar o cadastro: {catalog.error.message}</p>}
      <div className="flex flex-wrap gap-2">
        {user?.role === "admin" && !registered && <Button type="button" disabled={register.isPending || catalog.isFetching || Boolean(catalog.error)} onClick={() => register.mutate()}>{register.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Cadastrar IBGE remoto</Button>}
        <Link href="/"><Button variant="outline">Abrir mapa — menu GeoServer</Button></Link>
        {user?.role === "admin" && <Link href="/admin/ogc-catalog"><Button variant="ghost">Gerenciar geosserviços</Button></Link>}
      </div>
      {!registered && user?.role !== "admin" && <p className="text-xs text-muted-foreground">Somente um administrador pode cadastrar a origem. Nenhum cadastro é criado automaticamente ao abrir esta tela.</p>}
      <p className="text-xs text-muted-foreground">A disponibilidade remota é verificada na consulta; cadastro não garante disponibilidade contínua do IBGE.</p>
    </CardContent>
  </Card>;
}
