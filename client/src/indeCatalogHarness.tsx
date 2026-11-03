import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { MapContainer, useMap } from "react-leaflet";
import Globe from "react-globe.gl";
import * as THREE from "three";
import { Toaster } from "sonner";
import type { AppRouter } from "../../server/routers";
import type { IndeMapImageInput } from "@shared/indeCatalog";
import { institutionalGlobeCartesian, institutionalGlobeUv, INSTITUTIONAL_GLOBE_ROTATION_Y } from "@shared/institutionalGlobeProjection";
import { trpc } from "./lib/trpc";
import GlobalMapPanels from "./components/GlobalMapPanels";
import InstitutionalMapLayers, { InstitutionalLayersProvider } from "./components/InstitutionalMapLayers";
import IndeGlobeLayers from "./components/IndeGlobeLayers";
import { useIndeCatalog } from "./components/IndeCatalogLayers";
import { DEFAULT_BASEMAP } from "./lib/basemaps";
import { TooltipProvider } from "./components/ui/tooltip";
import "leaflet/dist/leaflet.css";
import "./index.css";

/** Deliberately not App: no HTTP link, server, DB, login, cookie or token exists here. */
type Call = { index: number; path: string; type: string; input: unknown; started: number; completed?: number; cancelled?: number; response?: unknown; error?: string };
const calls: Call[] = [];
const stateHistory: unknown[] = [];
const suppressedStorageWrites: unknown[] = [];
const disposals: Array<{ kind: string; uuid: string }> = [];
const controls = { delayMs: 35, failMap: false };
const caseId = new URLSearchParams(location.search).get("case") ?? "desktop";
const stamp = "2026-11-03T01:43:00.000Z";
const memory = memoryLocation({ path: "/synthetic-inde", record: true });
Storage.prototype.setItem = function (key, value) { suppressedStorageWrites.push({ key, value }); };
const organizations = [
  { id: "orgA", label: "ORG A · MOCK", name: "Organização nacional sintética", level: "Nacional", endpoint: "https://org-a.fixture.invalid/wms", eligible: true, blocker: null },
  { id: "orgB", label: "ORG B · MOCK", name: "Organização estadual sintética com falha", level: "Estadual", endpoint: "https://org-b.fixture.invalid/wms", eligible: true, blocker: null },
  { id: "HTTPblocked", label: "HTTP · BLOQUEADO", name: "Organização municipal apenas HTTP", level: "Municipal", endpoint: "http://blocked.fixture.invalid/wms", eligible: false, blocker: "Somente HTTP; transporte inseguro bloqueado. Nenhum acesso remoto." },
];
const fixtureLayers = Array.from({ length: 6 }, (_, index) => ({ name: `synthetic:layer${index + 1}`, title: `Camada sintética ${index + 1}`, crs: ["EPSG:3857", "EPSG:4326"], bounds: { west: -75, south: -35, east: 15, north: 15 } }));
const legacyPublished = ["IBGE", "IPHAN"].map((publisher, index) => {
  const v = { id: 9100 + index, serviceId: 9200 + index, publisher, serviceType: "wms", endpoint: "https://legacy.fixture.invalid/never-request", remoteLayer: `MOCK:${publisher}`, attribution: `MOCK ${publisher}`, health: "healthy", displayCrs: "EPSG:3857", role: "primary", priority: 1, enabled: true, serviceEnabled: true, edition: "sintética", title: `${publisher} legado sintético` };
  return { logicalLayer: `MOCK ${publisher}`, selected: v, primary: v, isFallback: false, reason: null };
});
const legacySources = [{ publisher: "IPHAN", label: "IPHAN", title: "IPHAN legado sintético", status: "validated", blocker: null, edition: "sintética", sourceCrs: "EPSG:4326", supportsWms: true, supportsWfs: false, registeredTypes: ["wms"], wmsVersion: "1.1.1" }];

