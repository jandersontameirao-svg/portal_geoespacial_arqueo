import { useEffect, useMemo, useRef, useState } from "react";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Checkbox } from "./ui/checkbox";
import { Sparkles, Loader2, X, Download, History } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { atenaRequestKey, authorizedAtenaProject, safeAtenaArtifactUrl, type AtenaAnalysisRequest } from "@/lib/atenaChatCommands";
import ProspectionGenerator from "./ProspectionGenerator";
import InfluenceAreasPanel from "./InfluenceAreasPanel";

type Outputs = inferRouterOutputs<AppRouter>;
type Inputs = inferRouterInputs<AppRouter>;
type PlanResult = Outputs["atena"]["plan"];
type TemplateResult = Outputs["atena"]["renderTemplate"];
type TemplateId = Inputs["atena"]["renderTemplate"]["templateId"];
type Props = { initialProjectId?: number; embedded?: boolean; onProjectChange?: (id: number | undefined) => void };
const STATUS_LABEL: Record<string, string> = { queued: "Na fila", running: "Executando", cancel_requested: "Cancelamento solicitado", completed: "Concluída", failed: "Falhou", cancelled: "Cancelada" };
const ACTIVE = ["queued", "running", "cancel_requested"];
const OP_LABEL = { "vector.intersect_area": "Interseção com área de referência", "vector.buffer": "Zona de distância (buffer em metros)" } as const;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Falha inesperada; a operação não foi confirmada.";
const ha = (m2: number | null | undefined) => m2 == null || !Number.isFinite(m2) ? "—" : (m2 / 10000).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** A URL nunca autoriza acesso. O workspace só monta após projects.list confirmar o ID. */
export default function AtenaPanel({ initialProjectId, embedded = false, onProjectChange }: Props = {}) {
  const [open, setOpen] = useState(embedded);
  const [candidate, setCandidate] = useState(initialProjectId);
  const auth = trpc.auth.me.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const projects = trpc.projects.list.useQuery(undefined, { enabled: (embedded || open) && Boolean(auth.data), retry: false });
  useEffect(() => { setCandidate(initialProjectId); }, [initialProjectId]);
  const project = !projects.isError && auth.data ? authorizedAtenaProject(candidate, projects.data) : undefined;
  const content = <>
    <div className="mb-5 space-y-2">
      <label className="block text-sm font-medium">Projeto autorizado
        <select aria-label="Projeto da Atena" className="mt-1 w-full rounded-md border bg-background p-2" value={project?.id ?? ""} disabled={projects.isLoading || !auth.data} onChange={event => {
          const value = event.target.value ? Number(event.target.value) : undefined;
          const selected = authorizedAtenaProject(value, projects.data);
          setCandidate(selected?.id); onProjectChange?.(selected?.id);
        }}>
          <option value="">Selecione um projeto…</option>
          {!projects.isError && projects.data?.map(row => <option key={row.id} value={row.id}>{row.name} · {row.code}</option>)}
        </select>
      </label>
      {auth.isLoading && <p role="status">Verificando sessão…</p>}
      {!auth.isLoading && !auth.data && <p role="alert">É necessário estar autenticado para usar a Atena. Nenhum projeto foi consultado.</p>}
      {projects.isLoading && auth.data && <p role="status">Carregando projetos acessíveis…</p>}
      {projects.isError && <p role="alert" className="text-destructive">Não foi possível consultar seus projetos: {projects.error.message} <button className="underline" onClick={() => void projects.refetch()}>Tentar novamente</button></p>}
      {candidate != null && projects.isSuccess && !project && <p role="alert" className="text-amber-800">O contexto solicitado não está disponível nesta sessão. Selecione um projeto da lista. Nenhum dado desse contexto foi consultado.</p>}
      {projects.isSuccess && !projects.data.length && <p>Nenhum projeto acessível nesta sessão.</p>}
      {!candidate && <p className="text-xs text-muted-foreground">A seleção para análise não altera a visibilidade das camadas no mapa.</p>}
    </div>
    {project && <AtenaProjectWorkspace key={`${auth.data?.id}:${project.id}`} projectId={project.id} />}
  </>;
  if (embedded) return <section className="space-y-4" aria-label="Ferramentas Atena">{content}</section>;
  return <>
    <Button type="button" variant="secondary" className="absolute bottom-4 right-4 z-[2000] shadow-lg" aria-expanded={open} aria-controls="atena-panel" onClick={() => setOpen(value => !value)}><Sparkles className="h-4 w-4" /> Atena</Button>
    {open && <aside id="atena-panel" aria-label="Painel Atena" className="absolute inset-y-0 right-0 z-[2100] w-full max-w-md overflow-y-auto border-l bg-card p-4 shadow-xl">
      <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Atena</h2><Button variant="ghost" size="icon" aria-label="Fechar painel Atena" onClick={() => setOpen(false)}><X className="h-4 w-4" /></Button></div>{content}
    </aside>}
  </>;
}

