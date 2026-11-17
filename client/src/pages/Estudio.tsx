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
import { defaultLayout, portraitLayout, studioBackgrounds, type Layout, type Orientation, type Paper, type StudioBackground } from "@shared/studioLayout";

type Box = { x: number; y: number; w: number; h: number };
type ElementId = keyof Layout;
const elementNames: Record<ElementId, string> = {
  principal: "Mapa principal", legenda: "Legenda", norte: "Norte", brasil: "Situação nacional", regional: "Situação regional",
};
const papers: Paper[] = ["A4", "A3", "A2", "A1", "A0"];

export default function Estudio({ projectId: projectIdProp }: { projectId?: number } = {}) {
  const { isAuthenticated, loading } = useAuth();
  const search = useSearch();
  const projectId = projectIdProp ?? (Number(new URLSearchParams(search).get("projectId")) || 0);

  const projectsQuery = trpc.projects.list.useQuery(undefined, { enabled: isAuthenticated && !projectId });
  const studio = trpc.studioProducts.list.useQuery({ projectId }, { enabled: isAuthenticated && projectId > 0 });

  const [title, setTitle] = useState("Mapa de localização");
  const [paper, setPaper] = useState<Paper>("A2");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [grid, setGrid] = useState(25000);
  const [background, setBackground] = useState<StudioBackground>("cartografico");
  const [layerIds, setLayerIds] = useState<number[]>([]);
  const [layout, setLayout] = useState<Layout>(defaultLayout);
  const [marks, setMarks] = useState<{ empresa?: number; cliente?: number }>({});
  const [productKey, setProductKey] = useState("");
  const brandsQuery = trpc.studioProducts.brands.useQuery(undefined, { enabled: isAuthenticated });
  const brands = brandsQuery.data ?? [];
  const [svg, setSvg] = useState("");
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: ElementId; box: Box; x: number; y: number; resize: boolean } | null>(null);
  const [moving, setMoving] = useState<{ id: ElementId; box: Box }>();

  const layers = studio.data?.layers ?? [];
  const [pageW, pageH] = orientation === "portrait" ? [420, 594] : [594, 420];

  const products = studio.data?.products ?? [];

  // Carrega um produto (prancha) da biblioteca no editor, ou prepara um novo.
  type StudioConfig = Partial<{ title: string; paper: Paper; orientation: Orientation; grid: number; background: StudioBackground; layerIds: number[]; layout: Layout; marks: { empresa?: number; cliente?: number } }>;
  function applyConfig(config: StudioConfig | undefined, key: string, fallbackTitle: string) {
    setProductKey(key);
    setTitle(config?.title ?? fallbackTitle);
    setPaper(config?.paper ?? "A2");
    setOrientation(config?.orientation ?? "landscape");
    setGrid(config?.grid ?? 25000);
    setBackground(config?.background ?? "cartografico");
    setLayerIds(Array.isArray(config?.layerIds) ? config!.layerIds! : []);
    setLayout(config?.layout ?? defaultLayout);
    setMarks(config?.marks ?? {});
  }
  function openProduct(product?: { productKey: string; title: string; config: unknown }) {
    if (product) applyConfig(product.config as StudioConfig, product.productKey, product.title);
    else applyConfig(undefined, "", "Mapa de localização");
  }

  // Abre uma vez o produto de ?produto= ou o primeiro da biblioteca.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || !studio.data) return;
    hydrated.current = true;
    const wanted = new URLSearchParams(search).get("produto");
    const first = studio.data.products.find((p) => p.productKey === wanted) ?? studio.data.products[0];
    if (first) openProduct(first);
  }, [studio.data]);

  useEffect(() => { if (!layerIds.length && layers.length) setLayerIds(layers.map((l) => l.id)); }, [layers, layerIds.length]);

  const render = trpc.studioProducts.render.useMutation({
    onSuccess: (result) => { if (result.format === "svg") setSvg(result.svg); },
    onError: () => setSvg(""),
  });
  const save = trpc.studioProducts.save.useMutation({
    onSuccess: (saved) => { setProductKey(saved.productKey); void studio.refetch(); toast.success("Produto salvo"); },
    onError: (error) => toast.error(error.message),
  });
  const remove = trpc.studioProducts.remove.useMutation({
    onSuccess: () => { void studio.refetch(); openProduct(undefined); toast.success("Produto removido"); },
    onError: (error) => toast.error(error.message),
  });
  const currentConfig = () => ({ title, paper, orientation, grid, background, layerIds, layout, marks });
  const newKey = () => `prancha-${Date.now().toString(36)}`;
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
  const saveBrand = trpc.studioProducts.saveBrand.useMutation({
    onSuccess: (brand) => {
      void brandsQuery.refetch();
      setMarks((current) => ({ ...current, [brand.kind]: brand.id }));
      toast.success("Marca cadastrada.");
    },
    onError: (error) => toast.error(error.message),
  });
  const uploadBrand = (kind: "empresa" | "cliente", file: File) => {
    if (file.type !== "image/png") { toast.error("Envie o logotipo em PNG."); return; }
    const reader = new FileReader();
    reader.onload = () => saveBrand.mutate({ name: file.name.replace(/\.[^.]+$/, "").slice(0, 120) || kind, kind, image: String(reader.result) });
    reader.readAsDataURL(file);
  };
  const [columns, setColumns] = useState(2);
  const [rows, setRows] = useState(2);
  const [overlap, setOverlap] = useState(10);

  // Prévia ao vivo (debounce) sempre que os parâmetros mudam.
  const paramsKey = useMemo(() => JSON.stringify([title, paper, orientation, grid, background, layerIds, layout, marks]), [title, paper, orientation, grid, background, layerIds, layout, marks]);
  useEffect(() => {
    if (!projectId || !layerIds.length) { setSvg(""); return; }
    const timer = window.setTimeout(() => {
      render.mutate({ projectId, layerIds, format: "svg", title, paper, orientation, grid, background, layout, marks });
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
        <div className="space-y-1 rounded-lg border bg-muted/30 p-2">
          <Label className="text-xs">Biblioteca de pranchas</Label>
          <Select value={productKey || "__new"} onValueChange={(v) => v === "__new" ? openProduct(undefined) : openProduct(products.find((p) => p.productKey === v))}>
            <SelectTrigger><SelectValue placeholder="Nova prancha" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__new">+ Nova prancha</SelectItem>
              {products.map((p) => <SelectItem key={p.productKey} value={p.productKey}>{p.title}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex flex-wrap gap-1 pt-1">
            <Button size="sm" variant="outline" onClick={() => openProduct(undefined)}>Nova</Button>
            <Button size="sm" variant="outline" disabled={save.isPending || !layerIds.length}
              onClick={() => save.mutate({ projectId, productKey: newKey(), title: title + " (cópia)", config: { ...currentConfig(), title: title + " (cópia)" } })}>Duplicar</Button>
            <Button size="sm" variant="outline" disabled={!productKey || remove.isPending}
              onClick={() => { if (window.confirm("Remover esta prancha da biblioteca?")) remove.mutate({ projectId, productKey }); }}>Excluir</Button>
          </div>
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
        <div className="space-y-1"><Label>Fundo do mapa</Label>
          <Select value={background} onValueChange={(v) => setBackground(v as StudioBackground)}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.entries(studioBackgrounds) as [StudioBackground, string][]).map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent></Select></div>
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Marcas da folha</summary>
          {(["empresa", "cliente"] as const).map((kind) => (
            <div key={kind} className="mt-3 space-y-1">
              <Label>{kind === "empresa" ? "Empresa responsável" : "Cliente"}</Label>
              <Select
                value={String(marks[kind] ?? 0)}
                onValueChange={(v) => setMarks((current) => ({ ...current, [kind]: Number(v) || undefined }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">{kind === "empresa" ? "Sem marca da empresa" : "Sem marca do cliente"}</SelectItem>
                  {brands.filter((b) => b.kind === kind).map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <label className="block text-xs text-muted-foreground">
                Carregar logotipo PNG {kind === "empresa" ? "da empresa" : "do cliente"}
                <input type="file" accept="image/png" className="mt-1 block w-full text-xs" disabled={saveBrand.isPending}
                  onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) uploadBrand(kind, file); }} />
              </label>
            </div>
          ))}
        </details>
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
            projectId, productKey: productKey || newKey(), title,
            config: currentConfig(),
          })}>{save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}Salvar</Button>
          <Button size="sm" variant="outline" disabled={exportPdf.isPending || !layerIds.length} onClick={() =>
            exportPdf.mutate({ projectId, layerIds, format: "pdf", title, paper, orientation, grid, background, layout, marks })}>
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
            exportAtlas.mutate({ projectId, layerIds, columns, rows, overlap, grid, title, paper, orientation, marks })}>
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
