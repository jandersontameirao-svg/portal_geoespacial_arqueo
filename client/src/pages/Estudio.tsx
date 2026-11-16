import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Link, useSearch } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Download, Loader2, Save } from "lucide-react";
import { defaultLayout, portraitLayout, type Layout, type Orientation, type Paper } from "@shared/studioLayout";

type Box = { x: number; y: number; w: number; h: number };
type ElementId = keyof Layout;
const elementNames: Record<ElementId, string> = {
  principal: "Mapa principal", legenda: "Legenda", norte: "Norte", brasil: "Situação nacional", regional: "Situação regional",
};
const papers: Paper[] = ["A4", "A3", "A2", "A1", "A0"];

export default function Estudio() {
  const { isAuthenticated, loading } = useAuth();
  const search = useSearch();
  const projectId = Number(new URLSearchParams(search).get("projectId")) || 0;

  const projectsQuery = trpc.projects.list.useQuery(undefined, { enabled: isAuthenticated && !projectId });
  const studio = trpc.studioProducts.list.useQuery({ projectId }, { enabled: isAuthenticated && projectId > 0 });

  const [title, setTitle] = useState("Mapa de localização");
  const [paper, setPaper] = useState<Paper>("A2");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [grid, setGrid] = useState(25000);
  const [layerIds, setLayerIds] = useState<number[]>([]);
  const [layout, setLayout] = useState<Layout>(defaultLayout);
  const [svg, setSvg] = useState("");
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: ElementId; box: Box; x: number; y: number; resize: boolean } | null>(null);
  const [moving, setMoving] = useState<{ id: ElementId; box: Box }>();

  const layers = studio.data?.layers ?? [];
  const [pageW, pageH] = orientation === "portrait" ? [420, 594] : [594, 420];

  // Carrega a configuração salva uma vez, quando chega.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    const saved = studio.data?.products.find((product) => product.productKey === "estudio");
    const config = saved?.config as Partial<{ title: string; paper: Paper; orientation: Orientation; grid: number; layerIds: number[]; layout: Layout }> | undefined;
    if (!config) return;
    hydrated.current = true;
    if (config.title) setTitle(config.title);
    if (config.paper) setPaper(config.paper);
    if (config.orientation) setOrientation(config.orientation);
    if (config.grid) setGrid(config.grid);
    if (Array.isArray(config.layerIds)) setLayerIds(config.layerIds);
    if (config.layout) setLayout(config.layout);
  }, [studio.data]);

  useEffect(() => { if (!layerIds.length && layers.length) setLayerIds(layers.map((l) => l.id)); }, [layers, layerIds.length]);

  const render = trpc.studioProducts.render.useMutation({
    onSuccess: (result) => { if (result.format === "svg") setSvg(result.svg); },
    onError: () => setSvg(""),
  });
  const save = trpc.studioProducts.save.useMutation({
    onSuccess: () => { void studio.refetch(); toast.success("Produto salvo"); },
    onError: (error) => toast.error(error.message),
  });
  const downloadPdf = (base64: string, filename: string) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  };
  const exportAtlas = trpc.studioProducts.renderAtlas.useMutation({
    onSuccess: (result) => downloadPdf(result.base64, result.filename),
    onError: (error) => toast.error(error.message),
  });
  const exportPdf = trpc.studioProducts.render.useMutation({
    onSuccess: (result) => { if (result.format === "pdf") downloadPdf(result.base64, result.filename); },
    onError: (error) => toast.error(error.message),
  });
  const [columns, setColumns] = useState(2);
  const [rows, setRows] = useState(2);
  const [overlap, setOverlap] = useState(10);

  // Prévia ao vivo (debounce) sempre que os parâmetros mudam.
  const paramsKey = useMemo(() => JSON.stringify([title, paper, orientation, grid, layerIds, layout]), [title, paper, orientation, grid, layerIds, layout]);
  useEffect(() => {
    if (!projectId || !layerIds.length) { setSvg(""); return; }
    const timer = window.setTimeout(() => {
      render.mutate({ projectId, layerIds, format: "svg", title, paper, orientation, grid, layout });
    }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey, projectId]);

  function start(event: PointerEvent<HTMLButtonElement>, id: ElementId, resize: boolean) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id, box: layout[id], x: event.clientX, y: event.clientY, resize };
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current, bounds = sheet.current?.getBoundingClientRect();
    if (!active || !bounds?.width || !bounds.height) return;
    const dx = (event.clientX - active.x) * pageW / bounds.width, dy = (event.clientY - active.y) * pageH / bounds.height;
    const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
    const { x, y, w, h } = active.box;
    const box = active.resize
      ? { x, y, w: clamp(w + dx, 10, pageW - x), h: clamp(h + dy, 10, pageH - y) }
      : { x: clamp(x + dx, 0, pageW - w), y: clamp(y + dy, 0, pageH - h), w, h };
    setMoving({ id: active.id, box });
  }
  function finish() {
    drag.current = null;
    if (moving) setLayout((current) => ({ ...current, [moving.id]: moving.box }));
    setMoving(undefined);
  }

  if (!loading && !isAuthenticated) return <div className="container py-8">Entre para usar o Estúdio Cartográfico.</div>;

  if (!projectId) {
    return (
      <div className="container py-8">
        <h1 className="mb-2 text-3xl font-bold">Estúdio Cartográfico</h1>
        <p className="mb-6 text-muted-foreground">Escolha um projeto para montar e exportar pranchas (A4–A0).</p>
        <ul className="space-y-2">
          {(projectsQuery.data ?? []).map((project) => (
            <li key={project.id}>
              <Link href={`/estudio?projectId=${project.id}`} className="block rounded-lg border p-3 hover:bg-accent">
                <strong>{project.name}</strong> <span className="text-xs text-muted-foreground">{project.code}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const field = "w-full";
  return (
    <div className="container grid gap-4 py-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="space-y-4 rounded-xl border bg-card p-4">
        <div>
          <h1 className="text-xl font-semibold">Estúdio Cartográfico</h1>
          <p className="text-xs text-muted-foreground">Monte a prancha e exporte em PDF.</p>
        </div>
        <div className="space-y-1"><Label htmlFor="studio-title">Título</Label>
          <Input id="studio-title" className={field} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1"><Label>Papel</Label>
            <Select value={paper} onValueChange={(v) => setPaper(v as Paper)}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{papers.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label>Orientação</Label>
            <Select value={orientation} onValueChange={(v) => { setOrientation(v as Orientation); setLayout(v === "portrait" ? portraitLayout : defaultLayout); }}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="landscape">Paisagem</SelectItem><SelectItem value="portrait">Retrato</SelectItem></SelectContent></Select></div>
        </div>
        <div className="space-y-1"><Label htmlFor="studio-grid">Grade UTM (m)</Label>
          <Input id="studio-grid" className={field} type="number" min={1000} max={50000} step={1000} value={grid} onChange={(e) => setGrid(Number(e.target.value) || 25000)} /></div>
        <div className="space-y-1">
          <Label>Camadas do produto</Label>
          {layers.length === 0 && <p className="text-xs text-muted-foreground">Este projeto ainda não tem camadas vetoriais.</p>}
          {layers.map((layer) => (
            <label key={layer.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={layerIds.includes(layer.id)} onChange={(e) =>
                setLayerIds((ids) => e.target.checked ? [...ids, layer.id] : ids.filter((id) => id !== layer.id))} />
              {layer.name}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={save.isPending || !layerIds.length} onClick={() => save.mutate({
            projectId, productKey: "estudio", title,
            config: { title, paper, orientation, grid, layerIds, layout },
          })}>{save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}Salvar</Button>
          <Button size="sm" variant="outline" disabled={exportPdf.isPending || !layerIds.length} onClick={() =>
            exportPdf.mutate({ projectId, layerIds, format: "pdf", title, paper, orientation, grid, layout })}>
            {exportPdf.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}Exportar PDF</Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Arraste os elementos pelo nome; puxe o canto para redimensionar.</p>

        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Atlas multipágina</summary>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <div className="space-y-1"><Label htmlFor="atlas-cols">Colunas</Label><Input id="atlas-cols" type="number" min={1} max={8} value={columns} onChange={(e) => setColumns(Math.min(8, Math.max(1, Number(e.target.value) || 1)))} /></div>
            <div className="space-y-1"><Label htmlFor="atlas-rows">Linhas</Label><Input id="atlas-rows" type="number" min={1} max={8} value={rows} onChange={(e) => setRows(Math.min(8, Math.max(1, Number(e.target.value) || 1)))} /></div>
            <div className="space-y-1"><Label htmlFor="atlas-ov">Sobrep. %</Label><Input id="atlas-ov" type="number" min={0} max={30} value={overlap} onChange={(e) => setOverlap(Math.min(30, Math.max(0, Number(e.target.value) || 0)))} /></div>
          </div>
          <Button size="sm" variant="outline" className="mt-2 w-full" disabled={exportAtlas.isPending || !layerIds.length || columns * rows > 24} onClick={() =>
            exportAtlas.mutate({ projectId, layerIds, columns, rows, overlap, grid, title, paper, orientation })}>
            {exportAtlas.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}Exportar atlas PDF ({columns * rows} folhas)</Button>
          {columns * rows > 24 && <p className="mt-1 text-[11px] text-destructive">Máximo de 24 folhas.</p>}
        </details>
      </aside>

      <section className="rounded-xl border bg-muted/40 p-3">
        <div ref={sheet} className="relative mx-auto" style={{ aspectRatio: `${pageW} / ${pageH}`, maxWidth: "100%" }}>
          {svg
            ? <div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
            : <div className="grid h-full w-full place-items-center rounded bg-white text-sm text-muted-foreground">{render.isPending ? "Montando a prévia…" : layerIds.length ? "Ajuste os parâmetros" : "Selecione ao menos uma camada"}</div>}
          {(Object.keys(elementNames) as ElementId[]).map((id) => {
            const box = moving?.id === id ? moving.box : layout[id];
            return (
              <div key={id} className="pointer-events-none absolute border border-blue-600" style={{
                left: box.x / pageW * 100 + "%", top: box.y / pageH * 100 + "%", width: box.w / pageW * 100 + "%", height: box.h / pageH * 100 + "%",
              }}>
                <button type="button" aria-label={"Mover " + elementNames[id]}
                  className="pointer-events-auto absolute -top-4 left-0 cursor-move touch-none whitespace-nowrap bg-blue-700 px-1 text-[10px] text-white"
                  onPointerDown={(e) => start(e, id, false)} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { drag.current = null; setMoving(undefined); }}>{elementNames[id]}</button>
                <button type="button" aria-label={"Redimensionar " + elementNames[id]}
                  className="pointer-events-auto absolute -bottom-1 -right-1 size-3 cursor-nwse-resize touch-none rounded-sm border border-white bg-blue-700"
                  onPointerDown={(e) => start(e, id, true)} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { drag.current = null; setMoving(undefined); }} />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
