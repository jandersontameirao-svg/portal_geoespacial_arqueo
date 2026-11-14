import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Layers3, Lock, Unlock, Magnet, Maximize, Minus, Plus, Redo2, Save, Undo2 } from "lucide-react";

type Box = { x: number; y: number; w: number; h: number };
const names = { principal: "Mapa principal", legenda: "Legenda", norte: "Norte", brasil: "Situação nacional", regional: "Situação regional" };
type ElementId = keyof typeof names;
type View = { east: number; north: number; labels: boolean; insets: Record<"brasil" | "regional", { layers?: number[]; scale?: number }> };
type Product = {
  id: string; title: string; columns: number; rows: number; overlap: number; grid: number;
  scale?: number; locks?: ElementId[]; layerIds: number[]; layout: Record<ElementId, Box>; view: View;
};
type Review = { scale: number; sheets: number; warnings: string[]; widthKm: number; heightKm: number };
type Layer = { id: number; name: string };
const elements = Object.keys(names) as ElementId[];
const number = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const input = "mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white";
const button = "inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-700";
const panel = "space-y-4 bg-white p-4 dark:bg-slate-900";
const format = { width: 594, height: 420 };

async function request(method: "list" | "save", product?: Product) {
  const payload = { json: { projectId: 11, product } };
  const endpoint = "/api/trpc/previewProducts." + method;
  const response = product ? await fetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }) : await fetch(endpoint + "?input=" + encodeURIComponent(JSON.stringify(payload)));
  const data = await response.json();
  if (!response.ok || data.error) throw Error(data.error?.json?.message ?? "Falha ao consultar os produtos.");
  return data.result.data.json;
}

function sheetUrl(format: "svg" | "pdf" | "json", product: Product, page?: number) {
  const query = new URLSearchParams({
    modelo: product.id, grade: String(product.grid), titulo: product.title,
    camadas: product.layerIds.join(","), layout: JSON.stringify(product.layout), vista: JSON.stringify(product.view),
  });
  if (product.scale) query.set("escala", String(product.scale));
  if (product.id === "atlas" || product.id === "corredor") {
    query.set("atlas", [product.columns, product.rows, product.overlap, product.grid].join(","));
  }
  if (page !== undefined) query.set("folha", String(page));
  return "/previa/prancha/11." + format + "?" + query;
}

function fitBox(box: Box): Box {
  const clamp = (value: number, max: number, min = 0) => Math.min(max, Math.max(min, Math.round(value*10)/10));
  const x = clamp(box.x, format.width-10), y = clamp(box.y, format.height-10);
  return { x, y, w: clamp(box.w, format.width-x, 10), h: clamp(box.h, format.height-y, 10) };
}

// Keep the snap tolerance consistent as the user zooms the sheet.
function alignAxis(origin: number, size: number, targets: number[], tolerance: number, resize: boolean) {
  let difference = Infinity;
  let guide: number | undefined;
  for (const anchor of resize ? [origin+size] : [origin,origin+size/2,origin+size]) {
    for (const target of targets) {
      const delta = target-anchor;
      if (Math.abs(delta) <= tolerance && Math.abs(delta) < Math.abs(difference)) {
        difference = delta;
        guide = target;
      }
    }
  }
  return { delta: guide === undefined ? 0 : difference, guide };
}

