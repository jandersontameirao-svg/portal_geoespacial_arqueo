import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { 
  ArrowLeft, 
  Database, 
  Download, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  RefreshCw,
  Settings,
  Play,
  Calendar,
  HardDrive
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

export default function Backups() {
  const { user, isAuthenticated } = useAuth();
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [scheduleFrequency, setScheduleFrequency] = useState("daily");
  const [scheduleTime, setScheduleTime] = useState("03:00");
  const [retentionDays, setRetentionDays] = useState(30);

  // Query para status de backup
  const { data: backupStatus, isLoading, refetch } = trpc.backup.status.useQuery(
    undefined,
    { enabled: isAuthenticated && user?.role === "admin" }
  );

  // Query para lista de backups
  const { data: backupList } = trpc.backup.list.useQuery(
    undefined,
    { enabled: isAuthenticated && user?.role === "admin" }
  );

  // Mutation para criar backup manual
  const createBackupMutation = trpc.backup.create.useMutation({
    onSuccess: (data) => {
      toast.success("Backup iniciado com sucesso!");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao criar backup");
    },
  });

  // Mutation para configurar agendamento
  const configureBackupMutation = trpc.backup.configure.useMutation({
    onSuccess: () => {
      toast.success("Configuração de backup atualizada!");
      setIsConfiguring(false);
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao configurar backup");
    },
  });

  const handleCreateBackup = () => {
    createBackupMutation.mutate({});
  };



  const handleSaveConfig = () => {
    const intervalMap: Record<string, number> = {
      daily: 24,
      weekly: 168,
      monthly: 720,
    };
    configureBackupMutation.mutate({
      enabled: scheduleEnabled,
      intervalHours: intervalMap[scheduleFrequency] || 24,
      retentionDays,
    });
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <Badge className="bg-green-100 text-green-700 border-green-200">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Concluído
          </Badge>
        );
      case "running":
        return (
          <Badge className="bg-blue-100 text-blue-700 border-blue-200">
            <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
            Em execução
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-red-100 text-red-700 border-red-200">
            <XCircle className="w-3 h-3 mr-1" />
            Falhou
          </Badge>
        );
      default:
        return (
          <Badge className="bg-slate-100 text-slate-700 border-slate-200">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Desconhecido
          </Badge>
        );
    }
  };

  if (!isAuthenticated || user?.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-red-500 flex items-center gap-2">
              <XCircle className="w-6 h-6" />
              Acesso Negado
            </CardTitle>
            <CardDescription>
              Apenas administradores podem acessar esta página.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/">
              <Button>Voltar ao Início</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <div className="container py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/admin">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
              <Database className="w-8 h-8 text-blue-500" />
              Gerenciamento de Backups
            </h1>
            <p className="text-slate-600 dark:text-slate-400 mt-1">
              Configure e gerencie backups automáticos do sistema
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Status do Último Backup */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-500" />
                Último Backup
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  <div className="h-4 bg-slate-200 rounded animate-pulse" />
                  <div className="h-4 bg-slate-200 rounded animate-pulse w-2/3" />
                </div>
              ) : backupStatus?.lastBackup ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Status:</span>
                    {getStatusBadge("completed")}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Data:</span>
                    <span className="text-sm font-medium">
                      {formatDate(backupStatus.lastBackup.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Por:</span>
                    <span className="text-sm font-medium">
                      {backupStatus.lastBackup.createdBy || "Sistema"}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">Nenhum backup realizado ainda.</p>
              )}
            </CardContent>
          </Card>

          {/* Estatísticas */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-green-500" />
                Estatísticas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">Total de Backups:</span>
                  <span className="text-sm font-medium">
                    {backupList?.length || 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">Status:</span>
                  <span className="text-sm font-medium">
                    {backupStatus?.healthy ? "Saudável" : "Atenção"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">Recomendação:</span>
                  <span className="text-xs text-slate-500">
                    {backupStatus?.recommendation || "Sem recomendações"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Ação Rápida */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Play className="w-5 h-5 text-orange-500" />
                Ação Rápida
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-500">
                Execute um backup manual imediatamente ou configure o agendamento automático.
              </p>
              <div className="flex gap-2">
                <Button 
                  onClick={handleCreateBackup}
                  disabled={createBackupMutation.isPending}
                  className="flex-1"
                >
                  {createBackupMutation.isPending ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 mr-2" />
                  )}
                  Backup Manual
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => setIsConfiguring(!isConfiguring)}
                >
                  <Settings className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Configuração de Agendamento */}
        {isConfiguring && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-purple-500" />
                Configuração de Agendamento
              </CardTitle>
              <CardDescription>
                Configure quando os backups automáticos devem ser executados
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Backup Automático</Label>
                    <Switch
                      checked={scheduleEnabled}
                      onCheckedChange={setScheduleEnabled}
                    />
                  </div>
                  <p className="text-xs text-slate-500">
                    Ativar ou desativar backups automáticos
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Frequência</Label>
                  <Select value={scheduleFrequency} onValueChange={setScheduleFrequency}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Diário</SelectItem>
                      <SelectItem value="weekly">Semanal</SelectItem>
                      <SelectItem value="monthly">Mensal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Horário</Label>
                  <Input
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Retenção (dias)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={retentionDays}
                    onChange={(e) => setRetentionDays(parseInt(e.target.value) || 30)}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <Button variant="outline" onClick={() => setIsConfiguring(false)}>
                  Cancelar
                </Button>
                <Button 
                  onClick={handleSaveConfig}
                  disabled={configureBackupMutation.isPending}
                >
                  {configureBackupMutation.isPending && (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  )}
                  Salvar Configuração
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Histórico de Backups */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Clock className="w-5 h-5" />
                Histórico de Backups
              </span>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Atualizar
              </Button>
            </CardTitle>
            <CardDescription>
              Lista dos últimos backups realizados
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 bg-slate-100 rounded animate-pulse" />
                ))}
              </div>
            ) : backupList && backupList.length > 0 ? (
              <div className="space-y-3">
                {backupList.map((backup: any, index: number) => (
                  <div
                    key={backup.id}
                    className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 rounded-lg"
                  >
                    <div className="flex items-center gap-4">
                      <Database className="w-8 h-8 text-slate-400" />
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">
                          Backup #{backup.id}
                        </p>
                        <p className="text-sm text-slate-500">
                          {formatDate(backup.createdAt)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-slate-500">
                        Por: {backup.createdBy || "Sistema"}
                      </span>
                      {getStatusBadge("completed")}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Database className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">
                  Nenhum backup encontrado
                </h3>
                <p className="text-slate-500 dark:text-slate-400 mb-4">
                  Execute seu primeiro backup para começar
                </p>
                <Button onClick={handleCreateBackup} disabled={createBackupMutation.isPending}>
                  <Download className="w-4 h-4 mr-2" />
                  Criar Primeiro Backup
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
