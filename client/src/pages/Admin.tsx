import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Users, FolderOpen, FileText, MapPin, HardDrive, Activity, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

export default function Admin() {
  const [page, setPage] = useState(0);
  const limit = 20;

  const { data: metrics, isLoading: metricsLoading, error: metricsError } = trpc.admin.getMetrics.useQuery();
  const { data: activityData } = trpc.admin.getActivityStats.useQuery({ days: 30 });
  const { data: logsData } = trpc.admin.getAuditLogs.useQuery({ 
    limit, 
    offset: page * limit 
  });

  if (metricsLoading) {
    return (
      <div className="container py-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  if (metricsError) {
    return (
      <div className="container py-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {metricsError.message || "Erro ao carregar métricas. Você precisa ser administrador para acessar esta página."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('pt-BR');
  };

  const getActionBadge = (action: string) => {
    if (action.includes('create')) return <Badge variant="default">Criar</Badge>;
    if (action.includes('update')) return <Badge variant="secondary">Atualizar</Badge>;
    if (action.includes('delete')) return <Badge variant="destructive">Deletar</Badge>;
    return <Badge variant="outline">{action}</Badge>;
  };

  // Processar dados de atividade para o gráfico
  const chartData = (Array.isArray(activityData) ? activityData : [])?.reduce((acc: any[], item: any) => {
    const date = item.date;
    const existing = acc.find(d => d.date === date);
    if (existing) {
      existing[item.action] = (existing[item.action] || 0) + Number(item.count);
      existing.total = (existing.total || 0) + Number(item.count);
    } else {
      acc.push({
        date,
        [item.action]: Number(item.count),
        total: Number(item.count),
      });
    }
    return acc;
  }, []).slice(0, 15).reverse() || [];

  const metricCards = [
    {
      title: "Projetos Ativos",
      value: metrics?.totalProjects || 0,
      icon: FolderOpen,
      description: "Total de projetos no sistema",
      color: "text-blue-600",
      bgColor: "bg-blue-50",
    },
    {
      title: "Usuários",
      value: metrics?.totalUsers || 0,
      icon: Users,
      description: "Usuários cadastrados",
      color: "text-green-600",
      bgColor: "bg-green-50",
    },
    {
      title: "Arquivos",
      value: metrics?.totalFiles || 0,
      icon: FileText,
      description: "Arquivos armazenados",
      color: "text-purple-600",
      bgColor: "bg-purple-50",
    },
    {
      title: "Geometrias",
      value: metrics?.totalGeometries || 0,
      icon: MapPin,
      description: "Geometrias desenhadas",
      color: "text-orange-600",
      bgColor: "bg-orange-50",
    },
    {
      title: "Armazenamento",
      value: formatBytes(metrics?.totalStorageBytes || 0),
      icon: HardDrive,
      description: "Espaço utilizado no S3",
      color: "text-red-600",
      bgColor: "bg-red-50",
    },
    {
      title: "Status do Sistema",
      value: "Operacional",
      icon: Activity,
      description: "Todos os serviços funcionando",
      color: "text-emerald-600",
      bgColor: "bg-emerald-50",
    },
  ];

  return (
    <div className="container py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Painel Administrativo</h1>
        <p className="text-muted-foreground mt-2">
          Visão geral do sistema e métricas em tempo real
        </p>
      </div>

      {/* Métricas em Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {metricCards.map((metric, index) => {
          const Icon = metric.icon;
          return (
            <Card key={index}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{metric.title}</CardTitle>
                <div className={`p-2 rounded-lg ${metric.bgColor}`}>
                  <Icon className={`h-4 w-4 ${metric.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{metric.value}</div>
                <p className="text-xs text-muted-foreground mt-1">{metric.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Gráfico de Atividade */}
      <Card>
        <CardHeader>
          <CardTitle>Atividade Recente</CardTitle>
          <CardDescription>Últimos 15 dias de atividade no sistema</CardDescription>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="total" fill="hsl(var(--primary))" name="Total de Ações" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground">
              Nenhuma atividade registrada nos últimos 30 dias
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabela de Logs de Auditoria */}
      <Card>
        <CardHeader>
          <CardTitle>Logs de Auditoria</CardTitle>
          <CardDescription>Últimas ações realizadas no sistema</CardDescription>
        </CardHeader>
        <CardContent>
          {logsData && logsData.logs.length > 0 ? (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data/Hora</TableHead>
                      <TableHead>Usuário</TableHead>
                      <TableHead>Ação</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>IP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logsData.logs.map((log: any) => (
                      <TableRow key={log.id}>
                        <TableCell className="font-mono text-xs">
                          {formatDate(log.timestamp)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium">{log.userName || 'N/A'}</span>
                            <span className="text-xs text-muted-foreground">{log.userEmail || 'N/A'}</span>
                          </div>
                        </TableCell>
                        <TableCell>{getActionBadge(log.action)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {log.entityType || 'N/A'}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {log.ipAddress || 'N/A'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              
              {/* Paginação simples */}
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Mostrando {page * limit + 1} a {Math.min((page + 1) * limit, logsData.total)} de {logsData.total} registros
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent"
                  >
                    Anterior
                  </button>
                  <button
                    onClick={() => setPage(p => p + 1)}
                    disabled={!logsData.hasMore}
                    className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-muted-foreground">
              Nenhum log de auditoria encontrado
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
