import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Plus, Mail, Clock, CheckCircle, XCircle, RefreshCw, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function Invitations() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newInvitation, setNewInvitation] = useState({
    email: "",
    role: "client" as "admin" | "editor" | "client",
  });

  // Queries
  const { data: invitations, isLoading, refetch } = trpc.invitations.list.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === "admin",
  });

  // Mutations
  const createMutation = trpc.invitations.create.useMutation({
    onSuccess: () => {
      toast.success("Convite enviado com sucesso!");
      setIsCreateDialogOpen(false);
      setNewInvitation({ email: "", role: "client" });
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao enviar convite");
    },
  });

  // TODO: Implementar mutations de resend e revoke no backend

  const handleCreateInvitation = () => {
    if (!newInvitation.email) {
      toast.error("Email é obrigatório");
      return;
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newInvitation.email)) {
      toast.error("Email inválido");
      return;
    }

    createMutation.mutate({
      email: newInvitation.email,
      role: newInvitation.role,
    });
  };

  const handleResend = (invitationId: number) => {
    toast.info("Funcionalidade de reenvio será implementada em breve");
  };

  const handleRevoke = (invitationId: number, email: string) => {
    toast.info("Funcionalidade de cancelamento será implementada em breve");
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400">
            <Clock className="w-3 h-3 mr-1" />
            Pendente
          </Badge>
        );
      case "accepted":
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400">
            <CheckCircle className="w-3 h-3 mr-1" />
            Aceito
          </Badge>
        );
      case "expired":
        return (
          <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-900/20 dark:text-gray-400">
            <XCircle className="w-3 h-3 mr-1" />
            Expirado
          </Badge>
        );
      case "revoked":
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400">
            <XCircle className="w-3 h-3 mr-1" />
            Cancelado
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getRoleBadge = (role: string) => {
    const colors = {
      admin: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
      editor: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
      client: "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400",
    };

    const labels = {
      admin: "Administrador",
      editor: "Editor",
      client: "Cliente",
    };

    return (
      <Badge className={colors[role as keyof typeof colors] || colors.client}>
        {labels[role as keyof typeof labels] || role}
      </Badge>
    );
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated || user?.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Acesso Restrito</CardTitle>
            <CardDescription>Apenas administradores podem acessar esta página.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-50">Convites</h1>
            <p className="text-slate-600 dark:text-slate-400 mt-2">
              Gerencie convites para novos usuários
            </p>
          </div>

          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button size="lg" className="gap-2">
                <Plus className="w-5 h-5" />
                Novo Convite
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Enviar Novo Convite</DialogTitle>
                <DialogDescription>
                  O usuário receberá um email com link para criar sua conta.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="email">Email *</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="usuario@exemplo.com"
                    value={newInvitation.email}
                    onChange={(e) => setNewInvitation({ ...newInvitation, email: e.target.value })}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="role">Função</Label>
                  <Select
                    value={newInvitation.role}
                    onValueChange={(value: "admin" | "editor" | "client") =>
                      setNewInvitation({ ...newInvitation, role: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="client">Cliente</SelectItem>
                      <SelectItem value="editor">Editor Interno</SelectItem>
                      <SelectItem value="admin">Administrador</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {newInvitation.role === "admin" && "Acesso total ao sistema"}
                    {newInvitation.role === "editor" && "Pode criar e editar projetos"}
                    {newInvitation.role === "client" && "Acesso apenas a projetos autorizados"}
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleCreateInvitation} disabled={createMutation.isPending}>
                  {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Enviar Convite
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Lista de Convites */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : invitations && invitations.length > 0 ? (
          <div className="grid gap-4">
            {invitations.map((invitation) => (
              <Card key={invitation.id}>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Mail className="w-5 h-5 text-slate-400" />
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                          {invitation.email}
                        </h3>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 mt-3">
                        {getStatusBadge(
                          invitation.usedAt ? "accepted" : 
                          new Date(invitation.expiresAt) < new Date() ? "expired" : 
                          "pending"
                        )}
                        {getRoleBadge(invitation.role)}
                        
                        <span className="text-sm text-slate-600 dark:text-slate-400">
                          Enviado em {format(new Date(invitation.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                        </span>

                        {invitation.expiresAt && (
                          <span className="text-sm text-slate-600 dark:text-slate-400">
                            Expira em {format(new Date(invitation.expiresAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 ml-4">
                      {!invitation.usedAt && new Date(invitation.expiresAt) >= new Date() && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleResend(invitation.id)}
                            disabled={false}
                            title="Reenviar convite"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRevoke(invitation.id, invitation.email)}
                            disabled={false}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                            title="Cancelar convite"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Mail className="w-16 h-16 text-slate-300 dark:text-slate-700 mb-4" />
              <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-50 mb-2">
                Nenhum convite enviado
              </h3>
              <p className="text-slate-600 dark:text-slate-400 text-center mb-6">
                Comece enviando convites para novos usuários acessarem o sistema.
              </p>
              <Button onClick={() => setIsCreateDialogOpen(true)} className="gap-2">
                <Plus className="w-5 h-5" />
                Enviar Primeiro Convite
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
