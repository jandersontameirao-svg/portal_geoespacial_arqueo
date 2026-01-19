/**
 * GIS Diagnostics Page - Sprint A
 * 
 * Página de diagnósticos do motor GIS mostrando status dos serviços:
 * - PostGIS, QGIS Server, Redis, Worker
 */

import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  Activity, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  RefreshCw, 
  Database, 
  Server, 
  Layers,
  Cpu
} from 'lucide-react';

type ServiceStatus = {
  name: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  message: string;
  responseTime?: number;
  details?: Record<string, unknown>;
};

type DiagnosticsResult = {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  services: ServiceStatus[];
};

function getStatusIcon(status: string) {
  switch (status) {
    case 'healthy':
      return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    case 'unhealthy':
      return <XCircle className="h-5 w-5 text-red-500" />;
    default:
      return <AlertCircle className="h-5 w-5 text-yellow-500" />;
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'healthy':
      return <Badge variant="default" className="bg-green-500">Saudável</Badge>;
    case 'unhealthy':
      return <Badge variant="destructive">Indisponível</Badge>;
    default:
      return <Badge variant="secondary">Desconhecido</Badge>;
  }
}

function getServiceIcon(serviceName: string) {
  switch (serviceName) {
    case 'PostGIS':
      return <Database className="h-5 w-5" />;
    case 'QGIS Server':
      return <Server className="h-5 w-5" />;
    case 'Redis':
      return <Layers className="h-5 w-5" />;
    case 'Worker':
      return <Cpu className="h-5 w-5" />;
    default:
      return <Activity className="h-5 w-5" />;
  }
}

export default function GISDiagnostics() {
  const [autoRefresh, setAutoRefresh] = useState(false);
  const { data: diagnostics, isLoading, refetch } = trpc.gisDiagnostics.getStatus.useQuery(
    undefined,
    {
      refetchInterval: autoRefresh ? 5000 : false, // Auto-refresh every 5s if enabled
    }
  );
  
  useEffect(() => {
    // Initial fetch
    refetch();
  }, [refetch]);
  
  const handleRefresh = () => {
    refetch();
  };
  
  const handleToggleAutoRefresh = () => {
    setAutoRefresh(!autoRefresh);
  };
  
  return (
    <div className="container py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Diagnósticos do Motor GIS</h1>
          <p className="text-muted-foreground">
            Status dos serviços de infraestrutura geoespacial
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleAutoRefresh}
            className={autoRefresh ? 'bg-primary/10' : ''}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${autoRefresh ? 'animate-spin' : ''}`} />
            {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>
      
      {/* Overall Status */}
      {diagnostics && (
        <Alert className={`mb-6 ${
          diagnostics.overall === 'healthy' 
            ? 'border-green-500 bg-green-50 dark:bg-green-950' 
            : diagnostics.overall === 'degraded'
            ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950'
            : 'border-red-500 bg-red-50 dark:bg-red-950'
        }`}>
          {diagnostics.overall === 'healthy' ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : diagnostics.overall === 'degraded' ? (
            <AlertCircle className="h-4 w-4 text-yellow-500" />
          ) : (
            <XCircle className="h-4 w-4 text-red-500" />
          )}
          <AlertTitle>
            {diagnostics.overall === 'healthy' 
              ? 'Todos os Serviços Operacionais' 
              : diagnostics.overall === 'degraded'
              ? 'Alguns Serviços Indisponíveis'
              : 'Sistema Indisponível'}
          </AlertTitle>
          <AlertDescription>
            Última verificação: {new Date(diagnostics.timestamp).toLocaleString('pt-BR')}
          </AlertDescription>
        </Alert>
      )}
      
      {/* Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {diagnostics?.services.map((service) => (
          <Card key={service.name}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getServiceIcon(service.name)}
                  <CardTitle className="text-lg">{service.name}</CardTitle>
                </div>
                {getStatusBadge(service.status)}
              </div>
              <CardDescription>
                {service.message}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {/* Response Time */}
                {service.responseTime !== undefined && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Tempo de Resposta</span>
                    <span className="font-mono font-medium">
                      {service.responseTime}ms
                    </span>
                  </div>
                )}
                
                {/* Details */}
                {service.details && Object.keys(service.details).length > 0 && (
                  <div className="space-y-2 pt-3 border-t">
                    <div className="text-sm font-medium text-muted-foreground">Detalhes</div>
                    {Object.entries(service.details).map(([key, value]) => (
                      <div key={key} className="flex items-start justify-between text-sm gap-4">
                        <span className="text-muted-foreground capitalize">
                          {key.replace(/_/g, ' ')}
                        </span>
                        <span className="font-mono text-xs text-right break-all max-w-[60%]">
                          {typeof value === 'object' 
                            ? JSON.stringify(value, null, 2)
                            : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      
      {/* Loading State */}
      {isLoading && !diagnostics && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}
      
      {/* Documentation */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Sobre os Serviços</CardTitle>
          <CardDescription>
            Descrição dos componentes do motor GIS
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="font-medium flex items-center gap-2 mb-1">
              <Database className="h-4 w-4" />
              PostGIS
            </div>
            <p className="text-sm text-muted-foreground">
              Banco de dados geoespacial baseado em PostgreSQL. Armazena geometrias, 
              realiza consultas espaciais e suporta sistemas de coordenadas (CRS).
            </p>
          </div>
          
          <div>
            <div className="font-medium flex items-center gap-2 mb-1">
              <Server className="h-4 w-4" />
              QGIS Server
            </div>
            <p className="text-sm text-muted-foreground">
              Servidor WMS que publica projetos QGIS via HTTP. Renderiza mapas sob demanda 
              e fornece GetCapabilities, GetMap e GetFeatureInfo.
            </p>
          </div>
          
          <div>
            <div className="font-medium flex items-center gap-2 mb-1">
              <Layers className="h-4 w-4" />
              Redis
            </div>
            <p className="text-sm text-muted-foreground">
              Cache em memória para armazenar resultados de consultas, tiles WMS e 
              fila de jobs assíncronos (conversão de Shapefiles, geração de mapas).
            </p>
          </div>
          
          <div>
            <div className="font-medium flex items-center gap-2 mb-1">
              <Cpu className="h-4 w-4" />
              Worker
            </div>
            <p className="text-sm text-muted-foreground">
              Processador assíncrono de jobs pesados: conversão de formatos (SHP→GeoJSON), 
              geração de mapas ABNT, processamento de atlas e validação de arquivos.
            </p>
          </div>
        </CardContent>
      </Card>
      
      {/* Quick Actions */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Ações Rápidas</CardTitle>
          <CardDescription>
            Links úteis para gerenciar a infraestrutura GIS
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button variant="outline" className="w-full justify-start" asChild>
            <a href="/wms-demo" target="_blank">
              <Layers className="h-4 w-4 mr-2" />
              Ver Demonstração WMS
            </a>
          </Button>
          
          <Button variant="outline" className="w-full justify-start" asChild>
            <a href="http://localhost:8080/ows?SERVICE=WMS&REQUEST=GetCapabilities" target="_blank" rel="noopener noreferrer">
              <Server className="h-4 w-4 mr-2" />
              GetCapabilities (QGIS Server)
            </a>
          </Button>
          
          <Button variant="outline" className="w-full justify-start" asChild>
            <a href="http://localhost:3001/health" target="_blank" rel="noopener noreferrer">
              <Activity className="h-4 w-4 mr-2" />
              Health Check (Worker)
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
