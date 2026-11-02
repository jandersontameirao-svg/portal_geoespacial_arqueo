import { useMemo, useRef, useState } from "react";
import L from "leaflet";
import { FeatureGroup, MapContainer, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import "leaflet-draw";
import "@/lib/leafletDefaultMarker";
import LeafletDrawControl from "@/components/LeafletDrawControl";
import ThematicLayerTree, { moveThematicItem, type ThematicLayerItem } from "@/components/ThematicLayerTree";
import { DEFAULT_BASEMAP } from "@/lib/basemaps";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, CheckCircle2, FileUp, Layers3, Map, Ruler, ShieldCheck, UploadCloud } from "lucide-react";

const demoProjects = [
  { code: "DEMO-ARQ-001", name: "Diagnóstico Arqueológico — Área Norte", status: "Em análise", color: "bg-amber-500" },
  { code: "DEMO-ARQ-002", name: "Levantamento Geoespacial — Corredor Leste", status: "Mapeamento", color: "bg-blue-500" },
  { code: "DEMO-ARQ-003", name: "Atlas de Referência — SIRGAS 2000", status: "Revisão", color: "bg-emerald-500" },
];

const demoThematicItems: ThematicLayerItem[] = [
  { id: "drawing-demo-aoi", group: "own", kind: "drawing", name: "Área de influência demonstrativa", description: "Polígono local; não representa projeto corporativo.", visible: true, analyzable: true, color: "#2563eb", status: "local" },
  { id: "vector-demo-kml", group: "own", kind: "vector", name: "Traçado KML demonstrativo", description: "Camada sintética para validar legenda e seleção independente.", visible: true, analyzable: true, color: "#0f766e", status: "local", sourceLabel: "demo.kml" },
  { id: "raster-demo-cog", group: "own", kind: "raster", name: "Raster demonstrativo", description: "Apenas sobreposição visual de teste; não é COG corporativo processado.", visible: true, color: "#9333ea", status: "local" },
  { id: "ogc-demo-published", group: "base", kind: "wms", name: "WMS corporativo — demonstração", description: "Descritor local da árvore; não chama endpoint OGC nesta prévia.", visible: false, color: "#b45309", status: "healthy", sourceLabel: "fonte sintética" },
  { id: "result-demo-buffer", group: "result", kind: "analysis", name: "Buffer métrico demonstrativo", description: "Resultado sintético para testar a ordem visual e a legenda.", visible: true, color: "#1d4ed8", status: "local" },
];

