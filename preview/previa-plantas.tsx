import {useEffect,useRef,useState} from "react";

type PlantDocument={id:string;versions:{createdAt:string;plant:Plant}[]};
const tools:Record<Entity["kind"],string>={line:"Linha",rect:"Retângulo",circle:"Círculo",text:"Texto",dimension:"Cota",block:"Bloco de referência"};
const field="block w-full rounded border bg-background px-2 py-1.5 text-sm";
const button="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50";
const initialPlant=():Plant=>({...samplePlant("Nova planta"),author:"",entities:[]});
const lengthText=(entity:Entity,unit?:string)=>((Math.hypot(entity.a[0]-entity.b[0],entity.a[1]-entity.b[1]))*metresPerUnit(unit)).toLocaleString("pt-BR",{maximumFractionDigits:3})+" m";

async function plantRequest(method:string, payload:object, post=false) {
  const url="/api/trpc/previewPlants."+method, json=JSON.stringify({json:payload});
  const response=post?await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:json}):await fetch(url+"?input="+encodeURIComponent(json));
  const data=await response.json();
  if (!response.ok||data.error) throw Error(data.error?.json?.message??"Operação indisponível.");
  return data.result.data.json;
}
function downloadPlant(value:Blob,name:string) {
  const url=URL.createObjectURL(value);
  const link=document.createElement("a");
  link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}

