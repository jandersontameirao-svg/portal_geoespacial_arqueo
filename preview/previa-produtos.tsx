import { useEffect, useRef, useState, type PointerEvent } from "react";

type Box = { x: number; y: number; w: number; h: number };
const names = { legenda: "Legenda", norte: "Norte", brasil: "Situação nacional", regional: "Situação regional" };
type ElementId = keyof typeof names;
type Product = { id: string; title: string; columns: number; rows: number; overlap: number; grid: number; scale?: number; layerIds: number[]; layout: Record<ElementId, Box> };

async function request(method: "list" | "save", product?: Product) {
  const input = { json: { projectId: 11, product } };
  const endpoint = "/api/trpc/previewProducts." + method;
  const response = product ? await fetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }) : await fetch(endpoint + "?input=" + encodeURIComponent(JSON.stringify(input)));
  const payload = await response.json();
  if (!response.ok || payload.error) throw Error(payload.error?.json?.message ?? "Falha ao consultar os produtos.");
  return payload.result.data.json;
}

export default function PreviewMapProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [layers, setLayers] = useState<{id: number; name: string}[]>([]);
  const [draft, setDraft] = useState<Product>();
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: ElementId; box: Box; x: number; y: number; resize: boolean } | null>(null);
  const [moving, setMoving] = useState<{id: ElementId; box: Box}>();
  useEffect(() => { request("list").then(data => { setProducts(data.products); setLayers(data.layers); setLinearAtlasScale(data.linearAtlasScale); }).catch(error => setNotice(error.message)); }, []);
  const saved = products.find(product => product.id === draft?.id);
  const corridor = draft?.id === "corredor";
  const atlas = corridor || draft?.id === "atlas";
  const [pageCount, setPageCount] = useState(0);
  const [linearAtlasScale, setLinearAtlasScale] = useState<number>();
  const queryFor = (product?: Product) => {
    const query = new URLSearchParams();
    if (!product) return query;
    query.set("modelo", product.id);
    query.set("grade", String(product.grid));
    query.set("titulo", product.title);
    query.set("camadas", product.layerIds.join(","));
    query.set("layout", JSON.stringify(product.layout));
    if (product.scale) query.set("escala", String(product.scale));
    if (product.id === "atlas" || product.id === "corredor") query.set("atlas", [product.columns, product.rows, product.overlap, product.grid].join(","));
    return query;
  };
  const download = "/previa/prancha/11.pdf?" + queryFor(saved);
  // Keep the sheet stable while dragging. Render the draft on release with the
  // same millimetre coordinates that are sent to the PDF renderer after saving.
  const query = queryFor(draft && saved ? { ...saved, layout: draft.layout } : saved);
  query.set("folha", String(page));
  const preview = "/previa/prancha/11.svg?" + query;
  const countUrl = "/previa/prancha/11.json?" + queryFor(saved);
  useEffect(() => {
    if (!corridor) return;
    const controller = new AbortController();
    setPageCount(0);
    fetch(countUrl, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw Error(await response.text());
      setPageCount((await response.json()).sheets);
    }).catch(error => { if (!controller.signal.aborted) setNotice(error.message); });
    return () => controller.abort();
  }, [corridor, countUrl]);
  function start(event: PointerEvent<HTMLButtonElement>, id: ElementId, resize: boolean) {
    if (!draft || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id, box: draft.layout[id], x: event.clientX, y: event.clientY, resize };
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current, bounds = sheet.current?.getBoundingClientRect();
    if (!active || !bounds?.width || !bounds.height) return;
    const dx = (event.clientX-active.x)*594/bounds.width, dy = (event.clientY-active.y)*420/bounds.height;
    const clamp = (v: number, min: number, max: number) => Math.min(max,Math.max(min,v));
    const {x,y,w,h} = active.box;
    const box = active.resize ? { x,y,w:clamp(w+dx,10,594-x),h:clamp(h+dy,10,420-y) } :
      { x:clamp(x+dx,0,594-w),y:clamp(y+dy,0,420-h),w,h };
    setMoving({ id: active.id, box });
  }
  function finish() {
    drag.current = null;
    if (moving) setDraft(current => current && ({ ...current, layout: { ...current.layout, [moving.id]: moving.box } }));
    setMoving(undefined);
  }
  const controls = "w-full rounded-md border bg-background px-3 py-2 text-sm";
  return <section className="space-y-5">
    <div><h2 className="text-xl font-semibold">Mapas e Atlas</h2><p className="text-sm text-muted-foreground">Abra um produto salvo para editar a composição e exportar em A2.</p></div>
    <label className="block max-w-md space-y-1 text-sm">Modelo de mapa ou atlas
      <select className={controls} value={draft?.id ?? ""} disabled={saving} onChange={event => {
        setDraft(products.find(product => product.id === event.target.value)); setPage(0); setNotice("");
      }}>
        <option value="">Selecione um modelo</option>
        {products.map(product => <option key={product.id} value={product.id}>{product.title}</option>)}
      </select>
    </label>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {draft && saved && <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <form className="space-y-3 rounded-xl border bg-card p-4" onSubmit={async event => {
        event.preventDefault();
        setSaving(true); setNotice("");
        try {
          const product: Product = await request("save", draft);
          setProducts(current => current.map(item => item.id === product.id ? product : item));
          setDraft(product); setPage(0); setNotice("Produto salvo.");
        } catch (error) { setNotice((error as Error).message); }
        finally { setSaving(false); }
      }}>
        <label className="block text-sm">Título da folha<input className={controls} required maxLength={85} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
        <label className="block text-sm">Escala 1:<input className={controls} type="number" min="1000" max="10000000" placeholder={corridor ? "Escala inicial do corredor" : "Automática"}
          value={draft.scale ?? ""} onChange={event => setDraft({ ...draft, scale: event.target.value ? event.target.valueAsNumber : undefined })} /></label>
        {corridor && linearAtlasScale && <button type="button" className="text-xs underline" onClick={() => setDraft({ ...draft, scale: linearAtlasScale })}>Usar escala padrão 1:{linearAtlasScale.toLocaleString("pt-BR")}</button>}
        <fieldset className="space-y-1"><legend className="text-sm font-medium">Camadas do produto</legend>
          {layers.filter(layer => layer.id !== -21 || draft.id === "uso-solo").map(layer => <label key={layer.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.layerIds.includes(layer.id)} disabled={(corridor && layer.id === 15) || (draft.id === "uso-solo" && [-21, 15].includes(layer.id))} onChange={event => {
              setDraft({ ...draft, layerIds: event.target.checked ? [...draft.layerIds, layer.id] : draft.layerIds.filter(id => id !== layer.id) });
            }} />{layer.name}
          </label>)}
        </fieldset>
        {atlas && <>{([
          ["columns", "Colunas", 1, 8], ["rows", "Linhas", 1, 8],
          ["overlap", "Sobreposição (%)", 0, 30], ["grid", "Grade UTM (m)", corridor ? 100 : 1000, 50000],
        ] as const).filter(([key]) => !corridor || key === "overlap" || key === "grid").map(([key, label, min, max]) => <label key={key} className="block text-sm">{label}
          <input className={controls} type="number" min={min} max={max} required value={draft[key]}
            onChange={event => setDraft({ ...draft, [key]: event.target.valueAsNumber })} />
        </label>)}</>}
        <button disabled={saving} className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Salvar produto</button>
        <p className="text-xs text-muted-foreground">Salve para aplicar a escala e as camadas ao PDF. Uma escala fixa pode cortar a área.</p>
      </form>
      <div className="space-y-3 rounded-xl border bg-muted/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {atlas ? <label className="text-sm">Visualização <select className="rounded-md border bg-background px-2 py-1" value={page} onChange={event => setPage(Number(event.target.value))}>
            <option value={0}>Mapa índice</option>
            {Array.from({ length: corridor ? pageCount : saved.rows * saved.columns }, (_, i) => <option key={i+1} value={i+1}>Folha {i+(corridor ? 2 : 1)}</option>)}
          </select></label> : <span className="text-sm">A2 horizontal</span>}
          <a className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" href={download} download>Exportar PDF</a>
        </div>
        {(!atlas || page > 0) && <p className="text-xs text-muted-foreground">Arraste pelo nome. Puxe a alça no canto inferior direito para redimensionar.</p>}
        <div ref={sheet} className="relative">
          <img className="block w-full rounded bg-white" style={atlas && !corridor && page === 0 ? undefined : {aspectRatio:"594 / 420"}} src={preview} alt={atlas && page === 0 ? "Mapa índice com as folhas numeradas" : "Prévia da folha A2"} />
          {(!atlas || page > 0) && (Object.keys(names) as ElementId[]).map(id => {
            const box = moving?.id === id ? moving.box : draft.layout[id];
            return <div key={id} className="pointer-events-none absolute border border-blue-600" style={{
              left: box.x/594*100+"%", top: box.y/420*100+"%", width: box.w/594*100+"%", height: box.h/420*100+"%",
            }}>
              <button type="button" aria-label={"Mover " + names[id]} className="pointer-events-auto absolute -top-4 left-0 touch-none whitespace-nowrap bg-blue-700 px-1 text-[10px] text-white cursor-move"
                onPointerDown={event => start(event,id,false)} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => {drag.current=null;setMoving(undefined);}}>{names[id]}</button>
              <button type="button" aria-label={"Redimensionar " + names[id]} className="pointer-events-auto absolute -bottom-1 -right-1 size-3 touch-none rounded-sm border border-white bg-blue-700 cursor-nwse-resize"
                onPointerDown={event => start(event,id,true)} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => {drag.current=null;setMoving(undefined);}} />
            </div>;
          })}
        </div>
      </div>
    </div>}
  </section>;
}