/** Reproducible machine-generated evaluation raster, not cartography or public artwork. */
function raster(input: IndeMapImageInput | null): string {
  const width = input?.width ?? 512, height = input?.height ?? 256;
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const global = !input || input.crs === "EPSG:4326";
  ctx.clearRect(0, 0, width, height);
  if (!input) {
    ctx.fillStyle = "#173955"; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#557760";
    [[-130,15,-60,65],[-75,-55,-35,10],[-15,-35,45,35],[5,35,140,65],[110,-45,155,-10]].forEach(([w,s,e,n]) => ctx.fillRect((w+180)/360*width,(90-n)/180*height,(e-w)/360*width,(n-s)/180*height));
    ctx.strokeStyle = "#7091a055"; ctx.lineWidth = 1;
    for(let x=0;x<=width;x+=width/12){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();}
    for(let y=0;y<=height;y+=height/6){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();}
    return canvas.toDataURL("image/png");
  }
  const bound = input.bounds;
  const project = (lon: number, lat: number) => global ? [lon,lat] : [6378137*lon*Math.PI/180,6378137*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))];
  const pixel = (lon: number, lat: number) => { const [x,y] = project(lon,lat); return [(x-bound[0])/(bound[2]-bound[0])*width, (bound[3]-y)/(bound[3]-bound[1])*height]; };
  // Orthogonal geographic quadrants provide visible non-empty coverage in every viewport.
  const quadrants = global ? ["#f9731630", "#06b6d430", "#a855f730", "#84cc1630"] : ["#f9731699", "#06b6d499", "#a855f799", "#84cc1699"];
  quadrants.forEach((color,index)=>{ctx.fillStyle=color;ctx.fillRect(index%2*width/2,Math.floor(index/2)*height/2,width/2,height/2);});
  const rect = (w:number,s:number,e:number,n:number,color:string) => {const [x,y]=pixel(w,n),[right,bottom]=pixel(e,s);ctx.fillStyle=color;ctx.fillRect(x,y,right-x,bottom-y);};
  rect(-58,-25,-38,-5,"#ff00ddee"); // Brasil: uniquely magenta geographic mark.
  rect(-5,-7,5,7,"#ffff00ee"); // Greenwich: uniquely yellow equatorial mark.
  rect(-51,-18,-45,-12,"#ffffff");
  ctx.strokeStyle="#ffffffbb";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(width,height);ctx.moveTo(width,0);ctx.lineTo(0,height);ctx.stroke();
  return canvas.toDataURL("image/png");
}
const baseGlobeImage = raster(null);
const summarize = (data: any) => data?.dataUrl ? { ...data, dataUrl: `[synthetic inline PNG ${data.dataUrl.length} chars]` } : structuredClone(data);
const MemoryTRPCLink: TRPCLink<AppRouter> = () => ({ op }) => observable(observer => {
  const call: Call = { index: calls.length + 1, path: op.path, type: op.type, input: op.input === undefined ? null : structuredClone(op.input), started: performance.now() }; calls.push(call);
  const delay = op.path === "indeCatalog.mapImage" ? controls.delayMs : 35;
  // Intentionally allow fixture work to complete after cancellation: stale renderers must not reattach.
  window.setTimeout(() => {
    try {
      let data: unknown;
      if (op.type !== "query") throw Error(`MOCK_UNEXPECTED_MUTATION:${op.path}`);
      switch (op.path) {
        case "auth.me": data = { id: 9901, name: "PAPEL SINTÉTICO SEM SESSÃO", role: "viewer", email: null }; break;
        case "ogcCatalog.listPublished": data = legacyPublished; break;
        case "institutionalCatalog.listSources": data = legacySources; break;
        case "baseLayers.catalog": case "layers.list": case "geometries.list": case "projects.list": data = []; break;
        case "indeCatalog.organizations": data = { organizations, sourceUrl: "https://inde.gov.br/CatalogoServicos", fetchedAt: stamp, listFetchedAt: stamp }; break;
        case "indeCatalog.layers": {
          const id = (op.input as {organizationId:string}).organizationId;
          if (id === "HTTPblocked" || !organizations.some(o=>o.id===id)) throw Error("MOCK_BLOCKED_OR_UNKNOWN_ORGANIZATION");
          if (id === "orgB" && caseId.includes("caps-failure")) throw Error("MOCK_CAPABILITIES_UNAVAILABLE");
          data = { organizationId: id, layers: id === "orgA" ? fixtureLayers : [{ ...fixtureLayers[0], name: "synthetic:failure", title: "Camada com falha sintética" }], version: "1.1.1", fetchedAt: stamp, capabilitySha256: "a".repeat(64), truncated: false }; break;
        }
        case "indeCatalog.mapImage": {
          const input = op.input as IndeMapImageInput;
          if (!organizations.some(o=>o.id===input.organizationId&&o.eligible)) throw Error("MOCK_BLOCKED_OR_UNKNOWN_ORGANIZATION");
          if (controls.failMap || input.organizationId === "orgB") throw Error("MOCK_MAPIMAGE_UNAVAILABLE");
          if (!["EPSG:3857","EPSG:4326"].includes(input.crs) || input.width>1024 || input.height>512 || input.width*input.height>524288) throw Error("MOCK_INVALID_IMAGE_CONTRACT");
          if (input.crs === "EPSG:4326" && (input.width!==512 || input.height!==256 || input.bounds.join()!=="-180,-90,180,90")) throw Error("MOCK_INVALID_GLOBAL_CONTRACT");
          data = { dataUrl: raster(input), crs: input.crs, bounds: [...input.bounds], attribution: "MOCK raster geográfico sintético · não é dado INDE" }; break;
        }
        default: throw Error(`MOCK_UNKNOWN_PATH:${op.path}; nenhum fallback`);
      }
      call.completed = performance.now(); call.response = summarize(data); observer.next({ result: { data } }); observer.complete();
    } catch(error) { call.completed=performance.now(); call.error=error instanceof Error?error.message:String(error); observer.error(TRPCClientError.from(new Error(call.error))); }
  }, delay);
  return () => { if (!call.completed) call.cancelled=performance.now(); };
});
const queryClient = new QueryClient({ defaultOptions: { queries: { retry:false, refetchOnWindowFocus:false, refetchOnReconnect:false, staleTime:Infinity }, mutations:{retry:false} } });
const client = trpc.createClient({ links:[MemoryTRPCLink] });
let catalogState: any = null, harnessState: any = null;
let mapHandle: any = null, globeHandle: any = null;
const observedDisposables = new WeakSet<object>();
function watchResource(resource: any, kind: string) {
  if(!resource || observedDisposables.has(resource)) return;
  observedDisposables.add(resource); resource.addEventListener("dispose",()=>disposals.push({kind,uuid:resource.uuid}));
}
function inspectScene() {
  if(!globeHandle) return null;
  const scene=globeHandle.scene(); const meshes:any[]=[]; const markers:any[]=[]; const markerObjects=new Set<object>(); const nonOverlayUuids:string[]=[];
  scene.traverse((node:any)=>{
    if(!node.name?.startsWith("institutional-globe-overlay:")) nonOverlayUuids.push(node.uuid);
    if(node.name?.startsWith("institutional-globe-overlay:")) {
      watchResource(node.geometry,"geometry");watchResource(node.material,"material");watchResource(node.material.map,"texture");
      meshes.push({name:node.name,uuid:node.uuid,type:node.geometry.type,rotationY:node.rotation.y,scale:node.scale.toArray(),visible:node.visible,texture:!!node.material.map,imageWidth:node.material.map?.image?.naturalWidth,imageHeight:node.material.map?.image?.naturalHeight});
    }
    const datum=node.__data?.__data?.syntheticMarker ? node.__data.__data : node.__data; if(datum?.syntheticMarker) { markers.push(node.uuid); markerObjects.add(datum); }
  });
  const renderer=globeHandle.renderer();
  return { overlays:meshes,markers,nonOverlayUuids,sceneChildren:scene.children.length,descendants:(()=>{let n=0;scene.traverse(()=>n++);return n;})(),canvasSize:{width:renderer.domElement.width,height:renderer.domElement.height,connected:renderer.domElement.isConnected,hostWidth:document.querySelector("[data-testid=harness-map-host]")?.clientWidth,hostHeight:document.querySelector("[data-testid=harness-map-host]")?.clientHeight},rendererType:renderer.constructor.name,webgl:!!renderer.getContext(),globeRadius:globeHandle.getGlobeRadius(),pointCount:markerObjects.size,memory:{...renderer.info.memory} };
}
function geographicPixelSamples(){
  if(!globeHandle)return null;
  const source=globeHandle.renderer().domElement;
  if(!source.width || !source.height || !source.isConnected) return null;
  const canvas=document.createElement("canvas");canvas.width=source.width;canvas.height=source.height;
  const context=canvas.getContext("2d")!;context.drawImage(source,0,0);
  return [{name:"Brasil-magenta",lon:-54,lat:-21},{name:"Greenwich-yellow",lon:-2,lat:3}].map(mark=>{
    const point=globeHandle.getCoords(mark.lat,mark.lon,0.0006);
    const projected=new THREE.Vector3(point.x,point.y,point.z).project(globeHandle.camera());
    const x=Math.round((projected.x+1)/2*canvas.width),y=Math.round((1-projected.y)/2*canvas.height);
    const inCanvas=x>=0&&y>=0&&x<canvas.width&&y<canvas.height;
    return {...mark,x,y,inCanvas,rgba:inCanvas?Array.from(context.getImageData(x,y,1,1).data):null};
  });
}
function anchoring() {
  if(!globeHandle) return null;
  const mesh=(()=>{let m:any=null;globeHandle.scene().traverse((o:any)=>{if(o.name?.startsWith("institutional-globe-overlay:")&&!m)m=o;});return m;})();
  return [[0,0],[-48,-15],[90,0],[-90,0],[0,60]].map(([lon,lat])=>{
    const expected=institutionalGlobeCartesian(lon,lat,globeHandle.getGlobeRadius());
    const coords=globeHandle.getCoords(lat,lon,0);const uv=institutionalGlobeUv(lon,lat);
    const theta=(1-uv.v)*Math.PI,phi=uv.u*2*Math.PI;
    const sphere=new THREE.Vector3(-Math.cos(phi)*Math.sin(theta),Math.cos(theta),Math.sin(phi)*Math.sin(theta)).applyAxisAngle(new THREE.Vector3(0,1,0),INSTITUTIONAL_GLOBE_ROTATION_Y).multiplyScalar(globeHandle.getGlobeRadius());
    if(mesh)mesh.updateMatrixWorld(true);
    const meshPoint=mesh ? new THREE.Vector3(-Math.cos(phi)*Math.sin(theta),Math.cos(theta),Math.sin(phi)*Math.sin(theta)).applyMatrix4(mesh.matrixWorld).normalize().multiplyScalar(globeHandle.getGlobeRadius()) : null;
    const distance=(v:any)=>new THREE.Vector3(v.x,v.y,v.z).distanceTo(new THREE.Vector3(expected.x,expected.y,expected.z));
    return {lon,lat,uv,expected,globeCoords:coords,helperError:distance(coords),sphereMatrixError:distance(sphere),actualMeshMatrixError:meshPoint?distance(meshPoint):null};
  });
}
function MapProbe() {
  const map=useMap();
  useEffect(()=>{mapHandle=map;map.invalidateSize();return()=>{if(mapHandle===map)mapHandle=null;};},[map]);
  return null;
}
function CatalogProbe(){
  const state=useIndeCatalog();catalogState={selected:state.selected,statuses:state.statuses,viewMode:state.viewMode,identity:state.identity,notice:state.notice};
  useEffect(()=>{stateHistory.push({at:performance.now(),...structuredClone(catalogState)});},[state.selected,state.statuses,state.viewMode]);
  return null;
}
const markerData=[{lat:-15,lng:-48,syntheticMarker:true},{lat:0,lng:0,syntheticMarker:true},{lat:20,lng:60,syntheticMarker:true}];
function Harness(){
  const [mode,setMode]=useState<"2d"|"3d">("2d");const [basemapId,setBasemapId]=useState(DEFAULT_BASEMAP.id);const [enabled,setEnabled]=useState<number[]>([]);const [ready,setReady]=useState(false);const [requests2D,setRequests2D]=useState(0);
  const [readyRevision,setReadyRevision]=useState(0);
  const globeRef=useRef<any>(null);const host=useRef<HTMLDivElement>(null);const [size,setSize]=useState({width:1057,height:620});
  useEffect(()=>{const el=host.current!;const observer=new ResizeObserver(()=>setSize({width:el.clientWidth,height:el.clientHeight}));observer.observe(el);setSize({width:el.clientWidth,height:el.clientHeight});return()=>observer.disconnect();},[]);
  harnessState={mode,basemapId,requests2D,ready};
  return <main className="h-[100dvh] overflow-hidden bg-slate-100 text-foreground" data-testid="inde-real-harness">
    <header className="relative z-[2000] flex h-[72px] items-center justify-between gap-2 border-b border-amber-300 bg-amber-50 px-3 text-amber-950">
      <div className="min-w-0"><h1 className="text-xs font-bold">INDE · HARNESS OFFLINE · SINTÉTICO</h1><p className="text-[10px]">UI real · MemoryTRPCLink · sem OAuth/servidor/DB</p></div>
      <div className="flex shrink-0 gap-1"><button className="rounded border px-2 py-1 text-xs" data-testid="harness-2d" aria-pressed={mode==="2d"} onClick={()=>{setReady(false);setMode("2d");}}>2D</button><button className="rounded border px-2 py-1 text-xs" data-testid="harness-3d" aria-pressed={mode==="3d"} onClick={()=>setMode("3d")}>3D</button></div>
    </header>
    <InstitutionalLayersProvider viewMode={mode}>
      <CatalogProbe />
      <div ref={host} className="relative h-[calc(100dvh-72px)] w-full" data-testid="harness-map-host">
        {mode==="2d" ? <MapContainer center={[-15,-48]} zoom={4} zoomControl={false} attributionControl={false} style={{position:"absolute",inset:0,width:"100%",height:"100%",background:"#cbd5e1"}}><InstitutionalMapLayers/><MapProbe/></MapContainer> : <><Globe ref={globeRef} width={size.width} height={size.height} globeImageUrl={baseGlobeImage} backgroundColor="#07111c" showAtmosphere={false} animateIn={false} rendererConfig={{antialias:true,preserveDrawingBuffer:true}} pointsData={markerData} pointsTransitionDuration={0} pointLat="lat" pointLng="lng" pointColor={()=>"#fff5a0"} pointAltitude={0.015} pointRadius={0.7} onGlobeReady={()=>{globeHandle=globeRef.current;globeHandle.pointOfView({lat:-15,lng:-48,altitude:1.8},0);globeHandle.controls().autoRotate=false;globeHandle.controls().enableDamping=false;const rw=host.current!.clientWidth,rh=host.current!.clientHeight;globeHandle.renderer().setSize(rw,rh);globeHandle.camera().aspect=rw/rh;globeHandle.camera().updateProjectionMatrix();setReady(true);setReadyRevision(n=>n+1);}}/><IndeGlobeLayers globeRef={globeRef} readyRevision={ready?readyRevision:0}/></>}
        <GlobalMapPanels enabledIds={enabled} onChange={setEnabled} basemapId={basemapId} onBasemapChange={setBasemapId} viewMode={mode} onRequest2D={()=>{setRequests2D(n=>n+1);setReady(false);setMode("2d");}} selectionReady selectionPending={false} onRetrySelection={()=>{}} />
        <p className="pointer-events-none absolute bottom-2 left-2 z-[800] max-w-[90%] rounded bg-white/90 px-2 py-1 text-[10px] text-slate-900">Raster artificial: magenta Brasil / amarelo Greenwich. Sem WMS externo ou nuvens.</p>
      </div>
    </InstitutionalLayersProvider><Toaster/>
  </main>;
}
Object.defineProperty(window,"__INDE_HARNESS__",{get:()=>({caseId,calls:structuredClone(calls),state:structuredClone(catalogState),harness:structuredClone(harnessState),stateHistory:structuredClone(stateHistory),scene:inspectScene(),anchoring:anchoring(),geographicPixels:geographicPixelSamples(),disposals:structuredClone(disposals),map:mapHandle?{center:mapHandle.getCenter(),zoom:mapHandle.getZoom(),bounds:mapHandle.getBounds().toBBoxString(),imageOverlays:Object.values(mapHandle._layers).filter((l:any)=>l._image).length}:null,suppressedStorageWrites:structuredClone(suppressedStorageWrites),transport:"MemoryTRPCLink — NO HTTP",authentication:"NO OAuth or real tRPC server verified; no session/cookie/token; synthetic auth.me only",synthetic:true,baseGlobeImage:{scheme:"data:image/png;base64",width:512,height:256},navigationHistory:[...memory.history]})});
Object.defineProperty(window,"__INDE_ACTIONS__",{value:{pan:()=>mapHandle?.panBy([90,30],{animate:false}),delay:(ms:number)=>{controls.delayMs=ms;},failMap:(value:boolean)=>{controls.failMap=value;},lookAt:(lat:number,lng:number)=>globeHandle?.pointOfView({lat,lng,altitude:1.8},0)}});
createRoot(document.getElementById("root")!).render(<Router hook={memory.hook} searchHook={memory.searchHook}><trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><TooltipProvider><Harness/></TooltipProvider></QueryClientProvider></trpc.Provider></Router>);