export default function PreviewMapProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Product>>({});
  const [history, setHistory] = useState<Record<string, { past: Product[]; future: Product[] }>>({});
  const [active, setActive] = useState("mapa");
  const [element, setElement] = useState<ElementId>("principal");
  const [selectedElements, setSelectedElements] = useState<ElementId[]>(["principal"]);
  const multiple = selectedElements.length > 1;
  const [mode, setMode] = useState<"layout" | "view" | "proof">("layout");
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [snap, setSnap] = useState(true);
  const [reference, setReference] = useState<ElementId | "page">("page");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [atlasDefault, setAtlasDefault] = useState<number>();
  const [review, setReview] = useState<Review>();
  const [error, setError] = useState("");
  const [proof, setProof] = useState<{ url: string; for: string }>();
  const sheet = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<{ box?: Box; guideX?: number; guideY?: number; offset?: {east:number; north:number} }>();
  const drag = useRef<{ x:number; y:number; kind:"move"|"resize"|"pan"; id:ElementId; initial:Product; scale:number } | null>(null);
  const latestGesture = useRef<typeof gesture>();
  useEffect(() => {
    request("list").then(data => {
      setProducts(data.products); setLayers(data.layers); setAtlasDefault(data.linearAtlasScale);
    }).catch(error => setNotice(error.message));
  }, []);
  const saved = products.find(product => product.id === active);
  const draft = drafts[active] ?? saved;
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const corridor = active === "corredor";
  const atlas = corridor || active === "atlas";
  const entries = history[active] ?? { past: [], future: [] };
  const reviewUrl = draft ? sheetUrl("json", draft) : "";
  const count = corridor ? review?.sheets ?? 0 : active === "atlas" && draft ? draft.rows*draft.columns : 0;
  const currentPage = Math.min(page, count);
  const previewUrl = draft ? sheetUrl("svg", draft, currentPage) : "";
  const inset = element === "brasil" || element === "regional" ? element : undefined;
  const layerIds = draft ? inset ? draft.view.insets[inset].layers : draft.layerIds : undefined;

  useEffect(() => {
    if (!reviewUrl) return;
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(reviewUrl, { signal: controller.signal });
        if (!response.ok) throw Error(await response.text());
        const value = await response.json();
        if (!controller.signal.aborted) { setReview(value); setError(""); }
      } catch (error) {
        if (!controller.signal.aborted) { setReview(undefined); setError((error as Error).message); }
      }
    }, 180);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [reviewUrl]);

  useEffect(() => {
    if (!previewUrl) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(previewUrl, { signal: controller.signal });
        if (!response.ok) throw Error(await response.text());
        const blob = await response.blob();
        if (!controller.signal.aborted) {
          objectUrl = URL.createObjectURL(blob);
          setProof({ url: objectUrl, for: previewUrl });
        }
      } catch (error) {
        if (!controller.signal.aborted) setError((error as Error).message);
      }
    }, 250);
    return () => { clearTimeout(timeout); controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [previewUrl]);

  function change(next: Product) {
    if (!draft || JSON.stringify(next) === JSON.stringify(draft)) return;
    setDrafts(current => ({ ...current, [active]: next }));
    setHistory(current => ({ ...current, [active]: { past: [...entries.past.slice(-49), draft], future: [] } }));
    setNotice("");
  }
  function undo(redo = false) {
    if (!draft || saving) return;
    const next = redo ? entries.future[0] : entries.past.at(-1);
    if (!next) return;
    setDrafts(current => ({ ...current, [active]: next }));
    setHistory(current => ({ ...current, [active]: redo
      ? { past: [...entries.past, draft], future: entries.future.slice(1) }
      : { past: entries.past.slice(0,-1), future: [draft, ...entries.future] } }));
  }
  function boxChange(box: Box) {
    if (draft && !draft.locks?.includes(element)) change({ ...draft, layout: { ...draft.layout, [element]: fitBox(box) } });
  }
  function setLayerIds(ids?: number[]) {
    if (!draft) return;
    if (inset) change({ ...draft, view: { ...draft.view, insets: {
      ...draft.view.insets, [inset]: { ...draft.view.insets[inset], layers: ids },
    } } });
    else if (ids) change({ ...draft, layerIds: ids });
  }
  function moveLayer(id: number, step: number) {
    if (!layerIds) return;
    const index = layerIds.indexOf(id), target = index + step;
    if (index < 0 || target < 0 || target >= layerIds.length) return;
    const next = [...layerIds];
    [next[index], next[target]] = [next[target], next[index]];
    setLayerIds(next);
  }

  function start(event: PointerEvent<HTMLButtonElement>, id: ElementId, kind: "move"|"resize"|"pan") {
    if (!draft || saving || event.button !== 0 || (kind !== 'pan' && draft.locks?.includes(id))) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    selectElement(id);
    drag.current = { x:event.clientX, y:event.clientY, kind, id, initial:draft, scale:review?.scale ?? 0 };
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const action = drag.current, bounds = sheet.current?.getBoundingClientRect();
    if (!action || !bounds?.width || !bounds.height) return;
    let dx = (event.clientX-action.x)*format.width/bounds.width;
    let dy = (event.clientY-action.y)*format.height/bounds.height;
    const box = action.initial.layout[action.id];
    if (event.shiftKey && action.kind === "resize") {
      if (Math.abs(dx/box.w) > Math.abs(dy/box.h)) dy = dx*box.h/box.w;
      else dx = dy*box.w/box.h;
      const ratio = Math.min((format.width-box.x)/box.w, (format.height-box.y)/box.h,
        Math.max(10/box.w, 10/box.h, 1+dx/box.w));
      dx = box.w*(ratio-1);
      dy = box.h*(ratio-1);
    } else if (event.shiftKey && action.kind === "move") {
      if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    let next: NonNullable<typeof gesture> = action.kind === "pan" ? {
      offset: {
        east: Math.max(-500000,Math.min(500000,Math.round(action.initial.view.east-dx*action.scale/1000))),
        north: Math.max(-500000,Math.min(500000,Math.round(action.initial.view.north+dy*action.scale/1000))),
      },
    } : action.kind === "resize" ? { box: fitBox({ ...box, w:box.w+dx, h:box.h+dy }) } :
      { box: fitBox({ ...box, x:Math.min(format.width-box.w,box.x+dx), y:Math.min(format.height-box.h,box.y+dy) }) };
    if (next.box && snap && !event.altKey && !event.shiftKey) {
      const others = elements.filter(id => id !== action.id).map(id => action.initial.layout[id]);
      const targetX = [20,format.width/2,474,584,...others.flatMap(b => [b.x,b.x+b.w/2,b.x+b.w])];
      const targetY = [10,format.height/2,410,...others.flatMap(b => [b.y,b.y+b.h/2,b.y+b.h])];
      const resize = action.kind === "resize", b = next.box;
      const x = alignAxis(b.x,b.w,targetX,5*format.width/bounds.width,resize);
      const y = alignAxis(b.y,b.h,targetY,5*format.height/bounds.height,resize);
      next = { box:fitBox(resize ? { ...b,w:b.w+x.delta,h:b.h+y.delta } : {
        ...b,x:Math.min(format.width-b.w,b.x+x.delta),y:Math.min(format.height-b.h,b.y+y.delta),
      }), guideX:x.guide,guideY:y.guide };
    }
    latestGesture.current = next;
    setGesture(next);
  }
  function finish(commit: boolean) {
    const action = drag.current, pending = latestGesture.current;
    drag.current = null;
    latestGesture.current = undefined;
    setGesture(undefined);
    if (!commit || !action || !pending) return;
    if (pending.offset) change({ ...action.initial, view: { ...action.initial.view, ...pending.offset } });
    if (pending.box) change({ ...action.initial, layout: { ...action.initial.layout, [action.id]:pending.box } });
  }

  function selectElement(id: ElementId, extend = false) {
    if (!extend) {
      setElement(id);
      setSelectedElements([id]);
      return;
    }
    const next = selectedElements.includes(id)
      ? selectedElements.filter(item => item !== id) : [...selectedElements, id];
    if (!next.length) return;
    setSelectedElements(next);
    setElement(next.at(-1)!);
  }

  function distribute(axis: "x" | "y") {
    if (!draft || selectedElements.length < 3) return;
    const size = axis === "x" ? "w" : "h";
    const sorted = [...selectedElements].sort((a,b) => draft.layout[a][axis]-draft.layout[b][axis]);
    const first = draft.layout[sorted[0]];
    const last = draft.layout[sorted.at(-1)!];
    const middle = sorted.slice(1,-1);
    if (middle.some(id => draft.locks?.includes(id))) {
      setNotice("Destrave os elementos intermediários para distribuir.");
      return;
    }
    // Keep the two outside elements fixed and equalize the gaps between edges.
    const span = last[axis]+last[size]-first[axis];
    const gap = (span-sorted.reduce((sum,id) => sum+draft.layout[id][size],0))/(sorted.length-1);
    if (gap < -0.000001) {
      setNotice("Afaste os elementos das extremidades para criar espaço suficiente.");
      return;
    }
    const layout = { ...draft.layout };
    let position = first[axis]+first[size];
    for (const id of middle) {
      position += Math.max(0,gap);
      layout[id] = { ...layout[id], [axis]:position };
      position += layout[id][size];
    }
    change({ ...draft, layout });
  }

  function align(edge: string) {
    if (!draft) return;
    const box = draft.layout[element];
    const target = reference === "page" || reference === element
      ? { x:20, y:10, w:564, h:400 } : draft.layout[reference];
    const x = edge === "left" ? target.x : edge === "right" ? target.x+target.w-box.w :
      edge === "center" ? target.x+(target.w-box.w)/2 : box.x;
    const y = edge === "top" ? target.y : edge === "bottom" ? target.y+target.h-box.h :
      edge === "middle" ? target.y+(target.h-box.h)/2 : box.y;
    boxChange({ ...box, x:Math.max(0,Math.min(format.width-box.w,x)), y:Math.max(0,Math.min(format.height-box.h,y)) });
  }

  function keyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && drag.current) { finish(false); return; }
    if (!draft || saving || event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    if ((event.ctrlKey || event.metaKey) && ["z","y"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      undo(event.shiftKey || event.key.toLowerCase() === "y");
      return;
    }
    if (mode !== "layout" || multiple || event.ctrlKey || event.metaKey || event.altKey ||
        !["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key) || draft.locks?.includes(element)) return;
    event.preventDefault();
    const box = draft.layout[element], step = event.shiftKey ? 5 : 1;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    boxChange({ ...box, x:Math.max(0,Math.min(format.width-box.w,box.x+dx)), y:Math.max(0,Math.min(format.height-box.h,box.y+dy)) });
  }

  async function save() {
    if (!draft) return;
    setSaving(true); setNotice("");
    try {
      const product: Product = await request("save", draft);
      setProducts(current => current.map(item => item.id === product.id ? product : item));
      setDrafts(current => ({ ...current, [product.id]: product }));
      setNotice("Produto salvo.");
    } catch (error) { setNotice((error as Error).message); }
    finally { setSaving(false); }
  }
  async function exportPdf(single: boolean) {
    if (!saved || exporting) return;
    setExporting(true);
    setNotice("");
    try {
      const response = await fetch(sheetUrl("pdf", saved, single ? currentPage : undefined));
      if (!response.ok) throw Error(await response.text());
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = saved.id + (single ? "-folha-" + (currentPage+1) : "") + "-LT-Angicos-A2.pdf";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setNotice("PDF A2 gerado.");
    } catch (error) { setNotice((error as Error).message); }
    finally { setExporting(false); }
  }

  const order = [...layers].filter(layer => layer.id !== -21 || (active === "uso-solo" && !inset))
    .sort((a,b) => (layerIds?.indexOf(b.id) ?? -1) - (layerIds?.indexOf(a.id) ?? -1));
  const selection = draft?.layout[element];
  const viewScale = review?.scale;
  const canPan = active === "mapa" && !!viewScale;
  const delta = gesture?.offset && draft && viewScale
    ? { x:(draft.view.east-gesture.offset.east)*1000/viewScale, y:(gesture.offset.north-draft.view.north)*1000/viewScale }
    : undefined;

  return <section onKeyDown={keyboard} aria-label="Estúdio Cartográfico" className="overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white">
    <style>{`
      .arqueo-studio-workspace { display:grid; }
      .arqueo-studio-canvas { background-image:radial-gradient(#94a3b860 1px, transparent 1px); background-size:14px 14px; }
      @media (min-width: 1024px) {
        .arqueo-studio-workspace { grid-template-columns:190px minmax(0,1fr) 230px; }
        .arqueo-studio-workspace > aside:first-child { border-right-width:1px; }
        .arqueo-studio-workspace > aside:last-child { border-left-width:1px; }
      }
      @media (max-width:1023px) { .arqueo-studio-workspace > div { grid-row:1; } }
    `}</style>
    <header className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 text-white" style={{ background: "#182523" }}>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Estúdio Cartográfico</h2>
        <p className="text-xs text-emerald-100/75">LT Angicos–Jaguaruana II · Grupo Arqueo</p>
      </div>
      <label className="min-w-52 grow text-xs text-emerald-100/80">Modelo de mapa ou atlas
        <select className="mt-1 block w-full rounded-md border border-white/25 px-2 py-1.5 text-sm text-white" style={{ background:"#263735" }}
          value={active} disabled={saving || !products.length} onChange={event => {
            setActive(event.target.value); setPage(0); selectElement("principal"); setReview(undefined); setError(""); setNotice(""); setMode("layout");
          }}>
          {products.map(product => <option key={product.id} value={product.id}>{product.title}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="inline-flex items-center gap-2 rounded-md border border-white/30 px-3 py-2 text-sm disabled:opacity-50" disabled={!draft || saving || !dirty || !!error || proof?.for !== previewUrl || !draft.title.trim()} onClick={() => void save()}><Save size={16} /> Salvar produto</button>
        <button type="button" className="inline-flex items-center gap-2 rounded-md bg-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-50"
          disabled={!saved || dirty || exporting || !!error || proof?.for !== previewUrl} onClick={() => void exportPdf(false)}><Download size={16} /> {exporting ? "Gerando PDF…" : atlas ? "Exportar atlas" : "Exportar PDF"}</button>
      </div>
    </header>
    <div aria-live="polite" className="flex min-h-8 flex-wrap gap-x-3 border-b border-slate-200 px-5 py-1.5 text-xs dark:border-slate-700">
      <span>{dirty ? "Alterações por salvar" : saved ? "Versão salva" : "Carregando produtos…"}</span>
      {notice && <span role="status">{notice}</span>}
      {error && <span role="alert" className="font-medium text-red-700 dark:text-red-300">{error}</span>}
    </div>
    {draft && selection && <fieldset disabled={saving} className="min-w-0">
      <div className="arqueo-studio-workspace">
        <aside className={panel + " border-slate-200 xl:border-r dark:border-slate-700"}>
          <div className="flex items-center gap-2 text-sm font-semibold"><Layers3 size={16} /> Camadas</div>
          <label className="block text-xs">Quadro de edição
            <select className={input} value={inset ?? "principal"} onChange={event => selectElement(event.target.value as ElementId)}>
              <option value="principal">Mapa principal</option><option value="brasil">Situação nacional</option><option value="regional">Situação regional</option>
            </select>
          </label>
          {inset && <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={layerIds === undefined} onChange={event => setLayerIds(event.target.checked ? undefined : [15])} /> Usar conteúdo do modelo
          </label>}
          <div className="space-y-1">
            {order.map(layer => {
              const index = layerIds?.indexOf(layer.id) ?? -1;
              const required = !inset && ((corridor && layer.id === 15) || (active === "uso-solo" && [15,-21].includes(layer.id)));
              const name = layer.name.replace(/\.geojson$/i,"");
              return <div className="flex items-center gap-1 rounded-md bg-slate-50 px-1.5 py-1 dark:bg-slate-800" key={layer.id}>
                <label className="flex min-w-0 grow items-start gap-2 text-xs">
                  <input type="checkbox" checked={index >= 0} disabled={required || layerIds === undefined}
                    onChange={event => setLayerIds(event.target.checked ? [...(layerIds ?? []), layer.id] : layerIds?.filter(id => id !== layer.id))} />
                  <span className="break-words">{name}</span>
                </label>
                {index >= 0 && <div className="flex shrink-0">
                  <button type="button" aria-label={"Subir " + name} disabled={index === (layerIds?.length ?? 0)-1} onClick={() => moveLayer(layer.id, 1)} className="p-1 disabled:opacity-30"><ArrowUp size={12}/></button>
                  <button type="button" aria-label={"Descer " + name} disabled={index === 0} onClick={() => moveLayer(layer.id, -1)} className="p-1 disabled:opacity-30"><ArrowDown size={12}/></button>
                </div>}
              </div>;
            })}
          </div>
        </aside>
        <div className="min-w-0 bg-slate-100 dark:bg-slate-800">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
            {(["layout","view","proof"] as const).map(tab => <button key={tab} type="button" className={button + (mode === tab ? " bg-emerald-100 text-emerald-950 dark:text-white dark:bg-emerald-900" : "")}
              aria-pressed={mode === tab} disabled={tab === "view" && !canPan} onClick={() => { setMode(tab); if (tab === "view") selectElement("principal"); }}>
              {{ layout:"Layout", view:"Enquadrar", proof:"Prova" }[tab]}
            </button>)}
            <button type="button" className={button} aria-label="Desfazer" disabled={!entries.past.length} onClick={() => undo()}><Undo2 size={15} /></button>
            <button type="button" className={button} aria-label="Refazer" disabled={!entries.future.length} onClick={() => undo(true)}><Redo2 size={15} /></button>
            {mode === "layout" && <button type="button" className={button} aria-pressed={snap} title="Encostar nas bordas e nos centros dos elementos" onClick={() => setSnap(!snap)}><Magnet size={15} /> Guias</button>}
            <div className="ml-auto flex items-center gap-1">
              <button type="button" className={button} aria-label="Reduzir zoom da folha" disabled={zoom <= 60} onClick={() => setZoom(zoom-20)}><Minus size={14}/></button>
              <span className="min-w-9 text-center text-xs">{zoom}%</span>
              <button type="button" className={button} aria-label="Ampliar zoom da folha" disabled={zoom >= 220} onClick={() => setZoom(zoom+20)}><Plus size={14}/></button>
              <button type="button" className={button} aria-label="Ajustar folha à tela" onClick={() => setZoom(100)}><Maximize size={14}/></button>
            </div>
          </div>
          <div className="arqueo-studio-canvas min-h-56 overflow-auto p-5" style={{ maxHeight: "70vh" }}>
            <div className="mx-auto" style={{ width: zoom + "%" }}>
              {mode !== "proof" && <div aria-hidden="true" className="relative mb-1 h-4 border-b border-slate-400 font-mono text-[9px]">{
                [0,100,200,300,400,500,594].map(mark => <span className="absolute bottom-0 border-l border-slate-400 pl-0.5" style={{ left:mark/594*100+"%", transform:mark===594 ? "translateX(-100%)" : undefined }} key={mark}>{mark===594 ? "594 mm" : mark}</span>)
              }</div>}
              <div ref={sheet} className="relative bg-white shadow-lg" style={{ aspectRatio: "594/420" }}>
                {proof?.for === previewUrl ? <img src={proof.url} alt={atlas && currentPage === 0 ? "Mapa índice do atlas" : "Prancha cartográfica A2"} className="block size-full object-contain" />
                  : <div className="grid h-full place-items-center text-sm text-slate-700">{error || "Renderizando prancha…"}</div>}
                {mode === "layout" && !(active === "atlas" && currentPage === 0) && [...elements.filter(id => id !== element), element].map(id => {
                  const selected = selectedElements.includes(id);
                  const locked = draft.locks?.includes(id);
                  const box = (id === element ? gesture?.box : undefined) ?? draft.layout[id];
                  return <div key={id} className={"pointer-events-none absolute " + (selected ? "border border-emerald-600" : "")} style={{
                    left: box.x/594*100+"%", top: box.y/420*100+"%", width: box.w/594*100+"%", height: box.h/420*100+"%",
                  }}>
                    <button type="button" aria-label={"Selecionar " + names[id]} aria-pressed={selected} onClick={event => selectElement(id,event.shiftKey)} className="pointer-events-auto absolute inset-0 hover:ring-1 hover:ring-inset hover:ring-emerald-600" />
                    {selected && !multiple && !locked && <><button type="button" aria-label={"Mover " + names[id]} className="pointer-events-auto absolute -top-4 left-0 cursor-move touch-none whitespace-nowrap rounded-sm bg-emerald-800 px-1.5 text-[10px] text-white"
                      onPointerDown={event => start(event,id,"move")} onPointerMove={move} onPointerUp={() => finish(true)} onPointerCancel={() => finish(false)}>{names[id]}</button>
                    <button type="button" aria-label={"Redimensionar " + names[id]} className="pointer-events-auto absolute -bottom-1 -right-1 size-3 cursor-nwse-resize touch-none rounded-sm border border-white bg-emerald-700"
                      onPointerDown={event => start(event,id,"resize")} onPointerMove={move} onPointerUp={() => finish(true)} onPointerCancel={() => finish(false)} /></>}
                  </div>;
                })}
                {gesture?.guideX !== undefined && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-10 border-l border-dashed border-fuchsia-600" style={{ left:gesture.guideX/594*100+"%" }} />}
                {gesture?.guideY !== undefined && <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-fuchsia-600" style={{ top:gesture.guideY/420*100+"%" }} />}
                {mode === "view" && canPan && <button type="button" aria-label="Arrastar enquadramento do mapa principal"
                  className="absolute cursor-grab touch-none border border-dashed border-emerald-600 active:cursor-grabbing"
                  style={{ left: (draft.layout.principal.x+(delta?.x ?? 0))/594*100+"%", top: (draft.layout.principal.y+(delta?.y ?? 0))/420*100+"%", width: draft.layout.principal.w/594*100+"%", height:draft.layout.principal.h/420*100+"%" }}
                  onPointerDown={event => start(event,"principal","pan")} onPointerMove={move} onPointerUp={() => finish(true)} onPointerCancel={() => finish(false)} />}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900">
            {atlas ? <>
              <button type="button" className={button} aria-label="Folha anterior" disabled={currentPage < 1} onClick={() => setPage(currentPage-1)}><ChevronLeft size={14}/></button>
              <label>Visualização <select className="rounded border px-2 py-1 dark:bg-slate-900" value={currentPage} onChange={event => setPage(Number(event.target.value))}>
                <option value={0}>Mapa índice</option>
                {Array.from({ length: count }, (_,i) => <option key={i+1} value={i+1}>Folha {i+(corridor ? 2 : 1)}</option>)}
              </select></label>
              <button type="button" className={button} aria-label="Próxima folha" disabled={currentPage >= count} onClick={() => setPage(currentPage+1)}><ChevronRight size={14}/></button>
              {corridor && <><span>{count} folhas de detalhe</span><button type="button" className={button} disabled={dirty || exporting || !!error || proof?.for !== previewUrl} onClick={() => void exportPdf(true)}>Exportar folha</button></>}
            </> : <span>A2 horizontal · 594 × 420 mm</span>}
          </div>
        </div>
        <aside className={panel + " border-slate-200 xl:border-l dark:border-slate-700"}>
          <div className="text-sm font-semibold">Propriedades da prancha</div>
          <label className="block text-xs">Título da folha<input className={input} maxLength={85} value={draft.title} onChange={event => change({ ...draft, title:event.target.value })} /></label>
          <label className="block text-xs">Escala do mapa principal 1:<input className={input} type="number" min={1000} max={10000000} placeholder="Automática"
            value={draft.scale ?? ""} onChange={event => change({ ...draft, scale:event.target.value ? event.target.valueAsNumber : undefined })} /></label>
          {corridor && atlasDefault && <button type="button" className="text-xs underline" onClick={() => change({ ...draft, scale: atlasDefault })}>Usar escala padrão 1:{number(atlasDefault)}</button>}
          {([["columns","Colunas",1,8],["rows","Linhas",1,8],["overlap","Sobreposição (%)",0,30],["grid","Grade UTM (m)",corridor ? 100 : 1000,50000]] as const)
            .filter(([key]) => key === "grid" || (atlas && (!corridor || key === "overlap"))).map(([key,label,min,max]) => <label key={key} className="block text-xs">{label}
              <input className={input} type="number" min={min} max={max} value={Number.isFinite(draft[key]) ? draft[key] : ""} onChange={event => change({ ...draft, [key]:event.target.valueAsNumber })} />
            </label>)}
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.view.labels} onChange={event => change({ ...draft, view:{ ...draft.view, labels:event.target.checked } })}/> Rótulos municipais</label>
          <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
            {mode === "layout" && !(active === "atlas" && currentPage === 0) && <details className="mb-3 text-xs" open={multiple || undefined}>
              <summary className="cursor-pointer font-medium">Seleção e distribuição · {selectedElements.length} {multiple ? "elementos" : "elemento"}</summary>
              <p className="my-2 text-slate-500">Use Shift + clique na folha ou marque os elementos abaixo.</p>
              <div className="space-y-1">
                {elements.map(id => <label key={id} className="flex items-center gap-2">
                  <input type="checkbox" checked={selectedElements.includes(id)} onChange={() => selectElement(id,true)} /> {names[id]}
                </label>)}
              </div>
              <p className="mt-2 text-slate-500">Selecione pelo menos três. As extremidades ficam no lugar.</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <button type="button" className={button} disabled={selectedElements.length < 3} onClick={() => distribute("x")}>Distribuir horizontalmente</button>
                <button type="button" className={button} disabled={selectedElements.length < 3} onClick={() => distribute("y")}>Distribuir verticalmente</button>
              </div>
            </details>}
            {!multiple && <><label className="block text-xs font-medium">Elemento da folha<select className={input} value={element} onChange={event => selectElement(event.target.value as ElementId)}>
              {elements.map(id => <option value={id} key={id}>{names[id]}</option>)}
            </select></label>
            <button type="button" className={button + " mt-2"} onClick={() => {
              const locks = draft.locks ?? [];
              change({ ...draft, locks: locks.includes(element) ? locks.filter(id => id !== element) : [...locks, element] });
            }}>{draft.locks?.includes(element) ? <><Unlock size={14} /> Destravar posição</> : <><Lock size={14} /> Travar posição</>}</button>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {([["x","X (mm)"],["y","Y (mm)"],["w","Largura (mm)"],["h","Altura (mm)"]] as const).map(([key,label]) =>
                <label className="text-xs" key={key}>{label}<input className={input} type="number" step="0.1" disabled={draft.locks?.includes(element)} key={element + key + selection[key]}
                  defaultValue={Math.round(selection[key]*10)/10} onBlur={event => { if (Number.isFinite(event.target.valueAsNumber)) boxChange({ ...selection, [key]:event.target.valueAsNumber }); }}
                  onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>)}
            </div>
            {inset === "regional" && <label className="mt-3 block text-xs">Escala do quadro 1:<input className={input} type="number" min={1000} max={10000000} placeholder="Automática"
              value={draft.view.insets[inset].scale ?? ""} onChange={event => change({ ...draft, view:{ ...draft.view, insets:{
                ...draft.view.insets, [inset]:{ ...draft.view.insets[inset], scale:event.target.value ? event.target.valueAsNumber : undefined },
              } } })} /></label>}
            {mode === "layout" && !draft.locks?.includes(element) && <details className="mt-3 text-xs">
              <summary className="cursor-pointer font-medium">Alinhar elemento</summary>
              <label className="mt-2 block">Referência
                <select className={input} value={reference === element ? "page" : reference} onChange={event => setReference(event.target.value as ElementId | "page")}>
                  <option value="page">Margens da folha</option>
                  {elements.filter(id => id !== element).map(id => <option key={id} value={id}>{names[id]}</option>)}
                </select>
              </label>
              <div className="mt-2 grid grid-cols-3 gap-1">
                {([["left","Esquerda"],["center","Centro"],["right","Direita"],["top","Topo"],["middle","Meio"],["bottom","Base"]] as const)
                  .map(([edge,label]) => <button type="button" key={edge} className={button + " !px-1 !text-xs"} onClick={() => align(edge)}>{label}</button>)}
              </div>
            </details>}
            {mode === "layout" && <p className="mt-2 text-xs text-slate-500">Setas movem 1 mm. Shift + setas movem 5 mm. Shift no arraste restringe o eixo ou mantém a proporção.</p>}
            </>}
            {canPan && element === "principal" && <button type="button" className="mt-3 text-xs underline" disabled={!draft.view.east && !draft.view.north}
              onClick={() => change({ ...draft, view:{ ...draft.view, east:0, north:0 } })}>Restaurar enquadramento</button>}
          </div>
          <div className="rounded-md bg-slate-100 p-3 text-xs dark:bg-slate-800">
            <div className="mb-1 font-semibold">Revisão técnica</div>
            <div>SIRGAS 2000 / UTM 24S</div>
            {review && <div>{corridor ? "Folhas de detalhe" : "Quadro principal"} 1:{number(review.scale)} · {number(review.widthKm)} × {number(review.heightKm)} km</div>}
            {review?.warnings.map(warning => <p className="mt-1 text-amber-800 dark:text-amber-200" key={warning}>{warning}</p>)}
          </div>
        </aside>
      </div>
    </fieldset>}
  </section>;
}
