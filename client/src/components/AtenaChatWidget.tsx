import { useEffect, useRef, useState, type FormEvent } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { useLocation, useSearch } from "wouter";
import { ArrowUpRight, CheckCircle2, Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { trpc } from "@/lib/trpc";
import { atenaNavigationPath, authorizedAtenaProject, classifyAtenaChatCommand, parseAtenaProjectId, type AtenaAnalysisRequest, type AtenaNavigationTarget } from "@/lib/atenaChatCommands";

type Project = { id: number; name: string; code: string };
type Plan = Extract<inferRouterOutputs<AppRouter>["atena"]["plan"], { status: "ready" }>["plan"];
type PendingPlan = { projectId: number; request: AtenaAnalysisRequest; requestText: string; plan: Plan };
type Message = { id: string; role: "user" | "assistant"; content: string; projects?: Project[] };
const ACTIVE = ["queued", "running", "cancel_requested"];
const LABELS: Record<string, string> = { queued: "Na fila", running: "Executando", cancel_requested: "Cancelamento solicitado", completed: "Concluída", failed: "Falhou", cancelled: "Cancelada" };
const NAV_LABELS: Record<AtenaNavigationTarget, string> = { map: "Mapa", projects: "Projetos", files: "Arquivos", atlas: "Atlas", backups: "Backups", atena: "Atena" };
const welcome = (): Message[] => [{ id: "welcome", role: "assistant", content: "Olá. Posso listar projetos acessíveis, abrir módulos do Geoportal e preparar planos GIS de buffer ou interseção. Nada é executado sem revisão e confirmação explícita. Modelos, áreas de influência e prospecção estão na página Atena." }];
const errorText = (error: unknown) => error instanceof Error ? error.message : "Resposta indisponível.";

/** Não usa AIChatBox: os cartões de projeto e plano exigem controles de confirmação próprios. */
export default function AtenaChatWidget({ previewMode = false }: { previewMode?: boolean }) {
  const auth = trpc.auth.me.useQuery(undefined, { enabled: !previewMode, retry: false, refetchOnWindowFocus: false });
  if (!previewMode && !auth.data) return null;
  return <AtenaChatSession key={previewMode ? "synthetic" : auth.data!.id} previewMode={previewMode} />;
}
function AtenaChatSession({ previewMode }: { previewMode: boolean }) {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const [open, setOpen] = useState(previewMode);
  const [draft, setDraft] = useState("");
  const [selectedId, setSelectedId] = useState<number>();
  const [messages, setMessages] = useState<Message[]>(previewMode ? [{ id: "preview", role: "assistant", content: "Prévia sintética: nenhuma sessão, API, IA ou execução está habilitada." }] : welcome);
  const [pending, setPending] = useState<PendingPlan | null>(null);
  const [lastRun, setLastRun] = useState<{ id: number; projectId: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const transcript = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const revision = useRef(0);
  const working = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; revision.current++; }; }, []);
  const projects = trpc.projects.list.useQuery(undefined, { enabled: !previewMode && open, retry: false });
  const routeCandidate = parseAtenaProjectId(location, search);
  const hasRouteCandidate = /^\/projects\/\d+\/?$/.test(location.split("?")[0]) || new URLSearchParams(search).has("projectId");
  const candidate = hasRouteCandidate ? routeCandidate : selectedId;
  const project = !projects.isError ? authorizedAtenaProject(candidate, projects.data) : undefined;
  const projectId = project?.id;
  const currentProject = useRef(projectId); currentProject.current = projectId;
  const interpret = trpc.atena.interpret.useMutation();
  const plan = trpc.atena.plan.useMutation();
  const run = trpc.atena.run.useMutation();
  const cancel = trpc.atena.cancel.useMutation();
  const access = trpc.prospect.sources.useQuery({ projectId: projectId ?? 0 }, { enabled: !previewMode && open && Boolean(projectId), retry: false });
  const runQuery = trpc.atena.get.useQuery({ runId: lastRun?.id ?? 0 }, { enabled: !previewMode && open && Boolean(lastRun) && lastRun?.projectId === projectId, retry: false, refetchInterval: query => ACTIVE.includes(query.state.data?.status ?? "") ? 1500 : false });
  const isActive = ACTIVE.includes(runQuery.data?.status ?? "");
  const canWrite = access.isSuccess && access.data.canWrite;
  const append = (content: string, choices?: Project[]) => { if (mounted.current) setMessages(current => [...current, { id: crypto.randomUUID(), role: "assistant", content, projects: choices }]); };
  const invalidateContext = () => { revision.current++; setPending(null); setLastRun(null); };
  useEffect(() => { invalidateContext(); }, [location, search, projectId]);
  useEffect(() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: "smooth" }); }, [messages, pending, runQuery.data?.status]);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); requestAnimationFrame(() => launcher.current?.focus()); } };
    window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape);
  }, [open]);
  const choose = (row: Project) => {
    const allowed = authorizedAtenaProject(row.id, projects.data);
    if (!allowed || projects.isError || working.current) return;
    invalidateContext(); setSelectedId(allowed.id);
    if (hasRouteCandidate) navigate(atenaNavigationPath("atena", allowed.id));
    append(`Contexto definido para “${allowed.name}”. Nenhuma análise foi executada.`);
  };
  const navigateTo = (target: AtenaNavigationTarget) => {
    invalidateContext(); navigate(atenaNavigationPath(target, projectId)); append(`Abrindo ${NAV_LABELS[target]}. As permissões do módulo continuam sendo verificadas pelo servidor.`);
  };
  const showProjects = async () => {
    const result = await projects.refetch();
    if (result.isError) { append(`Não foi possível consultar projetos: ${result.error?.message ?? "sessão indisponível"}`); return; }
    append(result.data?.length ? "Selecione um projeto autorizado:" : "Nenhum projeto acessível nesta sessão.", result.data?.map(row => ({ id: row.id, name: row.name, code: row.code })));
  };
  const send = async (raw = draft) => {
    const text = raw.trim();
    if (!text || text.length > 2000 || working.current) return;
    working.current = true; setBusy(true); setDraft(""); setPending(null); const token = ++revision.current;
    setMessages(current => [...current, { id: crypto.randomUUID(), role: "user", content: text }]);
    try {
      if (previewMode) { append("Prévia sintética: nenhum comando foi consultado ou executado."); return; }
      const command = classifyAtenaChatCommand(text);
      if (command.kind === "help") { append("Ações disponíveis: listar projetos; abrir Mapa, Projetos, Arquivos, Atlas, Backups ou Atena; propor buffer ou interseção no projeto selecionado. Para modelos/PDF, ADA/AID/AII e prospecção, abra Atena. Não executo código, URLs, SQL ou endpoints fornecidos no chat."); return; }
      if (command.kind === "navigate") { navigateTo(command.target); return; }
      if (command.kind === "list_projects") { await showProjects(); return; }
      if (command.kind === "advanced_gis") { navigateTo("atena"); append("Use a página Atena para revisar camadas, parâmetros, bloqueios das fontes e geração de PDF."); return; }
      if (command.kind !== "gis_analysis") { append("Comando não suportado. Digite “ajuda”. Nenhuma alteração foi solicitada."); return; }
      if (!projectId || projects.isError) { await showProjects(); return; }
      const id = projectId;
      const interpreted = await interpret.mutateAsync({ projectId: id, text });
      if (!mounted.current || token !== revision.current || id !== currentProject.current) return;
      if (interpreted.status !== "proposal") { append(interpreted.message); return; }
      const planned = await plan.mutateAsync({ projectId: id, request: interpreted.request });
      if (!mounted.current || token !== revision.current || id !== currentProject.current) return;
      if (planned.status === "needs_input") { append(`Faltam informações:\n${planned.questions.join("\n")}`); return; }
      if (planned.status === "error") { append(`Plano recusado:\n${planned.errors.join("\n")}`); return; }
      setPending({ projectId: id, request: interpreted.request, requestText: text, plan: planned.plan });
      append(`${interpreted.explanation || "Pedido interpretado."}\nPlano pronto para revisão. Nada foi executado.`);
    } catch (error) { append(`Não foi possível preparar o pedido: ${errorText(error)}`); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const confirm = async () => {
    if (!pending || previewMode || working.current || !canWrite || isActive || pending.projectId !== currentProject.current) return;
    const action = pending; const token = revision.current;
    // Consume confirmation synchronously so double-click cannot start a second request.
    working.current = true; setBusy(true); setPending(null);
    try {
      const result = await run.mutateAsync({ projectId: action.projectId, request: action.request, requestText: action.requestText });
      if (!mounted.current || token !== revision.current || action.projectId !== currentProject.current) return;
      if (result.outcome !== "started") { append("O servidor revalidou e não iniciou a execução. Gere um novo plano para revisar os impedimentos."); return; }
      setLastRun({ id: result.runId, projectId: action.projectId });
      append(result.reused ? `Abrindo execução existente #${result.runId}; aguarde o estado retornado pelo servidor.` : `Execução #${result.runId} iniciada. Isso não confirma conclusão ou criação de resultado.`);
    } catch (error) { append(`Início não confirmado: ${errorText(error)} Consulte o histórico Atena antes de reenviar.`); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void send(); };
  const visiblePlan = pending?.projectId === projectId ? pending : null;
  return <div className="pointer-events-none fixed inset-0 z-[5000]" data-testid={previewMode ? "atena-chat-preview" : "atena-chat-widget"}>
    {!open && <Button ref={launcher} size="lg" className="pointer-events-auto fixed bottom-6 right-4 rounded-full shadow-xl" aria-label="Abrir chat Atena" aria-expanded={false} onClick={() => setOpen(true)}><MessageCircle className="h-5 w-5" /> Atena</Button>}
    {open && <section role="dialog" aria-modal="false" aria-labelledby="atena-chat-title" className="pointer-events-auto fixed bottom-3 right-3 flex w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-2xl sm:bottom-6 sm:right-6 sm:w-[26rem]" style={{ height: "min(43rem, 80dvh)" }}>
      <header className="flex items-center justify-between gap-3 border-b p-3"><div className="min-w-0"><h2 id="atena-chat-title" className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4" /> Atena · Assistente Geoportal</h2><p className="truncate text-xs text-muted-foreground">{previewMode ? "Prévia sintética · sem rede" : project ? `${project.name} · ${project.code}` : "Nenhum projeto autorizado selecionado"}</p></div><Button variant="ghost" size="icon" aria-label="Fechar chat Atena" onClick={() => { setOpen(false); requestAnimationFrame(() => launcher.current?.focus()); }}><X className="h-4 w-4" /></Button></header>
      {!previewMode && <div className="space-y-1 border-b p-3 text-xs">
        <label>Projeto<select aria-label="Projeto do chat Atena" className="mt-1 w-full rounded border bg-background p-2" value={projectId ?? ""} disabled={busy || projects.isLoading} onChange={event => { const row = authorizedAtenaProject(Number(event.target.value), projects.data); if (row) choose(row); else { invalidateContext(); setSelectedId(undefined); if (hasRouteCandidate) navigate("/atena"); } }}><option value="">Selecione…</option>{!projects.isError && projects.data?.map(row => <option key={row.id} value={row.id}>{row.name} · {row.code}</option>)}</select></label>
        {projects.isLoading && <p role="status">Consultando projetos acessíveis…</p>}
        {projects.isError && <p role="alert" className="text-destructive">Falha ao consultar projetos: {projects.error.message}</p>}
        {hasRouteCandidate && projects.isSuccess && !project && <p role="alert" className="text-amber-800">O contexto da URL não está disponível nesta sessão. Nenhum dado desse projeto foi consultado.</p>}
        {access.isError && <p role="alert" className="text-destructive">Não foi possível verificar escrita: {access.error.message}</p>}
      </div>}
      <div ref={transcript} aria-live="polite" aria-label="Mensagens Atena" className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-muted/30 p-3">
        {messages.map(message => <div key={message.id} className={`rounded-xl border p-3 text-sm ${message.role === "user" ? "ml-8 bg-primary text-primary-foreground" : "mr-4 bg-card"}`}><p className="whitespace-pre-wrap break-words">{message.content}</p>{message.projects && <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">{message.projects.filter(row => !projects.isError && authorizedAtenaProject(row.id, projects.data)).map(row => <div key={row.id} className="rounded border p-2 text-xs"><p>{row.name} · {row.code}</p><div className="mt-2 flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => choose(row)}>Usar no chat</Button><Button size="sm" variant="secondary" disabled={busy} onClick={() => { choose(row); navigate(atenaNavigationPath("atena", row.id)); }}>Abrir Atena</Button></div></div>)}</div>}</div>)}
        {visiblePlan && <div className="space-y-2 rounded-xl border border-orange-300 bg-card p-3 text-xs" data-testid="atena-chat-pending-plan">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-4 w-4" /> Revisão antes da execução</h3>
          <p><b>Projeto:</b> {project?.name}</p><p><b>Referência:</b> {visiblePlan.plan.referenceLayer?.name ?? "—"}</p><p><b>Origens:</b> {visiblePlan.plan.sourceLayers.map(layer => layer.name).join(", ")}</p><p><b>Distância:</b> {visiblePlan.plan.parameters.distanceM ?? "—"} m</p><p><b>Áreas:</b> {visiblePlan.plan.parameters.areaMethod}</p><p><b>Saída:</b> {visiblePlan.plan.outputName}</p>
          <ol className="list-decimal pl-5">{visiblePlan.plan.steps.map(step => <li key={step}>{step}</li>)}</ol>
          <p className="text-amber-800 dark:text-amber-300">A confirmação pode criar camadas de resultado. Insumos não serão substituídos.</p>
          {!canWrite && <p>Execução bloqueada: escrita não autorizada ou ainda não verificada.</p>}
          <div className="flex gap-2"><Button size="sm" disabled={busy || !canWrite || isActive} onClick={() => void confirm()}>Confirmar e executar</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setPending(null)}>Descartar plano</Button></div>
        </div>}
        {lastRun?.projectId === projectId && lastRun && <div role="status" className="space-y-1 rounded border bg-card p-3 text-xs"><p className="font-semibold">Execução #{lastRun.id} · {runQuery.data ? LABELS[runQuery.data.status] ?? runQuery.data.status : "consultando…"}</p>{runQuery.isError && <p className="text-destructive">Falha ao acompanhar: {runQuery.error.message}</p>}{runQuery.data?.status === "failed" && <p className="text-destructive">{runQuery.data.errorMessage || "Análise não concluída; consulte o histórico Atena."}</p>}{runQuery.data?.status === "completed" && <p>Conclusão informada pelo servidor. Resultados e PDF estão no histórico Atena.</p>}{isActive && <Button variant="outline" size="sm" disabled={!canWrite || cancel.isPending} onClick={async () => { try { await cancel.mutateAsync({ runId: lastRun.id }); void runQuery.refetch(); } catch (error) { append(`Cancelamento não confirmado: ${errorText(error)}`); } }}>Solicitar cancelamento</Button>}<Button variant="link" size="sm" onClick={() => navigateTo("atena")}>Abrir histórico / PDF</Button></div>}
        {busy && <p role="status" className="flex items-center gap-2 text-xs"><Loader2 className="h-4 w-4 animate-spin" /> Aguardando resposta e validação do servidor…</p>}
      </div>
      <div className="flex gap-2 border-t px-3 py-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void send("Listar projetos")}>Projetos</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void send("Ajuda")}>Ajuda</Button><Button size="sm" variant="outline" disabled={busy || previewMode} onClick={() => navigateTo("atena")}><ArrowUpRight className="h-3 w-3" /> Atena</Button></div>
      <form className="border-t p-3" onSubmit={submit}><div className="flex items-end gap-2"><Textarea ref={input} aria-label="Mensagem para Atena" placeholder="Comando ou pedido GIS…" maxLength={2000} rows={2} value={draft} disabled={busy} onChange={event => { setDraft(event.target.value); setPending(null); }} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} /><Button size="icon" aria-label="Enviar mensagem Atena" disabled={busy || !draft.trim()} type="submit"><Send className="h-4 w-4" /></Button></div><p className="mt-1 text-[10px] text-muted-foreground">Enter envia · Shift+Enter quebra linha · texto não executa comandos arbitrários</p></form>
    </section>}
  </div>;
}