export default function ConstructionPreview() {
  const [featureGroup, setFeatureGroup] = useState<L.FeatureGroup | null>(null);
  const [featureCount, setFeatureCount] = useState(0);
  const [rasterEnabled, setRasterEnabled] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [thematicItems, setThematicItems] = useState(demoThematicItems);
  const [thematicOrder, setThematicOrder] = useState(() => demoThematicItems.map((item) => item.id));
  const sequence = useRef(0);
  const draw = useMemo<L.Control.DrawOptions>(() => ({ marker: {}, polygon: {}, polyline: {}, rectangle: {}, circle: false, circlemarker: false }), []);
  const onCreated = () => { sequence.current += 1; setFeatureCount(sequence.current); };
  const clearDrawings = () => { featureGroup?.clearLayers(); sequence.current = 0; setFeatureCount(0); };

  return <main className="min-h-screen bg-slate-950 text-slate-100">
    <header className="sticky top-0 z-30 border-b border-amber-400/30 bg-slate-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <img src="/grupo-arqueo-logo.webp" alt="Grupo Arqueo" className="h-10 w-10 object-contain" />
          <div className="min-w-0"><p className="truncate font-semibold text-white">Portal Geoespacial — Construção</p><p className="text-xs text-slate-400">Grupo Arqueo · ambiente público isolado</p></div>
        </div>
        <Badge className="shrink-0 border border-amber-300/50 bg-amber-400/15 text-amber-200 hover:bg-amber-400/15"><AlertTriangle className="mr-1 h-3.5 w-3.5" />SEM LOGIN · DADOS SINTÉTICOS</Badge>
      </div>
    </header>

    <section className="border-b border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/40">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-300">Prévia funcional</p>
        <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div><h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Construção e testes sem autenticação</h1><p className="mt-2 max-w-3xl text-slate-300">Use esta página para validar componentes, desenho Leaflet, upload simulado, navegação e comportamento visual. Nenhuma ação é enviada ao Portal, banco, OAuth, storage, auditoria ou dados corporativos.</p></div>
          <div className="flex items-center gap-2 text-sm text-emerald-300"><ShieldCheck className="h-5 w-5" />Isolamento ativo</div>
        </div>
      </div>
    </section>

    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
      <aside className="space-y-4">
        <Card className="border-slate-700 bg-slate-900 text-slate-100"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Layers3 className="h-4 w-4 text-amber-400" />Projetos demonstrativos</CardTitle><CardDescription className="text-slate-400">Mock local; não representa projetos reais.</CardDescription></CardHeader><CardContent className="space-y-2">{demoProjects.map((project) => <button key={project.code} className="w-full rounded-lg border border-slate-700 bg-slate-800/70 p-3 text-left transition hover:border-amber-400/50 hover:bg-slate-800"><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{project.name}</span><span className={`h-2 w-2 shrink-0 rounded-full ${project.color}`} /></div><p className="mt-1 text-xs text-slate-400">{project.code} · {project.status}</p></button>)}</CardContent></Card>
        <Card className="border-slate-700 bg-slate-900 text-slate-100"><CardHeader className="pb-3"><CardTitle className="text-base">Árvore temática real — dados de demonstração</CardTitle><CardDescription className="text-slate-400">Mesmo componente usado na aba de projeto; estados ficam apenas nesta página.</CardDescription></CardHeader><CardContent><ThematicLayerTree items={thematicItems} order={thematicOrder} onVisibilityChange={(item, visible) => setThematicItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, visible } : entry))} onAnalysisSelectionChange={(item, selectedForAnalysis) => setThematicItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, selectedForAnalysis } : entry))} onMove={(item, direction) => setThematicOrder((current) => moveThematicItem(current, item.id, direction))} /></CardContent></Card>
        <Card className="border-slate-700 bg-slate-900 text-slate-100"><CardHeader className="pb-2"><CardTitle className="text-base">Checklist da prévia</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-slate-300"><p className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />Sem OAuth e sem API tRPC.</p><p className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />Desenhos ficam apenas nesta aba.</p><p className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />Arquivos não são enviados.</p></CardContent></Card>
      </aside>

      <section className="space-y-4">
        <Card className="overflow-hidden border-slate-700 bg-slate-900 text-slate-100"><CardHeader className="border-b border-slate-800 bg-slate-900/80"><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><Map className="h-5 w-5 text-amber-400" />Mapa de construção</CardTitle><CardDescription className="text-slate-400">Base Esri pública; ferramenta de desenho opera somente em memória.</CardDescription></div><Badge variant="outline" className="border-slate-600 text-slate-200"><Ruler className="mr-1 h-3.5 w-3.5" />{featureCount} feição(ões) locais</Badge></div></CardHeader><CardContent className="p-0"><MapContainer center={[-15.7801, -47.9292]} zoom={6} style={{ height: "590px", width: "100%" }}><TileLayer attribution={DEFAULT_BASEMAP.attribution} url={DEFAULT_BASEMAP.url!} />{rasterEnabled && <TileLayer opacity={0.38} attribution="Camada raster sintética — demonstrativa" url={DEFAULT_BASEMAP.url!} />}<FeatureGroup ref={setFeatureGroup}>{featureGroup && <LeafletDrawControl featureGroup={featureGroup} draw={draw} onCreated={onCreated} onEdited={() => undefined} onDeleted={() => setFeatureCount(Math.max(0, featureCount - 1))} />}</FeatureGroup></MapContainer></CardContent></Card>
        <div className="flex flex-wrap gap-2"><Button variant="outline" className="border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800 hover:text-white" onClick={() => setRasterEnabled((current) => !current)}>{rasterEnabled ? "Ocultar raster demonstrativo" : "Exibir raster demonstrativo"}</Button><Button variant="outline" className="border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800 hover:text-white" onClick={clearDrawings}>Limpar desenhos locais</Button></div>
      </section>

      <aside className="space-y-4">
        <Card className="border-slate-700 bg-slate-900 text-slate-100"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><UploadCloud className="h-4 w-4 text-amber-400" />Upload simulado</CardTitle><CardDescription className="text-slate-400">Valida somente o seletor visual.</CardDescription></CardHeader><CardContent className="space-y-3"><div className="space-y-1"><Label htmlFor="construction-file">Arquivo de teste</Label><Input id="construction-file" type="file" accept=".tif,.tiff,.kml,.kmz,.geojson,.pdf" className="border-slate-600 bg-slate-800" onChange={(event) => setSelectedFile(event.target.files?.[0]?.name || null)} /></div>{selectedFile ? <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200"><FileUp className="mr-2 inline h-4 w-4" />{selectedFile}<p className="mt-1 text-xs text-emerald-300/80">Selecionado localmente. Nenhum byte foi enviado.</p></div> : <p className="text-sm text-slate-400">Selecione um arquivo para testar a interface.</p>}<Button className="w-full bg-amber-500 text-slate-950 hover:bg-amber-400" onClick={() => setSelectedFile(null)} disabled={!selectedFile}>Limpar seleção</Button></CardContent></Card>
        <Card className="border-amber-400/30 bg-amber-400/10 text-amber-50"><CardHeader className="pb-2"><CardTitle className="text-base">Limite de segurança</CardTitle></CardHeader><CardContent className="text-sm text-amber-100/90">Não use dados de projeto, documentos reais, credenciais ou arquivos confidenciais nesta prévia. O ambiente correto para persistência e permissões continua sendo a homologação autenticada.</CardContent></Card>
      </aside>
    </div>
  </main>;
}
