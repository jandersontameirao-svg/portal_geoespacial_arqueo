import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Sparkles, Send, Brain, Trash2, CheckCircle2, BookmarkPlus, AlertTriangle } from "lucide-react";

type ChatMsg = { role: "user" | "assistant"; content: string };
type Suggestion = {
  memoriaSugerida: string;
  categoria: string;
  acaoSugerida: { tipo: string; titulo: string; dados: Record<string, unknown> } | null;
};

export default function AssistenteAtena() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const utils = trpc.useUtils();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [input, setInput] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const status = trpc.atenaChat.status.useQuery(undefined, { enabled: isAuthenticated });
  const history = trpc.atenaChat.history.useQuery(undefined, { enabled: isAuthenticated });
  const memories = trpc.atenaChat.memories.list.useQuery(undefined, { enabled: isAuthenticated });

  useEffect(() => {
    if (!seeded && history.data) {
      setMessages(history.data.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })));
      setSeeded(true);
    }
  }, [history.data, seeded]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const chat = trpc.atenaChat.chat.useMutation({
    onSuccess: (reply) => {
      setMessages((cur) => [...cur, { role: "assistant", content: reply.resposta }]);
      setSuggestion({ memoriaSugerida: reply.memoriaSugerida, categoria: reply.categoria, acaoSugerida: reply.acaoSugerida });
    },
    onError: (e) => {
      toast.error(e.message || "Falha ao falar com a Atena.");
      setMessages((cur) => cur.slice(0, -1)); // remove a mensagem do usuário sem resposta
    },
  });

  const saveMemory = trpc.atenaChat.memories.save.useMutation({
    onSuccess: () => {
      toast.success("Diretriz salva na memória da Atena.");
      setSuggestion((s) => (s ? { ...s, memoriaSugerida: "" } : s));
      utils.atenaChat.memories.list.invalidate();
    },
    onError: (e) => toast.error(e.message || "Erro ao salvar memória."),
  });

  const deactivate = trpc.atenaChat.memories.deactivate.useMutation({
    onSuccess: () => utils.atenaChat.memories.list.invalidate(),
    onError: (e) => toast.error(e.message || "Erro ao remover memória."),
  });

  const executeAction = trpc.atenaChat.executeAction.useMutation({
    onSuccess: () => {
      toast.success("Ação executada: observação criada.");
      setSuggestion((s) => (s ? { ...s, acaoSugerida: null } : s));
    },
    onError: (e) => toast.error(e.message || "Erro ao executar ação."),
  });

  const send = () => {
    const text = input.trim();
    if (!text || chat.isPending) return;
    setMessages((cur) => [...cur, { role: "user", content: text }]);
    setSuggestion(null);
    setInput("");
    chat.mutate({ message: text });
  };

  const runAction = () => {
    const acao = suggestion?.acaoSugerida;
    if (!acao || acao.tipo !== "criar_observacao") return;
    const d = acao.dados as Record<string, string>;
    executeAction.mutate({
      tipo: "criar_observacao",
      dados: {
        titulo: String(d.titulo || acao.titulo || "Observação").slice(0, 255),
        descricao: String(d.descricao || acao.titulo || "").slice(0, 10000) || "Sem descrição.",
        categoria: (["reclamacao", "melhoria", "bug", "caracteristica"].includes(String(d.categoria)) ? d.categoria : "melhoria") as any,
        area: d.area ? String(d.area).slice(0, 120) : undefined,
      },
    });
  };

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }
  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md"><CardHeader><CardTitle>Acesso Restrito</CardTitle><CardDescription>Faça login para usar a Atena.</CardDescription></CardHeader></Card>
      </div>
    );
  }

  const notConfigured = status.data && !status.data.configured;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container py-8">
        <div className="mb-6">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
            <Sparkles className="h-8 w-8 text-orange-500" />
            Assistente Atena
          </h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2">
            Converse sobre o sistema e os dados reais. A Atena aprende diretrizes e propõe ações — você confirma.
          </p>
        </div>

        {notConfigured && (
          <Card className="mb-4 border-amber-300 bg-amber-50/60 dark:bg-amber-900/10">
            <CardContent className="flex items-start gap-2 py-4 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Provedor de IA não configurado neste ambiente. Defina <code className="mx-1">OPENAI_API_KEY</code> no servidor para ativar o chat.
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="flex h-[70vh] flex-col">
            <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-4">
              <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                {messages.length === 0 && (
                  <p className="py-10 text-center text-sm text-slate-400">
                    Comece perguntando algo como “quantos projetos ativos temos?” ou “como imprimo um mapa técnico?”.
                  </p>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${m.role === "user" ? "bg-orange-500 text-white" : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100"}`}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {chat.isPending && (
                  <div className="flex justify-start"><div className="rounded-2xl bg-slate-100 px-4 py-2 dark:bg-slate-800"><Loader2 className="h-4 w-4 animate-spin" /></div></div>
                )}
              </div>

              {suggestion && (suggestion.memoriaSugerida || suggestion.acaoSugerida) && (
                <div className="space-y-2 rounded-lg border border-orange-200 bg-orange-50/60 p-3 dark:border-orange-900 dark:bg-orange-900/10">
                  {suggestion.memoriaSugerida && (
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 text-sm">
                        <span className="font-medium text-orange-700 dark:text-orange-400">Diretriz sugerida</span>
                        <p className="text-slate-700 dark:text-slate-300">[{suggestion.categoria}] {suggestion.memoriaSugerida}</p>
                      </div>
                      <Button size="sm" variant="outline" disabled={saveMemory.isPending} onClick={() => saveMemory.mutate({ diretriz: suggestion.memoriaSugerida, categoria: suggestion.categoria as any })}>
                        <BookmarkPlus className="mr-1 h-4 w-4" /> Salvar
                      </Button>
                    </div>
                  )}
                  {suggestion.acaoSugerida && (
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 text-sm">
                        <span className="font-medium text-orange-700 dark:text-orange-400">Ação sugerida</span>
                        <p className="text-slate-700 dark:text-slate-300">{suggestion.acaoSugerida.titulo || suggestion.acaoSugerida.tipo}</p>
                      </div>
                      <Button size="sm" disabled={executeAction.isPending} onClick={runAction}>
                        <CheckCircle2 className="mr-1 h-4 w-4" /> Confirmar e executar
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                  placeholder={notConfigured ? "IA indisponível" : "Escreva sua mensagem…"}
                  disabled={!!notConfigured || chat.isPending}
                />
                <Button onClick={send} disabled={!!notConfigured || chat.isPending || !input.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Brain className="h-4 w-4 text-violet-600" /> Memórias da Atena</CardTitle>
              <CardDescription>Diretrizes ativas injetadas em toda conversa.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {memories.isLoading ? (
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              ) : (memories.data?.length ?? 0) === 0 ? (
                <p className="text-sm text-slate-400">Nenhuma diretriz salva ainda.</p>
              ) : (
                memories.data!.map((mem) => (
                  <div key={mem.id} className="flex items-start justify-between gap-2 rounded border p-2">
                    <div className="min-w-0">
                      <Badge variant="outline" className="mb-1 text-[10px]">{mem.categoria}</Badge>
                      <p className="text-xs text-slate-700 dark:text-slate-300">{mem.diretriz}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => deactivate.mutate({ id: mem.id })}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
