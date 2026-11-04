import { useState } from "react";
import { ArrowRight, Loader2, Lock, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

/**
 * Formulário de login próprio (e-mail + senha, com segundo fator opcional).
 * Em sucesso, invalida a query de sessão para o app recarregar autenticado.
 */
export function LoginForm() {
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = trpc.auth.login.useMutation({
    onSuccess: async () => {
      setError(null);
      await utils.auth.me.invalidate();
    },
    onError: err => {
      if (err.message === "MFA_REQUIRED") {
        setNeedsMfa(true);
        setError("Informe o código do seu aplicativo autenticador.");
        return;
      }
      setNeedsMfa(prev => prev || err.message === "Código MFA inválido");
      setError(err.message || "Falha ao entrar.");
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate({
      email: email.trim(),
      password,
      totp: needsMfa && totp ? totp : undefined,
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-white/5 p-6 text-left backdrop-blur-sm"
    >
      <div className="space-y-2">
        <Label htmlFor="login-email" className="text-slate-200">
          E-mail
        </Label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            id="login-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="voce@exemplo.com"
            className="pl-9"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="login-password" className="text-slate-200">
          Senha
        </Label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            className="pl-9"
          />
        </div>
      </div>

      {needsMfa && (
        <div className="space-y-2">
          <Label htmlFor="login-totp" className="text-slate-200">
            Código de verificação (MFA)
          </Label>
          <div className="relative">
            <ShieldCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              id="login-totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={totp}
              onChange={e => setTotp(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="pl-9 tracking-[0.3em]"
            />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Button
        type="submit"
        size="lg"
        disabled={login.isPending}
        className="w-full bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/25 hover:from-orange-600 hover:to-orange-700"
      >
        {login.isPending ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <>
            Entrar
            <ArrowRight className="ml-2 h-5 w-5" />
          </>
        )}
      </Button>
    </form>
  );
}
