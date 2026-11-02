import { useEffect, useMemo, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { Sparkles, ChevronLeft, ChevronRight, Loader2, X, Download, History } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/**
 * Painel "Atena": pedido, plano, execução, resultados, mapa e histórico.
 * A seleção para análise é local ao painel e não altera a visibilidade das camadas no mapa.
 */

type Op = "vector.intersect_area" | "vector.buffer";

const OP_LABEL: Record<Op, string> = {
  "vector.intersect_area": "Interseção com área de referência (ex.: ADA)",
  "vector.buffer": "Zona de distância (buffer, em metros)",
};

const STATUS_LABEL: Record<string, string> = {
  queued: "Na fila",
  running: "Executando",
  cancel_requested: "Cancelando",
  completed: "Concluída",
  failed: "Falhou",
  cancelled: "Cancelada",
};

const ACTIVE = ["queued", "running", "cancel_requested"];

function ha(m2: number | null | undefined) {
  if (m2 == null) return "–";
  return (m2 / 10000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AtenaPanel({ initialProjectId }: { initialProjectId?: number } = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [projectId, setProjectId] = useState<number | null>(initialProjectId ?? null);
  const myProjects = trpc.projects.list.useQuery(undefined, { enabled: isOpen });
  const [text, setText] = useState("");
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [op, setOp] = useState<Op>("vector.intersect_area");
  const [refId, setRefId] = useState<string>("");
  const [srcIds, setSrcIds] = useState<number[]>([]);
  const [distance, setDistance] = useState("");
  const [outputName, setOutputName] = useState("");
  const [planView, setPlanView] = useState<any>(null);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [pageSize, setPageSize] = useState<"A3" | "A4">("A3");
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string>("areas_influencia");
  const [roleSel, setRoleSel] = useState<Record<string, string>>({});
  const [tplResult, setTplResult] = useState<any>(null);
  const [mallaAno, setMallaAno] = useState<number>(2025);
  const templates = trpc.atena.templates.useQuery(undefined, { enabled: isOpen });
  const tpl = (templates.data ?? []).find((t: any) => t.id === templateId);
  const renderTpl = trpc.atena.renderTemplate.useMutation({
    onSuccess: (r: any) => { setTplResult(r); if (r.status === "ready") toast.success("Mapa gerado."); },
    onError: e => toast.error(e.message),
  });

  const status = trpc.atena.status.useQuery(undefined, { enabled: isOpen });
  const pid = projectId ?? 0;
  const layers = trpc.atena.layers.useQuery({ projectId: pid }, { enabled: isOpen && pid > 0 });
  const history = trpc.atena.list.useQuery({ projectId: pid }, { enabled: isOpen && pid > 0 });
  const run = trpc.atena.get.useQuery(
    { runId: activeRunId ?? 0 },
    {
      enabled: isOpen && activeRunId != null,
      refetchInterval: (q) => (q.state.data && ACTIVE.includes((q.state.data as any).status) ? 1000 : false),
    },
  );

  const interpret = trpc.atena.interpret.useMutation({
    onSuccess: (r: any) => {
      if (r.status === "blocked") { setAiNote(r.message); return; }
      if (r.status === "invalid") { setAiNote(r.message); return; }
      setAiNote(r.explanation ? `Interpretado: ${r.explanation}` : "Pedido interpretado. Confira os parâmetros.");
      const req = r.request;
      setOp(req.operation);
      setRefId(req.referenceLayerId ? String(req.referenceLayerId) : "");
      setSrcIds(req.sourceLayerIds);
      setDistance(req.distanceM ? String(req.distanceM) : "");
      setOutputName(req.outputName ?? "");
      setPlanView(null);
    },
    onError: e => setAiNote(e.message),
  });

  const requestBody = useMemo(() => {
    const body: any = { operation: op, sourceLayerIds: srcIds };
    if (op === "vector.intersect_area" && refId) body.referenceLayerId = Number(refId);
    if (op === "vector.buffer" && distance) body.distanceM = Number(distance);
    if (outputName.trim()) body.outputName = outputName.trim();
    return body;
  }, [op, refId, srcIds, distance, outputName]);

  const plan = trpc.atena.plan.useMutation({
    onSuccess: r => setPlanView(r),
    onError: e => toast.error(e.message),
  });

  const runMut = trpc.atena.run.useMutation({
    onSuccess: (r: any) => {
      if (r.outcome !== "started") { toast.error("A análise ainda não pode ser executada. Revise o plano."); return; }
      setActiveRunId(r.runId);
      if (r.reused) toast.info("Esta análise já foi executada com os mesmos dados. Abrindo o resultado existente.");
      else toast.success("Análise iniciada.");
      history.refetch();
    },
    onError: e => toast.error(e.message),
  });

  const cancel = trpc.atena.cancel.useMutation({
    onSuccess: () => { run.refetch(); history.refetch(); },
    onError: e => toast.error(e.message),
  });

  const renderMap = trpc.atena.renderMap.useMutation({
    onSuccess: r => { setMapUrl(r.url); toast.success("Mapa gerado."); },
    onError: e => toast.error(e.message),
  });

  useEffect(() => {
    if (run.data && ["completed", "failed", "cancelled"].includes((run.data as any).status)) history.refetch();
  }, [run.data]);

  useEffect(() => { setMapUrl(null); }, [activeRunId]);

  const toggleSrc = (id: number, checked: boolean) =>
    setSrcIds(prev => (checked ? [...prev.filter(x => x !== id), id] : prev.filter(x => x !== id)));

  const sourceChoices = (layers.data ?? []).filter(l => String(l.id) !== refId);
  const runData: any = run.data;
  const isActive = runData && ACTIVE.includes(runData.status);
  const isDone = runData && runData.status === "completed";

  return (
    <>
      <Button
        variant="secondary"
        size="icon"
        onClick={() => setIsOpen(!isOpen)}
        className="absolute bottom-4 right-4 z-[2000] bg-white/90 hover:bg-white shadow-lg"
        title={isOpen ? "Fechar painel Atena" : "Abrir painel Atena"}
      >
        {isOpen ? <ChevronRight className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
      </Button>

      <aside
        className={`absolute top-0 right-0 bottom-0 w-96 border-l border-border bg-card/95 backdrop-blur-sm overflow-y-auto z-30 transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="p-4 space-y-5 text-sm">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="w-5 h-5" /> Atena</h2>
            <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)}><X className="w-4 h-4" /></Button>
          </div>

          <section className="space-y-1">
            <Label>Projeto</Label>
            <select
              className="w-full rounded-md border bg-background p-2"
              value={projectId ?? ""}
              onChange={e => { setProjectId(e.target.value ? Number(e.target.value) : null); setRefId(""); setSrcIds([]); setPlanView(null); setActiveRunId(null); setMapUrl(null); }}
            >
              <option value="">Selecione um projeto…</option>
              {(myProjects.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </section>

          {status.data && !status.data.ai.configured && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
              Interpretação por IA bloqueada neste ambiente. Monte o pedido no formulário abaixo.
            </div>
          )}

          {!projectId && <p className="text-xs text-muted-foreground">Escolha um projeto para montar análises. Você só vê projetos que pode acessar.</p>}

          {/* 0. Gerar mapa por modelo (fluxo padrão) */}
          <section className={`space-y-3 border-b pb-4 ${!projectId ? "pointer-events-none opacity-50" : ""}`}>
            <Label>Gerar mapa por modelo</Label>
            <select className="w-full rounded-md border bg-background p-2" value={templateId} onChange={e => { setTemplateId(e.target.value); setRoleSel({}); setTplResult(null); }}>
              {(templates.data ?? []).map((t: any) => (
                <option key={t.id} value={t.id}>{t.title}{t.status === "blocked" ? " (bloqueado)" : ""}</option>
              ))}
            </select>
            {tpl && tpl.status === "blocked" && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">Bloqueado: {tpl.blockedReason}</div>
            )}
            {tpl && tpl.status === "available" && (
              <>
                {tpl.roles.map((r: any) => (
                  <div key={r.role} className="space-y-1">
                    <Label className="text-xs">{r.label}{r.optional ? " (opcional)" : ""}</Label>
                    <select className="w-full rounded-md border bg-background p-2 text-xs" value={roleSel[r.role] ?? ""} onChange={e => setRoleSel(prev => ({ ...prev, [r.role]: e.target.value }))}>
                      <option value="">— não usar —</option>
                      {(layers.data ?? []).map(l => <option key={l.id} value={l.id}>{l.name} ({l.featureCount})</option>)}
                    </select>
                  </div>
                ))}
                {templateId === "areas_influencia" && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">AID padrão: 250 m no entorno da ADA, se não houver polígono de AID.</p>
                    <Label className="text-xs">Malha municipal (opcional, para AII)</Label>
                    <select className="w-full rounded-md border bg-background p-2 text-xs" value={roleSel["munis"] ?? ""} onChange={e => setRoleSel(prev => ({ ...prev, munis: e.target.value }))}>
                      <option value="">— não usar —</option>
                      {(layers.data ?? []).map(l => <option key={l.id} value={l.id}>{l.name} ({l.featureCount})</option>)}
                    </select>
                    {roleSel["munis"] && (
                      <>
                        <Label className="text-xs">Ano da malha (deve ser a mais recente do IBGE: 2025)</Label>
                        <Input type="number" value={mallaAno} onChange={e => setMallaAno(Number(e.target.value))} />
                      </>
                    )}
                  </div>
                )}
                <Button
                  className="w-full"
                  disabled={!projectId || renderTpl.isPending}
                  onClick={() => {
                    const roles: Record<string, number> = {};
                    for (const [k, v] of Object.entries(roleSel)) if (v) roles[k] = Number(v);
                    setTplResult(null);
                    renderTpl.mutate({ projectId: pid, templateId: templateId as any, roles: roles as any, mallaAno: roles.munis ? mallaAno : undefined });
                  }}
                >
                  {renderTpl.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                  Gerar mapa
                </Button>
              </>
            )}
            {tplResult?.status === "needs_input" && (
              <ul className="list-disc pl-5 text-xs text-amber-800">{tplResult.missing.map((m: any) => <li key={m.role}>{m.reason}</li>)}</ul>
            )}
            {tplResult?.status === "blocked" && <p className="text-xs text-amber-800">{tplResult.reason}</p>}
            {tplResult?.status === "ready" && (
              <div className="space-y-2">
                {tplResult.notes?.length > 0 && <ul className="list-disc pl-5 text-xs">{tplResult.notes.map((n: string) => <li key={n}>{n}</li>)}</ul>}
                <iframe title="Prévia do mapa por modelo" src={tplResult.url} className="w-full h-72 rounded-md border" />
                <a href={tplResult.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline">
                  <Download className="w-3 h-3" /> Abrir ou baixar PDF ({tplResult.pageSize} {tplResult.orientation === "landscape" ? "paisagem" : "retrato"})
                </a>
              </div>
            )}
          </section>

          {/* 1. Pedido */}
          <section className={`space-y-2 ${!projectId ? "pointer-events-none opacity-50" : ""}`}>
            <Label>Pedido em português</Label>
            <Textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Ex.: identifique os sítios que intersectam a ADA e calcule a área de cada um dentro dela"
              rows={3}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={text.trim().length < 3 || interpret.isPending}
              onClick={() => interpret.mutate({ projectId: pid, text: text.trim() })}
            >
              {interpret.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Interpretar com IA
            </Button>
            {aiNote && <p className="text-xs text-muted-foreground">{aiNote}</p>}
          </section>

          {/* Avançado: pedido de análise manual */}
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Avançado: análise manual</div>

          {/* 2. Parâmetros */}
          <section className={`space-y-3 border-t pt-4 ${!projectId ? "pointer-events-none opacity-50" : ""}`}>
            <Label>Análise</Label>
            <select
              className="w-full rounded-md border bg-background p-2"
              value={op}
              onChange={e => { setOp(e.target.value as Op); setPlanView(null); }}
            >
              {(Object.keys(OP_LABEL) as Op[]).map(k => <option key={k} value={k}>{OP_LABEL[k]}</option>)}
            </select>

            {op === "vector.intersect_area" && (
              <div className="space-y-1">
                <Label className="text-xs">Área de referência (ex.: ADA)</Label>
                <select className="w-full rounded-md border bg-background p-2" value={refId} onChange={e => { setRefId(e.target.value); setPlanView(null); }}>
                  <option value="">Selecione a camada…</option>
                  {(layers.data ?? []).map(l => <option key={l.id} value={l.id}>{l.name} ({l.featureCount})</option>)}
                </select>
              </div>
            )}

            {op === "vector.buffer" && (
              <div className="space-y-1">
                <Label className="text-xs">Distância (metros)</Label>
                <Input type="number" min={1} max={10000} value={distance} onChange={e => { setDistance(e.target.value); setPlanView(null); }} />
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs">Camadas de origem</Label>
              <p className="text-xs text-muted-foreground">
                Seleção para análise. Não altera a visibilidade das camadas no mapa.
              </p>
              <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-1">
                {sourceChoices.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma camada de dados neste projeto.</p>}
                {sourceChoices.map(l => (
                  <label key={l.id} className="flex items-center gap-2 text-xs">
                    <Checkbox checked={srcIds.includes(l.id)} onCheckedChange={c => { toggleSrc(l.id, c === true); setPlanView(null); }} />
                    <span className="flex-1 truncate">{l.name}</span>
                    <span className="text-muted-foreground">{l.featureCount}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Nome do resultado (opcional)</Label>
              <Input value={outputName} onChange={e => { setOutputName(e.target.value); setPlanView(null); }} maxLength={120} />
            </div>

            <Button
              className="w-full"
              variant="secondary"
              disabled={srcIds.length === 0 || plan.isPending}
              onClick={() => plan.mutate({ projectId: pid, request: requestBody })}
            >
              {plan.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Verificar plano
            </Button>
          </section>

          {/* 3. Plano */}
          {planView && (
            <section className="space-y-2 border-t pt-4">
              <Label>Plano</Label>
              {planView.status === "needs_input" && (
                <ul className="list-disc pl-5 text-amber-800">{planView.questions.map((q: string) => <li key={q}>{q}</li>)}</ul>
              )}
              {planView.status === "error" && (
                <ul className="list-disc pl-5 text-red-700">{planView.errors.map((q: string) => <li key={q}>{q}</li>)}</ul>
              )}
              {planView.status === "ready" && (
                <>
                  <div className="rounded-md bg-muted p-2 space-y-1 text-xs">
                    <div><b>Referência:</b> {planView.plan.referenceLayer?.name ?? "–"}</div>
                    <div><b>Origens:</b> {planView.plan.sourceLayers.map((s: any) => s.name).join(", ")}</div>
                    {planView.plan.parameters.distanceM != null && <div><b>Distância:</b> {planView.plan.parameters.distanceM} m</div>}
                    <div><b>Áreas:</b> {planView.plan.parameters.areaMethod}</div>
                    <div><b>Saída:</b> {planView.plan.outputName}</div>
                    <div><b>Habilidade:</b> {planView.plan.skill} v{planView.plan.skillVersion}</div>
                  </div>
                  <ol className="list-decimal pl-5 text-xs">{planView.plan.steps.map((s: string) => <li key={s}>{s}</li>)}</ol>
                  <Button className="w-full" disabled={runMut.isPending} onClick={() => runMut.mutate({ projectId: pid, request: requestBody, requestText: text || undefined })}>
                    {runMut.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                    Executar análise
                  </Button>
                </>
              )}
            </section>
          )}

          {/* 4. Progresso */}
          {runData && (
            <section className="space-y-2 border-t pt-4">
              <div className="flex items-center justify-between">
                <Label>Execução #{runData.id}</Label>
                <Badge variant={runData.status === "failed" ? "destructive" : "secondary"}>{STATUS_LABEL[runData.status] ?? runData.status}</Badge>
              </div>
              {isActive && (
                <Button size="sm" variant="outline" onClick={() => cancel.mutate({ runId: runData.id })} disabled={cancel.isPending}>
                  Cancelar execução
                </Button>
              )}
              <ul className="space-y-1 text-xs">
                {(runData.steps ?? []).map((s: any) => (
                  <li key={s.name} className="flex justify-between gap-2">
                    <span>{s.name}</span>
                    <span className={s.status === "failed" ? "text-red-700" : "text-muted-foreground"}>
                      {s.status === "done" ? `${s.durationMs} ms` : s.message ?? s.status}
                    </span>
                  </li>
                ))}
              </ul>
              {runData.status === "failed" && (
                <div className="rounded-md border border-red-300 bg-red-50 p-2 text-red-800 text-xs space-y-1">
                  <div>{runData.errorMessage}</div>
                  {Array.isArray(runData.alerts) && runData.alerts.map((a: any) => <div key={a.featureId ?? a.message}>{a.message}</div>)}
                  <div>Nenhum resultado foi criado.</div>
                </div>
              )}
            </section>
          )}

          {/* 5. Resultados e mapa */}
          {isDone && (
            <section className="space-y-3 border-t pt-4">
              <Label>Resultados</Label>
              {runData.outputs?.table?.length > 0 && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-1">Origem</th>
                      <th className="text-right">Total (ha)</th>
                      <th className="text-right">Na área (ha)</th>
                      <th className="text-right">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runData.outputs.table.filter((t: any) => t.sourceId !== 0).map((t: any, i: number) => (
                      <tr key={i} className="border-b/50">
                        <td className="py-1 truncate max-w-[9rem]">{t.sourceName}</td>
                        <td className="text-right">{ha(t.sourceAreaM2)}</td>
                        <td className="text-right">{ha(t.intersectionAreaM2)}</td>
                        <td className="text-right">{t.percentInside == null ? "–" : t.percentInside.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <ul className="text-xs list-disc pl-5">
                {runData.outputs?.layers?.map((l: any) => <li key={l.id}>{l.name} · {l.featureCount} feição(ões)</li>)}
              </ul>

              <div className="grid grid-cols-2 gap-2">
                <select className="rounded-md border bg-background p-2 text-xs" value={pageSize} onChange={e => setPageSize(e.target.value as any)}>
                  <option value="A3">A3</option>
                  <option value="A4">A4</option>
                </select>
                <select className="rounded-md border bg-background p-2 text-xs" value={orientation} onChange={e => setOrientation(e.target.value as any)}>
                  <option value="landscape">Paisagem</option>
                  <option value="portrait">Retrato</option>
                </select>
              </div>
              <Button className="w-full" disabled={renderMap.isPending} onClick={() => renderMap.mutate({ runId: runData.id, pageSize, orientation })}>
                {renderMap.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                Gerar mapa {pageSize}
              </Button>
              {mapUrl && (
                <div className="space-y-2">
                  <iframe title="Prévia do mapa" src={mapUrl} className="w-full h-72 rounded-md border" />
                  <a href={mapUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline">
                    <Download className="w-3 h-3" /> Abrir ou baixar PDF
                  </a>
                </div>
              )}
            </section>
          )}

          {/* 6. Histórico */}
          <section className={`space-y-2 border-t pt-4 ${!projectId ? "pointer-events-none opacity-50" : ""}`}>
            <Label className="flex items-center gap-1"><History className="w-4 h-4" /> Histórico</Label>
            {(history.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">Nenhuma execução neste projeto.</p>}
            <ul className="space-y-1">
              {(history.data ?? []).map((r: any) => (
                <li key={r.id}>
                  <button
                    className={`w-full text-left rounded-md p-2 text-xs hover:bg-muted ${activeRunId === r.id ? "bg-muted" : ""}`}
                    onClick={() => setActiveRunId(r.id)}
                  >
                    <div className="flex justify-between">
                      <span>#{r.id} · {r.plan?.outputName ?? r.requestText ?? "análise"}</span>
                      <span className="text-muted-foreground">{STATUS_LABEL[r.status] ?? r.status}</span>
                    </div>
                    <div className="text-muted-foreground">{new Date(r.createdAt).toLocaleString("pt-BR")}</div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </aside>
    </>
  );
}
