/**
 * PÁGINA: GERENCIAMENTO DE CAMADAS BASE
 * 
 * Permite visualizar, baixar e atualizar camadas de dados oficiais:
 * - FUNAI: Terras Indígenas
 * - INCRA: Terras Quilombolas
 * - IPHAN: Sítios Arqueológicos
 */

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Link } from "wouter";
import {
  Download,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  MapPin,
  Loader2,
  Database,
  Calendar,
} from "lucide-react";

export default function BaseLayers() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [downloading, setDownloading] = useState<string | null>(null);

  // Log de autenticação para debug
  useEffect(() => {
    console.log("[BaseLayers] Auth status:", { user, isAuthenticated, authLoading });
  }, [user, isAuthenticated, authLoading]);

  // Query para listar camadas
  const { data: layers, isLoading, refetch } = trpc.baseLayers.list.useQuery();

  // Mutations
  const downloadFunai = trpc.baseLayers.downloadFunai.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      refetch();
      setDownloading(null);
    },
    onError: (error) => {
      console.error("[FUNAI] Erro na mutation:", error);
      toast.error(`Erro ao baixar FUNAI: ${error.message}`);
      setDownloading(null);
    },
  });

  const downloadIncra = trpc.baseLayers.downloadIncra.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      refetch();
      setDownloading(null);
    },
    onError: (error) => {
      console.error("[INCRA] Erro na mutation:", error);
      toast.error(`Erro ao baixar INCRA: ${error.message}`);
      setDownloading(null);
    },
  });

  const downloadIphan = trpc.baseLayers.downloadIphan.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      refetch();
      setDownloading(null);
    },
    onError: (error) => {
      console.error("[IPHAN] Erro na mutation:", error);
      toast.error(`Erro ao baixar IPHAN: ${error.message}`);
      setDownloading(null);
    },
  });

  const downloadRodovias = trpc.baseLayers.downloadRodovias.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      refetch();
      setDownloading(null);
    },
    onError: (error) => {
      console.error("[Rodovias] Erro na mutation:", error);
      toast.error(`Erro ao baixar Rodovias: ${error.message}`);
      setDownloading(null);
    },
  });

  // Handlers
  const handleDownloadFunai = () => {
    setDownloading("funai");
    downloadFunai.mutate({ forceUpdate: false });
  };

  const handleDownloadIncra = () => {
    setDownloading("incra");
    downloadIncra.mutate({ forceUpdate: false });
  };

  const handleDownloadIphan = () => {
    setDownloading("iphan");
    downloadIphan.mutate({ forceUpdate: false });
  };

  const handleDownloadRodovias = () => {
    setDownloading("osm");
    downloadRodovias.mutate({ forceUpdate: false });
  };

  const handleForceUpdate = (source: string) => {
    setDownloading(source);
    if (source === "funai") {
      downloadFunai.mutate({ forceUpdate: true });
    } else if (source === "incra") {
      downloadIncra.mutate({ forceUpdate: true });
    } else if (source === "iphan") {
      downloadIphan.mutate({ forceUpdate: true });
    } else if (source === "osm") {
      downloadRodovias.mutate({ forceUpdate: true });
    }
  };

  // Encontrar camadas existentes
  const funaiLayer = layers?.find((l) => l.source === "funai");
  const incraLayer = layers?.find((l) => l.source === "incra");
  const iphanLayer = layers?.find((l) => l.source === "iphan");
  const osmLayer = layers?.find((l) => l.source === "osm" && l.layerType === "rodovias");

  // Helper para formatar data
  const formatDate = (date: Date | string | null) => {
    if (!date) return "Nunca";
    return new Date(date).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Helper para badge de status
  const StatusBadge = ({ status }: { status: string }) => {
    switch (status) {
      case "completed":
        return (
          <Badge variant="default" className="bg-green-500">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Completo
          </Badge>
        );
      case "downloading":
        return (
          <Badge variant="default" className="bg-blue-500">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Baixando
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive">
            <XCircle className="w-3 h-3 mr-1" />
            Falhou
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary">
            <Clock className="w-3 h-3 mr-1" />
            Pendente
          </Badge>
        );
    }
  };

  // Helper para verificar se cache expirou
  const isCacheExpired = (expiresAt: Date | string | null) => {
    if (!expiresAt) return true;
    return new Date() > new Date(expiresAt);
  };

  if (isLoading) {
    return (
      <div className="container py-8">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="container py-8">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Camadas Base</h1>
          <p className="text-muted-foreground">
            Gerencie camadas de dados geoespaciais de fontes oficiais brasileiras
          </p>
        </div>
        <Link href="/base-layers/viewer">
          <Button>
            <MapPin className="w-4 h-4 mr-2" />
            Visualizar no Mapa
          </Button>
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* FUNAI - Terras Indígenas */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-green-600" />
                  Terras Indígenas
                </CardTitle>
                <CardDescription>FUNAI</CardDescription>
              </div>
              {funaiLayer && <StatusBadge status={funaiLayer.downloadStatus} />}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {funaiLayer ? (
              <>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Features:</span>
                    <span className="font-medium flex items-center gap-1">
                      <Database className="w-3 h-3" />
                      {funaiLayer.featureCount?.toLocaleString() || "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Último download:</span>
                    <span className="font-medium flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatDate(funaiLayer.lastDownloadAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Cache expira:</span>
                    <span
                      className={`font-medium ${
                        isCacheExpired(funaiLayer.cacheExpiresAt)
                          ? "text-orange-500"
                          : "text-green-600"
                      }`}
                    >
                      {formatDate(funaiLayer.cacheExpiresAt)}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => handleForceUpdate("funai")}
                    disabled={downloading === "funai"}
                  >
                    {downloading === "funai" ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4 mr-2" />
                    )}
                    Atualizar
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Terras indígenas demarcadas pela FUNAI via WFS. Dados em SIRGAS 2000 (EPSG:4674).
                </p>
                <Button
                  className="w-full"
                  onClick={handleDownloadFunai}
                  disabled={downloading === "funai"}
                >
                  {downloading === "funai" ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 mr-2" />
                  )}
                  Baixar Camada
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* INCRA - Terras Quilombolas */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-purple-600" />
                  Terras Quilombolas
                </CardTitle>
                <CardDescription>INCRA</CardDescription>
              </div>
              {incraLayer && <StatusBadge status={incraLayer.downloadStatus} />}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {incraLayer ? (
              <>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Features:</span>
                    <span className="font-medium flex items-center gap-1">
                      <Database className="w-3 h-3" />
                      {incraLayer.featureCount?.toLocaleString() || "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Último download:</span>
                    <span className="font-medium flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatDate(incraLayer.lastDownloadAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Cache expira:</span>
                    <span
                      className={`font-medium ${
                        isCacheExpired(incraLayer.cacheExpiresAt)
                          ? "text-orange-500"
                          : "text-green-600"
                      }`}
                    >
                      {formatDate(incraLayer.cacheExpiresAt)}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => handleForceUpdate("incra")}
                    disabled={downloading === "incra"}
                  >
                    {downloading === "incra" ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4 mr-2" />
                    )}
                    Atualizar
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Territórios quilombolas titulados pelo INCRA. Shapefile compactado (ZIP).
                </p>
                <Button
                  className="w-full"
                  onClick={handleDownloadIncra}
                  disabled={downloading === "incra"}
                >
                  {downloading === "incra" ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 mr-2" />
                  )}
                  Baixar Camada
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* IPHAN - Sítios Arqueológicos */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-amber-600" />
                  Sítios Arqueológicos
                </CardTitle>
                <CardDescription>IPHAN</CardDescription>
              </div>
              {iphanLayer && <StatusBadge status={iphanLayer.downloadStatus} />}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {iphanLayer ? (
              <>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Features:</span>
                    <span className="font-medium flex items-center gap-1">
                      <Database className="w-3 h-3" />
                      {iphanLayer.featureCount?.toLocaleString() || "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Último download:</span>
                    <span className="font-medium flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatDate(iphanLayer.lastDownloadAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Cache expira:</span>
                    <span
                      className={`font-medium ${
                        isCacheExpired(iphanLayer.cacheExpiresAt)
                          ? "text-orange-500"
                          : "text-green-600"
                      }`}
                    >
                      {formatDate(iphanLayer.cacheExpiresAt)}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => handleForceUpdate("iphan")}
                    disabled={downloading === "iphan"}
                  >
                    {downloading === "iphan" ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4 mr-2" />
                    )}
                    Atualizar
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Sítios arqueológicos cadastrados no SICG/IPHAN. Mais de 30 mil sítios em todo o Brasil.
                </p>
                <Button
                  className="w-full"
                  onClick={handleDownloadIphan}
                  disabled={downloading === "iphan"}
                >
                  {downloading === "iphan" ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 mr-2" />
                  )}
                  Baixar Camada
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* OSM - Rodovias Federais */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-blue-600" />
                  Rodovias Federais
                </CardTitle>
                <CardDescription>OpenStreetMap</CardDescription>
              </div>
              {osmLayer && <StatusBadge status={osmLayer.downloadStatus} />}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {osmLayer ? (
              <>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Features:</span>
                    <span className="font-medium flex items-center gap-1">
                      <Database className="w-3 h-3" />
                      {osmLayer.featureCount?.toLocaleString() || "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Último download:</span>
                    <span className="font-medium flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatDate(osmLayer.lastDownloadAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Cache expira:</span>
                    <span
                      className={`font-medium ${
                        isCacheExpired(osmLayer.cacheExpiresAt)
                          ? "text-orange-500"
                          : "text-green-600"
                      }`}
                    >
                      {formatDate(osmLayer.cacheExpiresAt)}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => handleForceUpdate("osm")}
                    disabled={downloading === "osm"}
                  >
                    {downloading === "osm" ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4 mr-2" />
                    )}
                    Atualizar
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Rodovias federais (BR-xxx) do Brasil via OpenStreetMap. Dados atualizados pela comunidade OSM.
                </p>
                <Button
                  className="w-full"
                  onClick={handleDownloadRodovias}
                  disabled={downloading === "osm"}
                >
                  {downloading === "osm" ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 mr-2" />
                  )}
                  Baixar Camada
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Informações adicionais */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Sobre as Camadas Base</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            As camadas base são dados geoespaciais de fontes oficiais brasileiras, atualizados
            automaticamente com sistema de cache inteligente:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>
              <strong>FUNAI:</strong> Cache de 7 dias - Terras indígenas via WFS em SIRGAS 2000
            </li>
            <li>
              <strong>INCRA:</strong> Cache de 30 dias - Terras quilombolas em shapefile
            </li>
            <li>
              <strong>IPHAN:</strong> Cache de 14 dias - Sítios arqueológicos via WFS em SIRGAS 2000
            </li>
            <li>
              <strong>OSM:</strong> Cache de 30 dias - Rodovias federais via Overpass API
            </li>
          </ul>
          <p>
            Todas as camadas são armazenadas em S3 e podem ser utilizadas em projetos e mapas
            técnicos.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