export default function PreviewPlants({projectId}:{projectId:number}) {
  const [docs,setDocs]=useState<PlantDocument[]>([]);
  const [id,setId]=useState("");
  const [version,setVersion]=useState(0);
  const [plant,setPlant]=useState<Plant>(initialPlant);
  const [kind,setKind]=useState<Entity["kind"]>("rect");
  const [layer,setLayer]=useState("Implantação");
  const [caption,setCaption]=useState("");
  const [coordinates,setCoordinates]=useState("0, 0, 5, 4");
  const [selected,setSelected]=useState(-1);
  const [hidden,setHidden]=useState<string[]>([]);
  const [busy,setBusy]=useState(true);
  const [dirty,setDirty]=useState(false);
  const [status,setStatus]=useState("");
  const [mapUrl,setMapUrl]=useState("");
  const svg=useRef<SVGSVGElement>(null);
  const backend=(method:string,data:object={},write=false)=>plantRequest(method,{projectId,...data},write);
  function open(document?:PlantDocument,index=document?.versions.length??0) {
    setId(document?.id??"");setVersion(index);setPlant(document?.versions[index-1]?.plant??initialPlant());
    setSelected(-1);setHidden([]);setDirty(false);setMapUrl("");
  }
  useEffect(()=>{
    let cancelled=false;
    plantRequest("list",{projectId}).then((rows:PlantDocument[])=>{
      if (cancelled) return;
      setDocs(rows);open(rows.find(row=>row.id===new URLSearchParams(location.search).get("planta")));
    }).catch(error=>{if(!cancelled)setStatus(error.message);}).finally(()=>{if(!cancelled)setBusy(false);});
    return ()=>{cancelled=true;};
  },[projectId]);
  const current=docs.find(row=>row.id===id);
  function update(next:Plant) {setPlant(next);setDirty(true);setMapUrl("");}
  function choose(document?:PlantDocument,index?:number) {
    if(dirty&&!window.confirm("Descartar as alterações sem salvar?"))return;
    open(document,index);
  }
  async function run(action:()=>Promise<void>) {
    setBusy(true);setStatus("");
    try {await action();} catch(error) {setStatus((error as Error).message);}
    finally {setBusy(false);}
  }
  async function save(copy:boolean) {
    await run(async()=>{
      const result:PlantDocument=await backend("save",{id:copy?undefined:id||undefined,baseVersion:current?.versions.length,plant},true);
      setDocs(rows=>[...rows.filter(row=>row.id!==result.id),result]);open(result);
      const url=new URL(location.href);url.searchParams.set("planta",result.id);history.replaceState(history.state,"",url);
      setStatus("Versão "+result.versions.length+" salva.");
    });
  }
  function editEntity(replace:boolean) {
    try {
      const [ax,ay,bx,by,...rest]=coordinates.split(",").map(s=>s.trim());
      if(rest.length||[ax,ay,bx,by].some(v=>!v))throw Error("Informe x1, y1, x2 e y2 separados por vírgula.");
      const entity:Entity={kind,layer,label:caption,a:[Number(ax),Number(ay)],b:[Number(bx),Number(by)]};
      const items=replace?plant.entities.map((item,index)=>index===selected?entity:item):[...plant.entities,entity];
      update(readPlant({...plant,entities:items}));setStatus("");
    } catch(error) {setStatus((error as Error).message);}
  }
  function select(index:number) {
    const item=plant.entities[index];setSelected(index);setKind(item.kind);setLayer(item.layer);setCaption(item.label);
    setCoordinates([...item.a,...item.b].join(", "));
  }
  const [short,long]=plant.paper==="A3"?[297,420]:[210,297];
  const [w,h]=plant.portrait?[short,long]:[long,short];
  // One model unit becomes this many physical millimetres at the selected scale.
  const k=1000*metresPerUnit(plant.origin?.unit)/Math.max(1,plant.scale);
  const layers=[...new Set(plant.entities.map(e=>e.layer))];
  const projected=(p:Point):Point=>[w/2+p[0]*k,h/2-p[1]*k];
  const clipped=plant.entities.some(e=>{
    const [x,y]=projected(e.a),[xx,yy]=projected(e.b);
    const r=e.kind==="circle"?Math.hypot(x-xx,y-yy):0;
    return Math.min(x-r,xx)<8||Math.max(x+r,xx)>w-8||Math.min(y-r,yy)<8||Math.max(y+r,yy)>h-42;
  });
  const origin=plant.origin;
  return <section aria-label="Estúdio de Plantas" className="overflow-hidden rounded-xl border bg-background">
    <header className="flex flex-wrap items-center justify-between gap-3 bg-[#182523] p-4 text-white">
      <div><h2 className="text-xl font-semibold">Estúdio de Plantas</h2><p className="text-sm text-emerald-100">Desenho 2D · implantação · pranchas</p></div>
      <button className={button+" hover:text-foreground"} onClick={()=>window.dispatchEvent(new CustomEvent("studio-open-atena",{detail:'Criar planta fictícia "Implantação de ensaio"'}))}>Criar com a Atena</button>
    </header>
    <div className="flex flex-wrap items-end gap-2 border-b p-3">
      <label>Planta<select className={field} value={id} onChange={e=>choose(docs.find(row=>row.id===e.target.value))}>
        <option value="">Nova planta</option>{docs.map(row=><option key={row.id} value={row.id}>{row.versions.at(-1)?.plant.title}</option>)}
      </select></label>
      <label>Versão<select className={field} value={version} disabled={!current} onChange={e=>choose(current,+e.target.value)}>
        {!current&&<option value={0}>Rascunho</option>}{current?.versions.map((v,i)=><option key={i} value={i+1}>V{i+1} · {new Date(v.createdAt).toLocaleString("pt-BR")}</option>)}
      </select></label>
      <button className={button} onClick={()=>choose()}>Nova</button>
      <button className={button} disabled={busy||(!dirty&&!!id)} onClick={()=>void save(false)}>Salvar versão</button>
      <button className={button} disabled={busy||!id} onClick={()=>void save(true)}>Salvar cópia</button>
      <a className={button} href={"/projects/"+projectId+"?tab=files"}>Arquivos CAD do projeto</a>
      <input className="hidden" id="plant-json-import" type="file" accept=".json,application/json" onChange={async e=>{
        const file=e.currentTarget.files?.[0];e.currentTarget.value="";
        if(!file||dirty&&!window.confirm("Descartar as alterações sem salvar?"))return;
        try {if(file.size>1000000)throw Error("Use um JSON de até 1 MB.");const imported=readPlant(JSON.parse(await file.text()));open();update(imported);setStatus("JSON importado. Salve como planta do projeto.");}
        catch(error){setStatus((error as Error).message);}
      }}/>
      <label className={button+" cursor-pointer"} htmlFor="plant-json-import">Importar JSON</label>
      <button className={button} onClick={()=>downloadPlant(new Blob([JSON.stringify(plant,null,2)],{type:"application/json"}),"planta.json")}>Baixar JSON</button>
      <button className={button} onClick={()=>{
        if(svg.current)downloadPlant(new Blob([new XMLSerializer().serializeToString(svg.current)],{type:"image/svg+xml"}),"prancha.svg");
      }}>Baixar prancha SVG</button>
    </div>
    <p role="status" className="min-h-8 px-4 py-2 text-sm">{status || (dirty?"Alterações por salvar":"")}</p>
    <div className="grid gap-4 p-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="space-y-4">
        <fieldset className="grid gap-2 rounded-lg border p-3" disabled={busy}>
          <legend className="px-1 font-semibold">Desenho</legend>
          <label>Ferramenta<select className={field} value={kind} onChange={e=>setKind(e.target.value as Entity["kind"])}>{Object.entries(tools).map(([v,name])=><option key={v} value={v}>{name}</option>)}</select></label>
          <label>Coordenadas locais <input className={field} value={coordinates} onChange={e=>setCoordinates(e.target.value)}/></label>
          <label>Camada<input className={field} maxLength={40} value={layer} onChange={e=>setLayer(e.target.value)}/></label>
          <label>Texto ou nome do bloco<input className={field} maxLength={100} value={caption} onChange={e=>setCaption(e.target.value)}/></label>
          <div className="flex flex-wrap gap-2"><button className={button} onClick={()=>editEntity(false)}>Adicionar elemento</button>
          <button className={button} disabled={selected<0} onClick={()=>editEntity(true)}>Atualizar</button>
          <button className={button} disabled={selected<0} onClick={()=>{update({...plant,entities:plant.entities.filter((_,i)=>i!==selected)});setSelected(-1);}}>Remover</button></div>
          <label>Elementos<select size={Math.min(6,Math.max(2,plant.entities.length))} className={field} value={selected} onChange={e=>select(+e.target.value)}>
            {plant.entities.map((item,i)=><option key={i} value={i}>{tools[item.kind]} · {item.label||item.layer}{item.kind==="dimension"?" · "+lengthText(item,origin?.unit):""}</option>)}
          </select></label>
          {layers.length>0&&<div className="text-sm font-medium">Camadas{layers.map(name=><label key={name} className="block font-normal">
            <input type="checkbox" checked={!hidden.includes(name)} onChange={e=>setHidden(values=>e.target.checked?values.filter(v=>v!==name):[...values,name])}/> {name}
          </label>)}</div>}
        </fieldset>
        <fieldset className="grid gap-2 rounded-lg border p-3">
          <legend className="px-1 font-semibold">Implantação UTM · SIRGAS 2000</legend>
          <label><input type="checkbox" checked={!!origin} onChange={e=>update({...plant,origin:e.target.checked?{zone:24,south:true,east:500000,north:9400000,rotation:0,unit:"m"}:undefined})}/> Definir origem e unidade</label>
          {origin&&<>
            {([["east","Leste (m)"],["north","Norte (m)"],["zone","Fuso"],["rotation","Rotação anti-horária (°)"]] as const).map(([key,name])=>
              <label key={key}>{name}<input className={field} type="number" value={origin[key]} onChange={e=>update({...plant,origin:{...origin,[key]:e.target.valueAsNumber}})}/></label>)}
            <label>Hemisfério<select className={field} value={origin.south?"S":"N"} onChange={e=>update({...plant,origin:{...origin,south:e.target.value==="S"}})}><option>S</option><option>N</option></select></label>
            <label>Unidade do desenho<select className={field} value={origin.unit} onChange={e=>update({...plant,origin:{...origin,unit:e.target.value as "m"|"cm"|"mm"}})}><option>m</option><option>cm</option><option>mm</option></select></label>
            <button className={button} disabled={busy||dirty||!id} onClick={()=>void run(async()=>{
              if(!window.confirm("Confirma a origem, o fuso, a unidade e a rotação desta versão para o mapa do projeto?"))return;
              const file=await backend("implant",{id,version},true);
              setMapUrl("/projects/"+projectId+"?tab=map&camada="+file.id);setStatus("Camada da implantação salva.");
            })}>Enviar versão ao mapa</button>
            {mapUrl&&<a className="underline" href={mapUrl}>Ver implantação no mapa</a>}
          </>}
        </fieldset>
      </aside>
      <div className="min-w-0 space-y-3">
        <div className="grid grid-cols-2 gap-2 rounded-lg border p-3 sm:grid-cols-5">
          <label className="sm:col-span-2">Título<input className={field} value={plant.title} maxLength={100} onChange={e=>update({...plant,title:e.target.value})}/></label>
          <label>Escala 1:<input className={field} type="number" min={1} max={100000} value={plant.scale} onChange={e=>update({...plant,scale:+e.target.value})}/></label>
          <label>Papel<select className={field} value={plant.paper} onChange={e=>update({...plant,paper:e.target.value as "A3"|"A4"})}><option>A3</option><option>A4</option></select></label>
          <label>Orientação<select className={field} value={plant.portrait?"retrato":"paisagem"} onChange={e=>update({...plant,portrait:e.target.value==="retrato"})}><option>paisagem</option><option>retrato</option></select></label>
          <label className="sm:col-span-5">Responsável no carimbo<input className={field} maxLength={80} value={plant.author} onChange={e=>update({...plant,author:e.target.value})}/></label>
        </div>
        {clipped&&<p role="alert" className="text-sm text-orange-700">Parte do desenho está fora da moldura. Ajuste a escala ou as coordenadas.</p>}
        <div className="rounded-lg bg-slate-200 p-3">
          <svg ref={svg} role="img" aria-label="Prancha da planta" width={w+"mm"} height={h+"mm"} viewBox={"0 0 "+w+" "+h} className="h-auto w-full">
            <rect width={w} height={h} fill="white"/>
            <rect x={8} y={8} width={w-16} height={h-16} fill="none" stroke="#253330" strokeWidth={.4}/>
            <clipPath id={"plant-frame-"+projectId}><rect x={8} y={8} width={w-16} height={h-50}/></clipPath>
            <g clipPath={"url(#plant-frame-"+projectId+")"} fontFamily="sans-serif">
              {plant.entities.map((e,i)=>{
                if(hidden.includes(e.layer))return null;
                const [x,y]=projected(e.a),[xx,yy]=projected(e.b),color=i===selected?"#c75a28":"#203d37";
                const stroke={stroke:color,strokeWidth:.44};
                return <g key={i} onClick={()=>select(i)}>
                  {(e.kind==="line"||e.kind==="dimension")&&<line x1={x} y1={y} x2={xx} y2={yy} {...stroke}/>}
                  {(e.kind==="rect"||e.kind==="block")&&<rect x={Math.min(x,xx)} y={Math.min(y,yy)} width={Math.abs(x-xx)} height={Math.abs(y-yy)} fill="#e0eee7" fillOpacity={.45} {...stroke}/>}
                  {e.kind==="circle"&&<circle cx={x} cy={y} r={Math.hypot(x-xx,y-yy)} fill="none" {...stroke}/>}
                  {(e.kind==="text"||e.kind==="block"||e.kind==="dimension")&&<text x={e.kind==="dimension"?(x+xx)/2:x+1} y={e.kind==="dimension"?(y+yy)/2-1:y-1} fontSize={3} fill={color}>{e.kind==="dimension"?lengthText(e,origin?.unit):e.label}</text>}
                </g>;
              })}
            </g>
            <g fontFamily="sans-serif" fill="#203d37">
              <path d={"M8 "+(h-42)+"H"+(w-8)} stroke="#253330" strokeWidth={.4}/>
              <text x={13} y={h-32} fontSize={4.1} fontWeight="bold">{plant.title}</text>
              <text x={13} y={h-23} fontSize={3.4}>{plant.paper} · 1:{plant.scale} · {origin?"SIRGAS 2000 / UTM "+origin.zone+(origin.south?"S":"N"):"Coordenadas locais"}</text>
              <text x={13} y={h-15} fontSize={3.4}>Responsável: {plant.author||"________________"} · {version?"V"+version:"rascunho"}</text>
            </g>
          </svg>
        </div>
      </div>
    </div>
  </section>;
}
