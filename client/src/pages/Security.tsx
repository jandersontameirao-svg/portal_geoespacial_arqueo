import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, Key, Copy, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function Security() {
  const [verificationCode, setVerificationCode] = useState("");
  const [disableCode, setDisableCode] = useState("");

  // Queries
  const { data: mfaStatus, refetch: refetchStatus } = trpc.mfa.getStatus.useQuery();
  
  // Mutations
  const setupMFA = trpc.mfa.setupMFA.useMutation();

  const enableMFA = trpc.mfa.verifyAndEnableMFA.useMutation({
    onSuccess: () => {
      toast.success("MFA Ativado", {
        description: "Autenticação de dois fatores ativada com sucesso!",
      });
      refetchStatus();
      setVerificationCode("");
    },
    onError: (error) => {
      toast.error("Erro ao Ativar MFA", {
        description: error.message,
      });
    },
  });

  const disableMFA = trpc.mfa.disableMFA.useMutation({
    onSuccess: () => {
      toast.success("MFA Desativado", {
        description: "Autenticação de dois fatores desativada.",
      });
      refetchStatus();
      setDisableCode("");
    },
    onError: (error) => {
      toast.error("Erro ao Desativar MFA", {
        description: error.message,
      });
    },
  });

  const generateBackup = trpc.mfa.generateBackupCodes.useMutation({
    onSuccess: (data) => {
      toast.success("Códigos de Backup Gerados", {
        description: `${data.codes.length} códigos criados. Salve-os em local seguro!`,
      });
    },
  });

  const handleSetupMFA = () => {
    setupMFA.mutate();
  };

  const handleEnableMFA = () => {
    if (verificationCode.length !== 6) {
      toast.error("Código Inválido", {
        description: "O código deve ter 6 dígitos",
      });
      return;
    }
    enableMFA.mutate({ token: verificationCode });
  };

  const handleDisableMFA = () => {
    if (disableCode.length !== 6) {
      toast.error("Código Inválido", {
        description: "O código deve ter 6 dígitos",
      });
      return;
    }
    disableMFA.mutate({ token: disableCode });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado!", {
      description: "Texto copiado para a área de transferência",
    });
  };

  if (!mfaStatus) {
    return (
      <div className="container max-w-4xl py-8">
        <div className="flex items-center gap-2 mb-6">
          <Shield className="w-8 h-8 text-primary" />
          <h1 className="text-3xl font-bold">Segurança</h1>
        </div>
        <p>Carregando...</p>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl py-8">
      <div className="flex items-center gap-2 mb-6">
        <Shield className="w-8 h-8 text-primary" />
        <h1 className="text-3xl font-bold">Segurança</h1>
      </div>

      {/* Status do MFA */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="w-5 h-5" />
            Autenticação de Dois Fatores (MFA)
          </CardTitle>
          <CardDescription>
            Adicione uma camada extra de segurança à sua conta
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="font-medium">Status: {mfaStatus.enabled ? "Ativo" : "Inativo"}</p>
              {mfaStatus.required && (
                <p className="text-sm text-muted-foreground">
                  MFA é obrigatório para seu perfil ({mfaStatus.role})
                </p>
              )}
            </div>
            {mfaStatus.enabled ? (
              <CheckCircle2 className="w-6 h-6 text-green-600" />
            ) : (
              <AlertCircle className="w-6 h-6 text-yellow-600" />
            )}
          </div>

          {mfaStatus.required && !mfaStatus.enabled && (
            <Alert className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                MFA é obrigatório para administradores e editores. Configure agora para manter sua conta segura.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Configurar MFA */}
      {!mfaStatus.enabled && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Configurar MFA</CardTitle>
            <CardDescription>
              Use um aplicativo autenticador como Google Authenticator ou Authy
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!setupMFA.data ? (
              <Button onClick={handleSetupMFA}>
                Iniciar Configuração
              </Button>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>1. Escaneie o QR Code com seu aplicativo autenticador</Label>
                  <div className="flex justify-center p-4 bg-white rounded-lg">
                    <img src={setupMFA.data.qrCode} alt="QR Code MFA" className="w-48 h-48" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>2. Ou insira manualmente esta chave:</Label>
                  <div className="flex gap-2">
                    <Input value={setupMFA.data.secret} readOnly className="font-mono" />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => copyToClipboard(setupMFA.data.secret)}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="verificationCode">
                    3. Digite o código de 6 dígitos do aplicativo
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="verificationCode"
                      placeholder="000000"
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      maxLength={6}
                      className="font-mono text-lg tracking-widest"
                    />
                    <Button
                      onClick={handleEnableMFA}
                      disabled={enableMFA.isPending || verificationCode.length !== 6}
                    >
                      {enableMFA.isPending ? "Verificando..." : "Ativar MFA"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Desativar MFA */}
      {mfaStatus.enabled && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Desativar MFA</CardTitle>
            <CardDescription>
              Digite um código do seu aplicativo autenticador para desativar
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                placeholder="000000"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                maxLength={6}
                className="font-mono text-lg tracking-widest"
              />
              <Button
                variant="destructive"
                onClick={handleDisableMFA}
                disabled={disableMFA.isPending || disableCode.length !== 6}
              >
                {disableMFA.isPending ? "Desativando..." : "Desativar"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Códigos de Backup */}
      {mfaStatus.enabled && (
        <Card>
          <CardHeader>
            <CardTitle>Códigos de Backup</CardTitle>
            <CardDescription>
              Gere códigos de backup para usar caso perca acesso ao seu autenticador
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => generateBackup.mutate()}
              disabled={generateBackup.isPending}
            >
              {generateBackup.isPending ? "Gerando..." : "Gerar Novos Códigos"}
            </Button>

            {generateBackup.data && (
              <div className="mt-4 p-4 bg-muted rounded-lg">
                <p className="font-medium mb-2">Códigos de Backup:</p>
                <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                  {generateBackup.data.codes.map((code, i) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-background rounded">
                      <span>{code}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => copyToClipboard(code)}
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Alert className="mt-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Salve estes códigos em local seguro. Cada código pode ser usado apenas uma vez.
                  </AlertDescription>
                </Alert>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