/** Montagem isolada por sessão/projeto também descarta respostas tardias do contexto anterior. */
function AtenaProjectWorkspace({ projectId }: { projectId: number }) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const utils = trpc.useUtils();
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [op, setOp] = useState<AtenaAnalysisRequest["operation"]>("vector.intersect_area");
  const [refId, setRefId] = useState("");
  const [srcIds, setSrcIds] = useState<number[]>([]);
  const [distance, setDistance] = useState("");
  const [outputName, setOutputName] = useState("");
  const [review, setReview] = useState<{ key: string; request: AtenaAnalysisRequest; response: PlanResult } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [pageSize, setPageSize] = useState<"A3" | "A4">("A3");
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<TemplateId>("areas_influencia");
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [tplResult, setTplResult] = useState<TemplateResult | null>(null);
  const [halfWidth, setHalfWidth] = useState(35);
  const [aidDistance, setAidDistance] = useState(250);
  const [aidOrigin, setAidOrigin] = useState<"ada" | "source">("ada");
  const status = trpc.atena.status.useQuery(undefined, { retry: false });
  const templates = trpc.atena.templates.useQuery(undefined, { retry: false });
  const layers = trpc.atena.layers.useQuery({ projectId }, { retry: false });
  const access = trpc.prospect.sources.useQuery({ projectId }, { retry: false });
  const history = trpc.atena.list.useQuery({ projectId }, { retry: false });
  const canWrite = access.isSuccess && access.data.canWrite;
  const tpl = templates.data?.find(item => item.id === templateId);
  const interpret = trpc.atena.interpret.useMutation();
  const plan = trpc.atena.plan.useMutation();
  const runMutation = trpc.atena.run.useMutation();
  const cancel = trpc.atena.cancel.useMutation();
  const renderMap = trpc.atena.renderMap.useMutation();
  const renderTemplate = trpc.atena.renderTemplate.useMutation();
  const run = trpc.atena.get.useQuery({ runId: activeRunId ?? 0 }, { enabled: activeRunId != null, retry: false, refetchInterval: query => ACTIVE.includes(query.state.data?.status ?? "") ? 1500 : false });
  const request = useMemo<AtenaAnalysisRequest>(() => ({ operation: op, sourceLayerIds: srcIds, ...(op === "vector.intersect_area" && refId ? { referenceLayerId: Number(refId) } : {}), ...(op === "vector.buffer" && distance ? { distanceM: Number(distance) } : {}), ...(outputName.trim() ? { outputName: outputName.trim() } : {}) }), [op, srcIds, refId, distance, outputName]);
  const requestKey = atenaRequestKey(projectId, request);
  const currentKey = useRef(requestKey); currentKey.current = requestKey;
  const editRevision = useRef(0);
  const invalidate = () => { editRevision.current++; setReview(null); setConfirmed(false); setFailure(null); };
  const formBusy = interpret.isPending || plan.isPending || runMutation.isPending;
  const active = ACTIVE.includes(run.data?.status ?? "");
  const planView = review?.key === requestKey ? review.response : null;
  const tplUrl = tplResult?.status === "ready" ? safeAtenaArtifactUrl(tplResult.url) : null;
  const templateKey = JSON.stringify([templateId, roles, pageSize, orientation, halfWidth, aidDistance, aidOrigin]);
  const currentTemplateKey = useRef(templateKey); currentTemplateKey.current = templateKey;
  useEffect(() => { setTplResult(null); }, [templateKey]);
  useEffect(() => { setMapUrl(null); }, [activeRunId, pageSize, orientation]);
  useEffect(() => {
    if (run.data && !ACTIVE.includes(run.data.status)) {
      void utils.atena.list.invalidate({ projectId });
      void utils.atena.layers.invalidate({ projectId });
    }
  }, [run.data?.status, activeRunId, projectId, utils]);

  const interpretText = async () => {
    invalidate(); setNote(null); const revision = editRevision.current;
    try {
      const result = await interpret.mutateAsync({ projectId, text: text.trim() });
      if (!mounted.current || revision !== editRevision.current) return;
      if (result.status !== "proposal") { setNote(result.message); return; }
      setOp(result.request.operation); setRefId(result.request.referenceLayerId ? String(result.request.referenceLayerId) : "");
      setSrcIds(result.request.sourceLayerIds); setDistance(result.request.distanceM ? String(result.request.distanceM) : ""); setOutputName(result.request.outputName ?? "");
      setNote(result.explanation || "Pedido interpretado. Confira os parâmetros e verifique o plano; nada foi executado.");
    } catch (error) { if (mounted.current) setFailure(errorMessage(error)); }
  };
  const verify = async () => {
    invalidate(); const revision = editRevision.current; const snapshot = request; const key = requestKey;
    try {
      const response = await plan.mutateAsync({ projectId, request: snapshot });
      if (mounted.current && revision === editRevision.current && currentKey.current === key) setReview({ key, request: snapshot, response });
    } catch (error) { if (mounted.current) setFailure(errorMessage(error)); }
  };
  const execute = async () => {
    if (!review || review.key !== currentKey.current || review.response.status !== "ready" || !confirmed || !canWrite || formBusy || active) return;
    const action = review; setReview(null); setConfirmed(false); setFailure(null);
    try {
      const result = await runMutation.mutateAsync({ projectId, request: action.request, requestText: text || undefined });
      if (!mounted.current) return;
      if (result.outcome !== "started") { setReview({ ...action, response: result.planned }); setFailure("Execução não iniciada: o servidor revalidou o plano. Revise os impedimentos."); return; }
      setActiveRunId(result.runId); setNote(result.reused ? "Abrindo execução existente para os mesmos dados." : "Execução iniciada. A conclusão será informada pelo servidor.");
      void history.refetch();
    } catch (error) { if (mounted.current) setFailure(`Execução não confirmada: ${errorMessage(error)} Consulte o histórico antes de reenviar.`); }
  };
  const createTemplate = async () => {
    if (!canWrite || tpl?.status !== "available") return;
    setTplResult(null); setFailure(null); const key = templateKey;
    const selected: Inputs["atena"]["renderTemplate"]["roles"] = {};
    for (const role of tpl.roles) { const value = roles[role.role]; if (value && layers.data?.some(layer => layer.id === Number(value))) Object.assign(selected, { [role.role]: Number(value) }); }
    try {
      const response = await renderTemplate.mutateAsync({ projectId, templateId, roles: selected, pageSize, orientation, adaHalfWidthM: halfWidth, aidDistanceM: aidDistance, aidOrigin });
      if (mounted.current && key === currentTemplateKey.current) setTplResult(response);
    } catch (error) { if (mounted.current) setFailure(errorMessage(error)); }
  };
  const generateMap = async () => {
    if (!run.data || run.data.status !== "completed" || !canWrite) return;
    setMapUrl(null); setFailure(null); const runId = run.data.id; const key = currentTemplateKey.current;
    try {
      const response = await renderMap.mutateAsync({ runId, pageSize, orientation });
      if (mounted.current && key === currentTemplateKey.current) {
        const url = safeAtenaArtifactUrl(response.url); setMapUrl(url); if (!url) setFailure("O servidor não retornou uma URL segura para o PDF.");
      }
    } catch (error) { if (mounted.current) setFailure(errorMessage(error)); }
  };
  return <div className="min-w-0 space-y-6 break-words text-sm">
    {failure && <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">{failure}</p>}
    {[status, templates, layers, access, history, run].map((query, index) => query.isError && <p role="alert" key={index} className="text-destructive">Falha em {["disponibilidade Atena", "modelos", "camadas", "permissão de escrita", "histórico", "consulta da execução"][index]}: {query.error?.message}</p>)}
    {layers.isLoading && <p role="status">Carregando camadas…</p>}
    {layers.isSuccess && !layers.data.length && <p>O projeto não possui camadas de dados disponíveis para a Atena.</p>}
    {access.isSuccess && !canWrite && <p role="note" className="rounded border p-2">Modo de leitura: prévias e planos disponíveis; execução, salvamento e geração de PDF exigem escrita.</p>}
    {status.data && !status.data.ai.configured && <p role="status" className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">Interpretação por IA bloqueada neste ambiente. Use o formulário manual; não há interpretação simulada.</p>}

    <section className="min-w-0 space-y-3 rounded-lg border p-4" aria-label="Pedido e plano de análise">
      <h3 className="font-semibold">1. Pedido e parâmetros</h3>
      <label className="block">Pedido em português<Textarea className="mt-1" value={text} maxLength={2000} rows={3} disabled={formBusy} onChange={event => { setText(event.target.value); invalidate(); }} placeholder="Ex.: buffer de 50 metros na camada de origem" /></label>
      <Button variant="outline" disabled={formBusy || text.trim().length < 3 || !status.data?.ai.configured} onClick={() => void interpretText()}>{interpret.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Interpretar pedido</Button>
      {note && <p role="status" className="text-xs text-muted-foreground">{note}</p>}
      <fieldset disabled={formBusy} className="space-y-3">
        <legend className="mb-2 text-xs font-medium">Formulário manual / revisão da interpretação</legend>
        <label className="block">Análise<select className="mt-1 w-full rounded border bg-background p-2" value={op} onChange={event => { if (event.target.value in OP_LABEL) { setOp(event.target.value as AtenaAnalysisRequest["operation"]); invalidate(); } }}>{Object.entries(OP_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        {op === "vector.intersect_area" && <label className="block">Área de referência<select className="mt-1 w-full rounded border bg-background p-2" value={refId} onChange={event => { setRefId(event.target.value); setSrcIds(ids => ids.filter(id => String(id) !== event.target.value)); invalidate(); }}><option value="">Selecione…</option>{layers.data?.map(layer => <option key={layer.id} value={layer.id}>{layer.name} ({layer.featureCount})</option>)}</select></label>}
        {op === "vector.buffer" && <label className="block">Distância em metros<Input type="number" min={1} max={10000} value={distance} onChange={event => { setDistance(event.target.value); invalidate(); }} /></label>}
        <div><p className="mb-1 font-medium">Camadas de origem (máximo 10)</p><p className="mb-2 text-xs text-muted-foreground">Seleção analítica independente da visibilidade no mapa.</p><div className="max-h-52 space-y-2 overflow-y-auto rounded border p-2">{layers.data?.filter(layer => op !== "vector.intersect_area" || String(layer.id) !== refId).map(layer => <label className="flex items-center gap-2" key={layer.id}><Checkbox checked={srcIds.includes(layer.id)} disabled={!srcIds.includes(layer.id) && srcIds.length >= 10} onCheckedChange={checked => { setSrcIds(ids => checked === true ? Array.from(new Set([...ids, layer.id])) : ids.filter(id => id !== layer.id)); invalidate(); }} /><span>{layer.name} · {layer.featureCount} feição(ões)</span></label>)}</div></div>
        <label className="block">Nome da saída (opcional)<Input value={outputName} maxLength={120} onChange={event => { setOutputName(event.target.value); invalidate(); }} /></label>
        <Button className="w-full" variant="secondary" disabled={!srcIds.length || layers.isError || (op === "vector.buffer" && (!distance || !Number.isFinite(Number(distance)) || Number(distance) < 1 || Number(distance) > 10000))} onClick={() => void verify()}>{plan.isPending && <Loader2 className="h-4 w-4 animate-spin" />} 2. Verificar plano</Button>
      </fieldset>
      {planView && <div className="min-w-0 space-y-3 border-t pt-3 [overflow-wrap:anywhere]" data-testid="atena-review-plan">
        <h3 className="font-semibold">3. Revisão e confirmação</h3>
        {planView.status === "needs_input" && <ul role="alert" className="list-disc pl-5 text-amber-800">{planView.questions.map(question => <li key={question}>{question}</li>)}</ul>}
        {planView.status === "error" && <ul role="alert" className="list-disc pl-5 text-destructive">{planView.errors.map(error => <li key={error}>{error}</li>)}</ul>}
        {planView.status === "ready" && <>
          <dl className="space-y-1 rounded bg-muted p-3 text-xs"><div><dt className="inline font-semibold">Referência: </dt><dd className="inline">{planView.plan.referenceLayer?.name ?? "—"}</dd></div><div><dt className="inline font-semibold">Origens: </dt><dd className="inline">{planView.plan.sourceLayers.map(layer => layer.name).join(", ")}</dd></div><div>Distância: {planView.plan.parameters.distanceM ?? "—"} m</div><div>Áreas: {planView.plan.parameters.areaMethod}</div><div>Buffer: {planView.plan.parameters.bufferMethod}</div><div>Saída: {planView.plan.outputName}</div><div>Habilidade: {planView.plan.skill} v{planView.plan.skillVersion}</div></dl>
          <ol className="list-decimal pl-5 text-xs">{planView.plan.steps.map(step => <li key={step}>{step}</li>)}</ol>
          <label className="flex min-w-0 items-start gap-2"><Checkbox checked={confirmed} disabled={!canWrite || formBusy || active} onCheckedChange={value => setConfirmed(value === true)} /><span className="min-w-0">Revisei o plano e autorizo criar camadas de resultado neste projeto, sem substituir os insumos.</span></label>
          <div className="flex min-w-0 flex-wrap gap-2"><Button className="h-auto min-h-9 min-w-0 flex-1 basis-56 whitespace-normal break-words" disabled={!confirmed || !canWrite || formBusy || active} onClick={() => void execute()}>Confirmar e executar análise</Button><Button className="h-auto min-h-9 min-w-0 whitespace-normal break-words" variant="outline" onClick={invalidate}>Descartar plano</Button></div>
        </>}
      </div>}
    </section>

    {activeRunId != null && <section aria-label="Execução Atena" className="space-y-3 rounded-lg border p-4">
      <h3 className="font-semibold">Execução #{activeRunId} · {run.data ? STATUS_LABEL[run.data.status] ?? run.data.status : "consultando…"}</h3>
      {active && <Button variant="outline" disabled={!canWrite || cancel.isPending} onClick={async () => { try { await cancel.mutateAsync({ runId: activeRunId }); if (mounted.current) { void run.refetch(); void history.refetch(); } } catch (error) { if (mounted.current) setFailure(errorMessage(error)); } }}>Solicitar cancelamento</Button>}
      <ul className="space-y-1 text-xs">{run.data?.steps?.map((step: { name: string; status: string; durationMs?: number; message?: string }, index: number) => <li key={index}>{step.name}: {step.status === "done" ? `${step.durationMs ?? 0} ms` : step.message ?? step.status}</li>)}</ul>
      {run.data?.status === "failed" && <p role="alert" className="text-destructive">{run.data.errorMessage || "A execução falhou."} Nenhum sucesso é presumido; consulte os alertas e o histórico.</p>}
      {run.data?.status === "cancelled" && <p>Execução cancelada pelo servidor.</p>}
      {Array.isArray(run.data?.alerts) && run.data.alerts.map((alert: { message?: string }, index: number) => <p key={index} className="text-amber-800">{alert.message}</p>)}
      {run.data?.status === "completed" && <>
        <h4 className="font-medium">Resultados retornados pelo servidor</h4>
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b text-left"><th>Origem</th><th>Total (ha)</th><th>Na área (ha)</th><th>%</th></tr></thead><tbody>{run.data.outputs?.table?.filter((row: { sourceId: number }) => row.sourceId !== 0).map((row: { sourceName: string; sourceAreaM2?: number; intersectionAreaM2?: number; percentInside?: number }, index: number) => <tr key={index}><td>{row.sourceName}</td><td>{ha(row.sourceAreaM2)}</td><td>{ha(row.intersectionAreaM2)}</td><td>{row.percentInside == null ? "—" : row.percentInside.toFixed(1)}</td></tr>)}</tbody></table></div>
        <ul className="text-xs">{run.data.outputs?.layers?.map((layer: { id: number; name: string; featureCount: number }) => <li key={layer.id}>{layer.name} · {layer.featureCount} feição(ões)</li>)}</ul>
        <Button disabled={!canWrite || renderMap.isPending} onClick={() => void generateMap()}>{renderMap.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Gerar PDF da execução ({pageSize})</Button>
        {mapUrl && <PdfPreview url={mapUrl} title="PDF da execução Atena" />}
      </>}
    </section>}

    <section className="space-y-3 rounded-lg border p-4" aria-label="Modelos cartográficos Atena">
      <h3 className="font-semibold">Mapas por modelo e ferramentas especializadas</h3>
      <p className="text-xs text-muted-foreground">Modelos científicos bloqueados não são simulados. PDFs não adicionam uma nova fonte de mapa-base.</p>
      <label className="block">Modelo<select className="mt-1 w-full rounded border bg-background p-2" value={templateId} onChange={event => { const selected = templates.data?.find(item => item.id === event.target.value); if (selected) { setTemplateId(selected.id); setRoles({}); setTplResult(null); } }}>{templates.data?.map(item => <option key={item.id} value={item.id}>{item.title}{item.status === "blocked" ? " (bloqueado)" : ""}</option>)}</select></label>
      {tpl?.status === "blocked" && <p role="alert" className="rounded border border-amber-300 p-2 text-amber-800">Bloqueado: {tpl.blockedReason}</p>}
      {tpl?.status === "available" && <>
        <p className="text-xs">{tpl.purpose}</p>
        {tpl.roles.map(role => <label key={role.role} className="block">{role.label}{role.optional ? " (opcional)" : " (obrigatório)"}<select className="mt-1 w-full rounded border bg-background p-2" value={roles[role.role] ?? ""} onChange={event => setRoles(current => ({ ...current, [role.role]: event.target.value }))}><option value="">Não selecionada</option>{layers.data?.map(layer => <option key={layer.id} value={layer.id}>{layer.name} ({layer.featureCount})</option>)}</select><span className="text-xs text-muted-foreground">{role.description}</span></label>)}
        {templateId === "areas_influencia" && <>
          <div className="grid gap-2 sm:grid-cols-2"><label>ADA linear: largura por lado (m)<Input type="number" min={1} max={500} value={halfWidth} onChange={event => setHalfWidth(Number(event.target.value))} /></label><label>AID: distância (m)<Input type="number" min={1} max={10000} value={aidDistance} onChange={event => setAidDistance(Number(event.target.value))} /></label></div>
          <label className="block">Origem da AID<select className="w-full rounded border bg-background p-2" value={aidOrigin} onChange={event => setAidOrigin(event.target.value === "source" ? "source" : "ada")}><option value="ada">ADA</option><option value="source">Eixo/polígono original</option></select></label>
          <p role="note" className="rounded border border-amber-300 p-2 text-xs text-amber-800">AII oficial depende da consulta remota e da proveniência retornada pelo servidor. Fonte bloqueada ou indisponível mantém a AII bloqueada, sem fallback silencioso para cache SP. Uma camada própria AII não é certificação de fonte oficial. Polígonos AID fornecidos são utilizados diretamente.</p>
          <InfluenceAreasPanel projectId={projectId} />
        </>}
        {templateId === "unidades_prospeccao" && <ProspectionGenerator projectId={projectId} />}
      </>}
      <div className="grid grid-cols-2 gap-2"><label>Formato do PDF<select className="w-full rounded border bg-background p-2" value={pageSize} onChange={event => setPageSize(event.target.value === "A4" ? "A4" : "A3")}><option value="A3">A3</option><option value="A4">A4</option></select></label><label>Orientação<select className="w-full rounded border bg-background p-2" value={orientation} onChange={event => setOrientation(event.target.value === "portrait" ? "portrait" : "landscape")}><option value="landscape">Paisagem</option><option value="portrait">Retrato</option></select></label></div>
      {tpl?.status === "available" && <Button className="w-full" disabled={!canWrite || renderTemplate.isPending || layers.isError || (templateId === "areas_influencia" && (!Number.isFinite(halfWidth) || halfWidth < 1 || halfWidth > 500 || !Number.isFinite(aidDistance) || aidDistance < 1 || aidDistance > 10000))} onClick={() => void createTemplate()}>{renderTemplate.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Gerar PDF por modelo</Button>}
      {tplResult?.status === "needs_input" && <ul role="alert" className="list-disc pl-5 text-amber-800">{tplResult.missing.map(item => <li key={item.role}>{item.reason}</li>)}</ul>}
      {tplResult?.status === "blocked" && <p role="alert" className="text-amber-800">{tplResult.reason}</p>}
      {tplResult?.status === "ready" && <><ul className="list-disc pl-5 text-xs">{tplResult.notes.map(note => <li key={note}>{note}</li>)}</ul>{tplUrl ? <PdfPreview url={tplUrl} title="PDF do modelo Atena" /> : <p role="alert">O servidor não retornou uma URL segura para o PDF.</p>}</>}
    </section>

    <section aria-label="Histórico Atena" className="space-y-2 rounded-lg border p-4">
      <h3 className="flex items-center gap-2 font-semibold"><History className="h-4 w-4" /> Histórico do projeto</h3>
      <Button size="sm" variant="outline" onClick={() => void history.refetch()} disabled={history.isFetching}>Atualizar histórico</Button>
      {history.isLoading && <p role="status">Carregando histórico…</p>}
      {history.isSuccess && !history.data.length && <p>Nenhuma execução registrada neste projeto.</p>}
      <ul className="space-y-1">{history.data?.map(item => <li key={item.id}><button disabled={active || renderMap.isPending} className={`w-full rounded border p-2 text-left text-xs hover:bg-muted ${activeRunId === item.id ? "bg-muted" : ""}`} onClick={() => { setActiveRunId(item.id); setMapUrl(null); }}><span>#{item.id} · {item.plan?.outputName ?? item.requestText ?? "análise"} · {STATUS_LABEL[item.status] ?? item.status}</span><span className="block text-muted-foreground">{new Date(item.createdAt).toLocaleString("pt-BR")}</span>{item.errorMessage && <span className="block text-destructive">{item.errorMessage}</span>}</button></li>)}</ul>
    </section>
  </div>;
}
function PdfPreview({ url, title }: { url: string; title: string }) {
  return <div className="space-y-2"><iframe title={title} src={url} sandbox="allow-same-origin allow-downloads" referrerPolicy="no-referrer" className="h-80 w-full rounded border" /><a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs underline"><Download className="h-3 w-3" /> Abrir ou baixar PDF</a></div>;
}
