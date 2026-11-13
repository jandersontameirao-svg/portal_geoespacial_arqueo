import config from "../vite.local-visual.config";
import { download, downloadVector, projectSearchEntries, workflow } from "./previa-local-fluxos.mts";
import { rasterArtifact } from "./previa-local-raster.mts";
import { readFileSync } from "node:fs";
import { readLayout, readScale } from "./previa-layout.mts";
import { ibgeSearchEntries, readIbgeLayer } from "./previa-ibge-dados.mts";
import { atlasAngicos, atlasView, pranchaAngicos } from "./previa-raster/angicos/prancha.mts";

const arqueoA2Renderer = readFileSync(new URL("./previa-raster/composicao-a2.ts.txt", import.meta.url), "utf8");
const arqueoA2Seeds = [
  { id: "arqueo-a2-localizacao", name: "Grupo Arqueo A2 · Localização (RAIPA 11)", description: "Folha de localização com dois quadros de situação." },
  { id: "arqueo-a2-detalhe", name: "Grupo Arqueo A2 · Detalhe (Canteiro Chinelo)", description: "Folha de detalhe com três quadros de situação." },
].map(seed => ({ ...seed, config: { version: 1, signature: seed.id, paper: "A2", orientation: "landscape",
  elements: { legend: true, grid: true, north: true, frame: true, scale: true } } }));

const date = "2026-11-12T12:00:00.000Z";
const normalizeSearch = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim();
let places: ReturnType<typeof indexPlaces> | undefined;

function indexPlaces() {
  return Array.from(ibgeSearchEntries(), item => ({
    item, title: normalizeSearch(item.title), qualified: normalizeSearch(item.title + " " + (item.uf ?? "")),
    words: normalizeSearch(item.title + " " + item.detail).split(" "),
  }));
}
const user = { id: 1, name: "Usuário de demonstração", email: "demo@example.invalid", role: "admin", createdAt: date };
const responses: Record<string, unknown> = {
  "auth.me": user,
  "admin.listUsers": [user],
  "users.list": [user],
  "admin.getMetrics": { totalUsers: 1, totalProjects: 1, totalFiles: 0, recentActivity: [] },
  "admin.getActivityStats": [],
  "mfa.getStatus": { enabled: false, mfaEnabled: false },
  "backup.status": { enabled: false, configured: false },
  "gisDiagnostics.getStatus": { services: [] },
};

const demoApi = {
  name: "geoportal-local-demo",
  enforce: "pre" as const,
  load(id: string) {
    if (id.replaceAll("\\", "/").endsWith("/pages/PreviewConnections.tsx")) {
      return readFileSync(new URL("./previa-conexoes.tsx", import.meta.url), "utf8");
    }
    if (id.replaceAll("\\", "/").endsWith("/pages/PreviewMapProducts.tsx")) {
      return readFileSync(new URL("./previa-produtos.tsx", import.meta.url), "utf8");
    }
    if (id.replaceAll("\\", "/").endsWith("/components/PreviewIbgeLayers.tsx")) {
      return readFileSync(new URL("./previa-ibge.tsx", import.meta.url), "utf8");
    }
  },
  resolveId(id: string, importer?: string) {
    if (id === "./PreviewConnections.tsx" && importer) return importer.replace(/[^/\\]+$/, "PreviewConnections.tsx");
    if (id === "./PreviewMapProducts.tsx" && importer) return importer.replace(/[^/\\]+$/, "PreviewMapProducts.tsx");
    if (id === "./PreviewIbgeLayers.tsx" && importer) return importer.replace(/[^/\\]+$/, "PreviewIbgeLayers.tsx");
  },
  transform(source: string, id: string) {
    const path = id.replaceAll("\\", "/");
    if (path.endsWith("/components/CoordinateSearch.tsx")) {
      return readFileSync(new URL("./previa-busca.tsx", import.meta.url), "utf8");
    }
    if (path.endsWith("/pages/BaseLayers.tsx")) {
      return source.concat('\nimport PreviewConnections from "./PreviewConnections.tsx";')
        .replace(">Camadas Base</h1>", ">Gestão e Conexões</h1>")
        .replace("Gerencie camadas de dados geoespaciais de fontes oficiais brasileiras", "Gerencie fontes de dados geoespaciais e consulte as bases oficiais.")
        .replace('<div className="mb-6"><IbgeSourceCard />', '<PreviewConnections /><h2 className="mb-4 text-xl font-semibold">Bases oficiais</h2><div className="mb-6"><IbgeSourceCard />');
    }
    if (path.endsWith("/components/AtenaChatWidget.tsx")) {
      return source
        .replace("  const interpret = trpc.atena.interpret.useMutation();", `  const utils = trpc.useUtils();
  const [previewPlan, setPreviewPlan] = useState<{ projectId: number; text: string; summary: string } | null>(null);
  const [previewDownload, setPreviewDownload] = useState<{ projectId: number; url: string; name: string } | null>(null);
  const localAtena = async (method: "previewPlan" | "previewRun", id: number, text: string) => {
    const response = await fetch("/api/trpc/atena." + method, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json: { projectId: id, text } }),
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error?.json?.message ?? "Operação indisponível.");
    return payload.result.data.json;
  };
  const runPreviewPlan = async () => {
    if (!previewPlan || working.current || previewPlan.projectId !== currentProject.current) return;
    const action = previewPlan;
    working.current = true; setBusy(true); setPreviewPlan(null);
    try {
      const result = await localAtena("previewRun", action.projectId, action.text);
      if (result.url) {
        if (currentProject.current === action.projectId) setPreviewDownload({ ...result, projectId: action.projectId });
        return;
      }
      await Promise.all([utils.gisAnalysis.list.invalidate(), utils.files.list.invalidate(), utils.layers.list.invalidate()]);
      append(result.name + " — " + result.result.output.features.length + " feição(ões) salvas no projeto.");
    } catch (error) { append(errorText(error)); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const interpret = trpc.atena.interpret.useMutation();`)
        .replace('const invalidateContext = () => { revision.current++;', 'const invalidateContext = () => { setPreviewPlan(null); setPreviewDownload(null); revision.current++;')
        .replace('setDraft(""); setPending(null); const token', 'setDraft(""); setPending(null); setPreviewPlan(null); const token')
        .replace('      const command = classifyAtenaChatCommand(text);', `      if (/\\b(buffer|malha|a2|atlas)\\b/i.test(text) && !/^abrir atlas[.!]?$/i.test(text)) {
        if (!projectId) { await showProjects(); return; }
        const result = await localAtena("previewPlan", projectId, text);
        if (mounted.current && token === revision.current) setPreviewPlan({ projectId, text, summary: result.summary });
        return;
      }
      const command = classifyAtenaChatCommand(text);`)
        .replace('        {visiblePlan &&', `        {previewDownload && previewDownload.projectId === projectId && <Button asChild size="sm"><a href={previewDownload.url} download>{previewDownload.name}</a></Button>}
        {previewPlan?.projectId === projectId && previewPlan && <div className="space-y-2 rounded border bg-card p-3 text-sm">
          <p>{previewPlan.summary}</p>
          <Button size="sm" disabled={busy} onClick={() => void runPreviewPlan()}>Confirmar e executar</Button>
          <Button size="sm" variant="ghost" onClick={() => setPreviewPlan(null)}>Descartar plano</Button>
        </div>}
        {visiblePlan &&`);
    }
    if (path.endsWith("/pages/ProjectDetail.tsx")) {
      return source
        .replace('  const { data: members,', `  useEffect(() => {
    if (!project || project.id !== projectId || !user?.id) return;
    try {
      const key = "preview-recent-projects:" + user.id;
      const recent = JSON.parse(localStorage.getItem(key) || "[]") as number[];
      localStorage.setItem(key, JSON.stringify([projectId, ...recent.filter(id => id !== projectId)].slice(0, 100)));
    } catch { /* Navigation still works without browser storage. */ }
  }, [project?.id, projectId, user?.id]);
  const { data: members,`)
        .replace('<CardDescription>Usuários com acesso a este projeto</CardDescription>', `<CardDescription>Usuários com acesso a este projeto</CardDescription>
                    {user?.role === "admin" && <Link href={"/invitations?fromProject=" + projectId} className="mt-2 inline-block text-sm underline">Convidar novo usuário ao portal</Link>}`)
        .concat('\nimport PreviewMapProducts from "./PreviewMapProducts.tsx";')
        .replace('projectTabs.has(tab)', '(projectTabs.has(tab) || tab === "products")')
        .replace('<TabsTrigger value="history"', '{projectId === 11 && <TabsTrigger value="products">Mapas e Atlas</TabsTrigger>}<TabsTrigger value="history"')
        .replace('<TabsContent value="history"', '{projectId === 11 && <TabsContent value="products"><PreviewMapProducts /></TabsContent>}<TabsContent value="history"')
        .replace(/<TabsTrigger value="overview" className="gap-2">([\s\S]*?)<\/TabsTrigger>/, '<a className="inline-flex flex-1 items-center justify-center gap-2 rounded-md px-2 py-1 text-sm font-medium hover:bg-background focus-visible:outline-ring" href={"/?projectId=" + projectId + "&voltar=" + encodeURIComponent(activeTab)}>$1</a>')
        .replace('new Date(project.updatedAt)', 'new Date(project.updatedAt ?? project.createdAt)');
    }
    if (path.endsWith("/components/FileList.tsx")) {
      return 'import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";\n' +
        source.replace(/<Button\s+size="sm"\s+variant="outline"\s+className="flex-1"\s+onClick=\{\(\) => handleDownload\(file.id\)\}[\s\S]*?<\/Button>/, original => `{(file as { exportFormats?: string[] }).exportFormats?.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="flex-1" aria-label={"Baixar " + file.name}>
                <Download className="mr-1 size-3" /> Baixar ▾
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => handleDownload(file.id)}>Arquivo original</DropdownMenuItem>
              {Object.entries({shp:"Shapefile (.zip)", kml:"KML (.kml)", gpx:"GPX (.gpx)", geojson:"GeoJSON (.geojson)"}).map(([format, label]) =>
                (file as { exportFormats?: string[] }).exportFormats?.includes(format) &&
                <DropdownMenuItem key={format} asChild><a href={"/previa/vetores/" + projectId + "/" + file.id + "/" + format} download>{label}</a></DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : ${original}}`);
    }
    if (path.endsWith("/shared/mapPrintLayouts.ts")) {
      return source
        .replace("  A3:", "  A2: { width: 420, height: 594 },\n  A3:")
        .replace('= "vista-livre" | "tecnico" | "apresentacao";',
          '= "vista-livre" | "tecnico" | "apresentacao" | "arqueo-a2-localizacao" | "arqueo-a2-detalhe";')
        .replace(/\];(\r?\n)const isRecord/, (_, newline) =>
          arqueoA2Seeds.map(seed => "  " + JSON.stringify(seed) + ",").join(newline) + newline + "];" + newline + "const isRecord");
    }
    if (path.endsWith("/lib/mapPrintRender.ts")) {
      return source.replace(/  assertPrintableSnapshot\(snapshot\);\r?\n  const page/,
        '  assertPrintableSnapshot(snapshot);\n  if (layout.signature.startsWith("arqueo-a2-")) return buildArqueoA2(input);\n  const page') +
        arqueoA2Renderer;
    }
    if (path.endsWith("/components/MapPrintPreview.tsx")) {
      return source
        .replace('id="map-print-paper"', 'id="map-print-paper" disabled={layout.signature.startsWith("arqueo-a2-")}')
        .replace('id="map-print-orientation"', 'id="map-print-orientation" disabled={layout.signature.startsWith("arqueo-a2-")}');
    }
    if (path.endsWith("/components/ProjectGeoWorkspace.tsx")) {
      return source
        .replace(/<aside className="min-h-0[\s\S]*?<\/aside>/, panel => panel.replace(
          /<Card>([\s\S]*?<CardTitle[^>]*>)([\s\S]*?)<\/CardTitle>([\s\S]*?)<\/Card>/g,
          (_, opening, title, body) => {
            const text = title.replace(/<[^>]*>/g, "").trim();
            return `<details open className="rounded-xl border bg-card text-card-foreground shadow-sm">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">${text}</summary>
              <Card className="border-0 shadow-none">${opening}${title}</CardTitle>${body}</Card>
            </details>`;
          }
        ).replace(/<(RasterRealPixelExport|RasterIngestionPanel)\b[^>]*\/>/g, (component, name) => `
          <details open className="rounded-xl border bg-card text-card-foreground shadow-sm">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">${name === "RasterIngestionPanel" ? "Importar GeoTIFF / COG" : "Exportar recorte raster"}</summary>
            ${component}
          </details>`))
        .replace('const [gridCode, setGridCode]', 'const [gridPattern, setGridPattern] = useState("quadrada");\n  const [gridCode, setGridCode]')
        .replace('spacingMeters: Number(gridSpacing),', 'spacingMeters: Number(gridSpacing), pattern: gridPattern,')
        .replace('grid: "Malha arqueológica"', 'grid: "Malha de pontos"')
        .replace('{operation === "grid" && <>', `{operation === "grid" && <><p className="text-xs text-muted-foreground">Marque uma área em “Usar na análise”. Os pontos serão recortados pelo polígono selecionado.</p>
          <label className="grid gap-1 text-sm">Formato da malha<select className="rounded-md border bg-background p-2" value={gridPattern} onChange={event => setGridPattern(event.target.value)}>
            <option value="quadrada">Quadrada</option><option value="triangular">Triangular (linhas alternadas)</option>
          </select></label>`)
        .replace('Operação espacial</CardTitle></CardHeader>', 'Operação espacial</CardTitle><Button type="button" size="sm" variant="outline" onClick={() => setOperation("grid")}>Criar malha de pontos</Button></CardHeader>')
        .replace('<InvalidateMapOnResize />', '<InvalidateMapOnResize /><PreviewIbgeLayers projectBounds={municipalProjectBounds} />')
        .replace("  const selectedVectorFeatures = useMemo", `  const municipalProjectBounds = useMemo(() => {
    const bounds = L.latLngBounds([]);
    for (const layer of projectVectorLayers) bounds.extend(L.geoJSON(layer.layerData).getBounds());
    for (const geometry of geometries) bounds.extend(L.geoJSON(toFeature(geometry)).getBounds());
    for (const layer of rasterLayers) if (layer.bounds) bounds.extend([[layer.bounds.south, layer.bounds.west], [layer.bounds.north, layer.bounds.east]]);
    return bounds.isValid() ? bounds.pad(.15).toBBoxString() : "";
  }, [projectVectorLayers, rasterLayers, geometries]);
  const selectedVectorFeatures = useMemo`)
        .concat('\nimport PreviewIbgeLayers from "./PreviewIbgeLayers.tsx";')
        .replace('<CardContent className="space-y-3">{geometriesLoading', `<CardContent className="space-y-3">{canEdit && projectVectorLayers.length > 0 && <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">Editar simbologia</summary>
          {projectVectorLayers.map(layer => <form key={layer.id} className="mt-3 grid gap-2 border-t pt-2 text-sm" onSubmit={async event => {
            event.preventDefault();
            const form = event.currentTarget;
            const fields = new FormData(form);
            const status = form.querySelector("output")!;
            try {
              const response = await fetch("/api/trpc/layers.previewStyle", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ json: { projectId, id: layer.id, color: fields.get("color"),
                  weight: Number(fields.get("weight")), fillOpacity: Number(fields.get("opacity") ?? 18) / 100 } })
              });
              if (!response.ok || !(await response.json()).result?.data?.json?.success) throw new Error();
              await rawStyleUtils.gisAnalysis.list.invalidate({ projectId });
              status.textContent = "Salvo.";
            } catch { status.textContent = "Não foi possível salvar."; }
          }}>
            <strong>{layer.name}</strong>
            <label className="flex justify-between">Cor <input name="color" type="color" defaultValue={layer.defaultStyle?.color || "#2563eb"} /></label>
            <label className="flex justify-between">Espessura <input className="w-16 rounded border px-1" name="weight" type="number" min="1" max="8" required defaultValue={layer.defaultStyle?.weight ?? 2} /></label>
            {layer.layerData.features.some(f => /Polygon$/.test(f.geometry?.type ?? "")) &&
              <label className="flex justify-between">Preenchimento (%) <input className="w-16 rounded border px-1" name="opacity" type="number" min="0" max="100" required defaultValue={Math.round((layer.defaultStyle?.fillOpacity ?? .18) * 100)} /></label>}
            <Button type="submit" size="sm" variant="outline">Salvar estilo</Button>
            <output aria-live="polite" />
          </form>)}
        </details>}{geometriesLoading`)
        .replace("  const mapRef = useRef", "  const rawStyleUtils = trpc.useUtils();\n  const mapRef = useRef")
        .replace('import { FeatureGroup, GeoJSON,', 'import { Tooltip, FeatureGroup, GeoJSON,')
        .replace('<FeatureGroup ref={setEditableLayers}>', `{projectVectorLayers.filter(layer => layer.isVisible).flatMap(layer =>
              layer.layerData.features.flatMap(feature => {
                const props = feature.properties;
                const anchor = props?.rotulo_ibge;
                if (!Array.isArray(anchor) || !props?.nome || props.fonte !== "IBGE 2024") return [];
                return [<Marker key={props.codigo_ibge} position={[anchor[1], anchor[0]]} interactive={false}
                  icon={L.divIcon({ className: "municipio-anchor", iconSize: [0,0] })}>
                  <Tooltip permanent direction="center" className="municipio-ibge-label">{props.nome}</Tooltip>
                </Marker>];
              })
            )}
            <FeatureGroup ref={setEditableLayers}>`)
        .replace("  const [printOpen, setPrintOpen]", `  const [showA2, setShowA2] = useState(() => new URLSearchParams(window.location.search).get("folha") === "a2");
  const [printOpen, setPrintOpen]`)
        .replace("  const selectedVectorFeatures = useMemo", `  const printLayerIds = projectVectorLayers.filter(layer => layer.isVisible).map(layer => layer.id).join(",");
  const selectedVectorFeatures = useMemo`)
        .replace("onClick={() => setPrintOpen(true)}", 'onClick={() => projectId === 11 ? setShowA2(value => !value) : setPrintOpen(true)}')
        .replace("/>Imprimir mapa</Button>", '/>{projectId === 11 ? (showA2 ? "Construir mapa" : "Prévia A2") : "Imprimir mapa"}</Button>')
        .replace('<CardContent className="flex min-h-0 flex-1 p-0">', `{projectId === 11 && showA2 && (
          <section className="flex min-h-0 flex-1 flex-col overflow-auto bg-slate-100 p-3 sm:p-5" aria-label="Folha A2 de impressão">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-sm font-medium">A2 horizontal · 594 × 420 mm</span>
              {printLayerIds && <Button asChild size="sm"><a href={"/previa/prancha/11.pdf?camadas=" + printLayerIds} download>Baixar PDF</a></Button>}
            </div>
            {printLayerIds ? <img className="m-auto block h-auto max-w-full border bg-white shadow-sm" src={"/previa/prancha/11.svg?camadas=" + printLayerIds + "&estilo=" + encodeURIComponent(JSON.stringify(projectVectorLayers.map(layer => layer.defaultStyle)))} alt="Folha A2 de localização da LT Angicos–Jaguaruana II com mapas de situação e legenda" /> :
              <p className="m-auto text-sm">{layersLoading ? "Carregando camadas…" : "Ative uma camada para montar a folha."}</p>}
          </section>
        )}
        <CardContent className={projectId === 11 && showA2 ? "hidden" : "flex min-h-0 flex-1 p-0"}>`)
        .replace("  const selectedVectorFeatures = useMemo", `  const fittedVectorProject = useRef<number | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || (projectId === 11 && showA2) || !projectVectorLayers.length || fittedVectorProject.current === projectId) return;
    const bounds = L.latLngBounds([]);
    for (const layer of projectVectorLayers) bounds.extend(L.geoJSON(layer.layerData).getBounds());
    if (!bounds.isValid()) return;
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
    fittedVectorProject.current = projectId;
  }, [projectId, projectVectorLayers, showA2]);
  const selectedVectorFeatures = useMemo`);
    }
    if (path.endsWith("/pages/TechnicalMaps.tsx")) {
      return source.replace("</h1>", `</h1>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <a className="underline" href="/previa/raster/modelos-a2/localizacao-raipa-11.pdf" target="_blank" rel="noreferrer">A2 · Localização RAIPA 11</a>
          <a className="underline" href="/previa/raster/modelos-a2/detalhe-canteiro-chinelo-raipa-12.pdf" target="_blank" rel="noreferrer">A2 · Canteiro Chinelo RAIPA 12</a>
        </div>`);
    }
    if (path.endsWith("/components/Header.tsx")) {
      return 'import { useState as usePreviewNavState } from "react";\n' +
        source
          .replace(/<Link href="\/(?:technical-maps|atlas|files|invitations|gis-uploads)">[\s\S]*?<\/Link>/g, "")
          .replaceAll("Administração", "Configurações")
          .replace("Painel Administrativo", "Configurações do portal")
          .replace("<span>Camadas Base</span>", "<span>Gestão e Conexões</span>")
          .replace("Dados oficiais (FUNAI, INCRA, IPHAN)", "Cadastro de fontes e bases oficiais")
          .replace('<DropdownMenuContent align="end" className="w-64">', '<DropdownMenuContent side="right" sideOffset={10} align="start" collisionPadding={8} className="w-64 preview-sidebar-dropdown">')
          .replaceAll('<DropdownMenuContent align="start" className="w-56">', '<DropdownMenuContent side="right" sideOffset={10} align="start" collisionPadding={8} className="w-56 preview-sidebar-dropdown">')
          .replace(/  return \(\r?\n    <header/, '  const [previewNavOpen, setPreviewNavOpen] = usePreviewNavState(false);\n  return (\n    <>\n      <div className="preview-nav-rail"><a href="/" aria-label="Grupo Arqueo — Início"><img src="/grupo-arqueo-logo.webp" alt="Grupo Arqueo" /></a><button type="button" className="preview-nav-toggle" aria-label={previewNavOpen ? "Recolher menu lateral" : "Abrir menu lateral"} aria-expanded={previewNavOpen} aria-controls="preview-navigation" onClick={() => setPreviewNavOpen(open => !open)}><Layers aria-hidden="true" className="size-4" /></button></div>\n    <header id="preview-navigation" data-open={previewNavOpen} inert={!previewNavOpen}')
          .replace('</header>', '<div id="preview-home-panel" />\n    </header>\n    </>');
    }
    if (path.endsWith("/pages/Home.tsx")) {
      return 'import { createPortal as createHomePanelPortal } from "react-dom";\n' +
        source
          .replace(/\{\/\* Atividades Recentes[\s\S]*?(?=\n            <\/div>\r?\n          <\/aside>)/, "")
          .replace(/\{\/\* Ferramentas Rápidas[\s\S]*?(?=\{\/\* Painel: Meus Projetos)/, "")
          .replace('projects.slice(0, 4).map(project =>', `[...projects].sort((a,b) => {
                            const recent = previewRecentProjects(user?.id);
                            const rank = (id: number) => recent.indexOf(id) === -1 ? Infinity : recent.indexOf(id);
                            return rank(a.id) - rank(b.id);
                          }).slice(0, 4).map(project =>`)
          .replace(/const \[sidebarOpen, setSidebarOpen\] = useState\(\(\) => \{[\s\S]*?\n  \}\);/, 'const [sidebarOpen, setSidebarOpen] = useState(true);')
          .replace(/const \[sidebarCollapsed, setSidebarCollapsed\] = useState\(\(\) => \{[\s\S]*?\n  \}\);/, 'const [sidebarCollapsed, setSidebarCollapsed] = useState(false);\n  const [previewHomePanel, setPreviewHomePanel] = useState<HTMLElement | null>(null);\n  useEffect(() => setPreviewHomePanel(document.getElementById("preview-home-panel")), []);')
          .replace(/  useEffect\(\(\) => \{\r?\n    if \(!sidebarOpen\) return;[\s\S]*?\}, \[sidebarOpen\]\);/, '')
          .replace(/          (<aside\b[\s\S]*?^          <\/aside>)/m, '          {previewHomePanel && createHomePanelPortal($1, previewHomePanel)}')
          .replace("h-[calc(100dvh-64px)]", "preview-home-layout")
          .replace('<GlobeViewer projectId={contextualProjectId} />', `<GlobeViewer key={contextualProjectId ?? "global"} projectId={contextualProjectId} />
            {contextualProjectId && new URLSearchParams(search).has("voltar") && (
              <a className="absolute bottom-10 left-4 z-[600] rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow" href={"/projects/" + contextualProjectId + "?tab=" + (["members", "files", "history", "map"].find(tab => tab === new URLSearchParams(search).get("voltar")) ?? "map")}>
                ← Voltar ao projeto
              </a>
            )}`)
          .concat(`\nfunction previewRecentProjects(userId?: number): number[] {
  try { return JSON.parse(localStorage.getItem("preview-recent-projects:" + userId) || "[]"); }
  catch { return []; }
}`);
    }
    if (path.endsWith("/pages/Invitations.tsx")) {
      return source.replace('  const [isCreateDialogOpen', `  const fromProject = new URLSearchParams(window.location.search).get("fromProject");
  const [isCreateDialogOpen`)
        .replace('<h1 className="text-4xl', `{fromProject && /^\\d+$/.test(fromProject) && <div className="mb-3 text-sm">
          <a className="underline" href={"/projects/" + fromProject + "?tab=members"}>← Voltar a Membros</a>
          <p>O convite cria acesso ao portal. Depois do aceite, use Adicionar Membro para vincular o usuário ao projeto.</p>
        </div>}<h1 className="text-4xl`);
    }
    if (!path.endsWith("/components/GlobeViewer.tsx")) return;
    const badge = /(\{\/\* Info Badge \*\/\}\r?\n)      (<div[^\n]+>[\s\S]*?^      <\/div>)/m;
    if (!badge.test(source)) return;
    return source.replace(badge, "")
      .concat('\nimport PreviewIbgeLayers from "./PreviewIbgeLayers.tsx";')
      .replace('useState<"2d" | "3d">("3d")', 'useState<"2d" | "3d">("2d")')
      .concat(`\nfunction PreviewProjectExtent({ projectId }: { projectId: number }) {
  const map = useMapEvents({});
  const { data: layers } = trpc.layers.list.useQuery({ projectId }, { retry: false });
  const fitted = useRef(false);
  useEffect(() => {
    if (!layers?.length || fitted.current) return;
    const bounds = L.latLngBounds([]);
    for (const layer of layers) {
      if (layer.effectiveVisible && layer.layerType === "vector" && isWorkspaceFeatureCollection(layer.layerData)) {
        bounds.extend(L.geoJSON(layer.layerData as import("geojson").FeatureCollection).getBounds());
      }
    }
    if (!bounds.isValid()) return;
    fitted.current = true;
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
  }, [layers, map]);
  return null;
}

`)
      .replace('<BaseLayerMapOverlays />', '{projectId && <PreviewProjectExtent key={projectId} projectId={projectId} />}\n          <BaseLayerMapOverlays /><PreviewIbgeLayers /><PreviewScreenScale />')
      .replace("onNavigate={(lat, lng) =>", "onNavigate={(lat, lng, zoom = 14) =>")
      .replace("setMapZoom(14);\n            }}", "setMapZoom(zoom);\n            }}")
      .concat(`\nfunction PreviewScreenScale() {
  const [scale, setScale] = useState(0);
  const update = () => {
    const { x, y } = map.getSize().divideBy(2);
    const metres = map.distance(map.containerPointToLatLng([x-50,y]), map.containerPointToLatLng([x+50,y]));
    // A nominal CSS inch is 96 pixels. This is an on-screen estimate, separate
    // from the physical A2 scale calculated from the PDF frame in millimetres.
    setScale(Math.round(metres / (100 * 0.0254 / 96)));
  };
  const map = useMapEvents({ moveend: update, resize: update });
  useEffect(() => { update(); }, [map]);
  return scale > 0 ? <div className="pointer-events-none absolute rounded bg-white px-2 py-1 text-xs font-semibold text-slate-900 shadow"
    style={{ left: 12, bottom: 16, zIndex: 850 }} title="Escala aproximada no centro do mapa, com referência de 96 pixels por polegada">
    Escala aprox. 1:{scale.toLocaleString("pt-BR")}
  </div> : null;
}`);
  },
  transformIndexHtml() {
    return [{
      tag: "style",
      injectTo: "head",
      children: `
        .leaflet-tooltip.municipio-ibge-label {
          background: transparent; border: 0; box-shadow: none; padding: 0;
          color: #153624; font-weight: 700; font-size: 12px;
          text-shadow: 0 0 2px white, 0 0 3px white, 0 0 4px white, 1px 1px white, -1px -1px white;
        }
        #preview-navigation {
          position: fixed;
          inset: 0 auto 0 0;
          width: min(13rem, 88vw);
          overflow-y: auto;
          z-index: 1040;
        }
        #preview-navigation[data-open="false"] { display: none; }
        #preview-navigation > div:first-child {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          justify-content: flex-start;
          gap: 1rem;
          padding: 4.25rem .75rem 1rem;
          height: auto;
        }
        #preview-navigation > div > nav {
          display: flex;
          flex-direction: column;
          align-items: stretch;
        }
        #preview-navigation > div > nav button { width: 100%; }
        #preview-navigation > div > nav > a > a { display: block; }
        #preview-navigation > div > a img { display: none; }
        #preview-home-panel:not(:empty) { border-top: 1px solid var(--border); }
        #preview-navigation > div > div:last-child { flex-wrap: wrap; gap: .5rem; }
        #preview-navigation [data-tour="search"] { width: 100%; }
        #preview-navigation [data-tour="search"] input { width: 100%; }
        #preview-navigation > div > div:last-child > button[aria-haspopup="dialog"] { display: none; }
        .preview-nav-rail {
          position: fixed;
          inset: 0 auto 0 0;
          z-index: 1050;
          width: 3.5rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: .6rem;
          padding: .6rem .4rem;
          background: var(--background);
          border-right: 1px solid var(--border);
        }
        .preview-nav-rail img { width: 2.6rem; height: 2.6rem; object-fit: contain; }
        .preview-nav-rail:has(button[aria-expanded="true"]) {
          inset: .5rem auto auto .6rem;
          width: min(11.8rem, 81vw);
          flex-direction: row;
          justify-content: space-between;
          padding: 0;
          border: 0;
        }
        .preview-nav-toggle {
          display: grid;
          place-items: center;
          width: 2.25rem;
          height: 2.25rem;
          border-radius: .5rem;
          background: var(--background);
          color: var(--foreground);
          box-shadow: 0 2px 8px #0003;
        }
        #home-sidebar-toggle,
        button[aria-label="Fechar navegação do portal"] { display: none; }
        #preview-home-panel #home-navigation-sidebar {
          position: static;
          width: auto;
          max-width: none;
          border: 0;
          box-shadow: none;
          overflow: visible;
        }
        #preview-home-panel #home-navigation-sidebar > div > div:first-child { display: none; }
        .preview-sidebar-dropdown { z-index: 1100 !important; }
        [data-tour="globe-viewer"] { left: 0 !important; }
        .preview-home-layout { height: 100dvh; }
        #root { padding-left: 3.5rem; }
        @media (min-width: 768px) {
          body:has(#preview-navigation[data-open="true"]) #root { padding-left: 13rem; }
        }
        [aria-label="Seletores do mapa"] {
          left: auto;
          right: .75rem;
          top: 3.75rem;
          width: auto !important;
          flex-direction: column;
          gap: .5rem;
          padding: 0;
          border: 0;
          background: none;
          box-shadow: none;
          backdrop-filter: none;
        }
        #map-panel-trigger-projects { display: none; }
        #map-panel-trigger-basemap, #map-panel-trigger-layers {
          width: 2.25rem;
          height: 2.25rem;
          min-height: 0;
          flex: none;
          padding: 0;
          border-radius: .5rem;
          box-shadow: 0 10px 15px -3px #0002;
        }
        #map-panel-trigger-basemap[aria-expanded="false"],
        #map-panel-trigger-layers[aria-expanded="false"] {
          background: rgb(255 255 255 / .9);
          color: #171717;
        }
        #map-panel-trigger-basemap[aria-expanded="false"]:hover,
        #map-panel-trigger-layers[aria-expanded="false"]:hover { background: white; }
        #map-panel-trigger-basemap > span, #map-panel-trigger-layers > span,
        #map-panel-trigger-basemap > svg:last-child { display: none; }
        #map-panel-trigger-basemap > svg:first-child, #map-panel-trigger-layers > svg {
          display: block;
          width: 1.25rem;
          height: 1.25rem;
        }
        .preview-ibge-control {
          position: absolute;
          top: .75rem;
          right: .75rem;
          z-index: 850;
          color: #171717;
        }
        .preview-home-layout .preview-ibge-control { top: 9.25rem; }
        .preview-ibge-control > summary {
          display: grid;
          place-items: center;
          width: 2.25rem;
          height: 2.25rem;
          border-radius: .5rem;
          background: rgb(255 255 255 / .9);
          box-shadow: 0 10px 15px -3px #0002;
          cursor: pointer;
          list-style: none;
        }
        .preview-ibge-control > summary::-webkit-details-marker { display: none; }
        .preview-ibge-control > summary:hover { background: white; }
        .preview-ibge-control[open] > summary { background: #ea580c; color: white; }
        .preview-ibge-panel {
          position: absolute;
          top: 0;
          right: calc(100% + .5rem);
          width: min(12.5rem, 55vw);
        }
        div:has(> button[title="Aproximar"]):has(> button[title="Afastar"]) { top: 9.25rem; }
        .preview-home-layout:has(.preview-ibge-control) div:has(> button[title="Aproximar"]):has(> button[title="Afastar"]) { top: 12rem; }
        #global-map-panel-drawer { left: auto; right: 3.5rem; top: 3.75rem; }
      `,
    }];
  },
  configureServer(server: { middlewares: { use: (path: string, handler: any) => void } }) {
    server.middlewares.use("/previa/busca", (req: any, res: any) => {
      const url = new URL(req.url, "http://127.0.0.1");
      const query = normalizeSearch((url.searchParams.get("q") ?? "").slice(0, 120));
      if (req.method !== "GET" || query.length < 2) { res.statusCode = 400; res.end(); return; }
      try {
        places ??= indexPlaces();
        const words = query.split(" ");
        const projects = Array.from(projectSearchEntries(), item => ({
          item, title: normalizeSearch(item.title), qualified: normalizeSearch(item.detail),
          words: normalizeSearch(item.title + " " + item.detail).split(" "),
        }));
        const results = [...projects, ...places]
          .filter(entry => words.every(word => entry.words.some(candidate => candidate.startsWith(word))))
          .sort((a, b) => Number(b.title === query || b.qualified === query) - Number(a.title === query || a.qualified === query) ||
            Number(b.title.startsWith(query)) - Number(a.title.startsWith(query)));
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(results.slice(0, 12).map(entry => entry.item)));
      } catch {
        res.statusCode = 500;
        res.end();
      }
    });
    server.middlewares.use("/previa/ibge", (req: any, res: any) => {
      const url = new URL(req.url, "http://127.0.0.1");
      const bbox = url.searchParams.get("bbox");
      if (req.method !== "GET" || !bbox) { res.statusCode = 400; res.end(); return; }
      try {
        const data = readIbgeLayer(url.pathname.slice(1), bbox, url.searchParams.get("projeto"));
        if (!data) { res.statusCode = 404; res.end(); return; }
        res.setHeader("Content-Type", "application/geo+json; charset=utf-8");
        res.end(JSON.stringify(data));
      } catch {
        res.statusCode = 500;
        res.end("Base do IBGE indisponível.");
      }
    });
    server.middlewares.use("/previa/vetores", async (req: any, res: any) => {
      const path = new URL(req.url, "http://127.0.0.1").pathname;
      const match = /^\/(\d+)\/(\d+)\/(shp|kml|gpx|geojson)$/.exec(path);
      if (req.method !== "GET" || !match) { res.statusCode = 404; res.end(); return; }
      try {
        const item = await downloadVector(Number(match[1]), Number(match[2]), match[3]);
        if (!item) { res.statusCode = 422; res.end("Formato indisponível para esta camada."); return; }
        res.setHeader("Content-Type", item.type);
        res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(item.name));
        res.end(item.body);
      } catch (error) {
        console.error(error);
        res.statusCode = 500;
        res.end("Não foi possível converter esta camada.");
      }
    });
    server.middlewares.use("/previa/raster", async (req: any, res: any) => {
      try {
        const item = await rasterArtifact(new URL(req.url, "http://127.0.0.1").pathname);
        if (!item) { res.statusCode = 404; res.end(); return; }
        res.setHeader("Content-Type", item.type);
        res.setHeader("Content-Disposition", (item.type === "image/tiff" ? "attachment" : "inline") + '; filename="' + item.name + '"');
        res.end(item.body);
      } catch {
        res.statusCode = 500;
        res.end("Erro ao abrir artefato raster local.");
      }
    });
    server.middlewares.use("/previa/download", (req: any, res: any) => {
      const item = download(new URL(req.url, "http://127.0.0.1").pathname);
      if (!item) { res.statusCode = 404; res.end(); return; }
      res.setHeader("Content-Type", item.type);
      res.setHeader("Content-Disposition", (item.type === "application/pdf" ? "inline" : "attachment") + "; filename*=UTF-8''" + encodeURIComponent(item.name));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(item.body);
    });
    server.middlewares.use("/previa/prancha", async (req: any, res: any) => {
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method !== "GET" || !/^\/11\.(svg|pdf)$/.test(url.pathname)) { res.statusCode = 404; res.end(); return; }
      try {
        const pdf = url.pathname.endsWith(".pdf");
        const requested = url.searchParams.get("camadas");
        const ids = requested === null ? null : new Set(requested.split(",").map(Number));
        const layers = (await workflow("gisAnalysis.list", { projectId: 11 })).filter(layer =>
          ids ? ids.has(layer.id) : layer.isVisible);
        if (!layers.length) { res.statusCode = 422; res.end("Ative ao menos uma camada do projeto."); return; }
        const atlas = url.searchParams.get("atlas");
        const [columns, rows, overlap, grid] = atlas?.split(",").map(Number) ?? [];
        const title = url.searchParams.get("titulo")?.slice(0,85);
        const layout = url.searchParams.get("layout");
        const scale = url.searchParams.get("escala");
        const options = { layout: readLayout(layout ? JSON.parse(layout) : undefined), scale: readScale(scale ? Number(scale) : undefined) };
        const body = atlas ? (pdf ? atlasAngicos(layers, columns, rows, overlap, grid, title, options) :
          atlasView(layers, columns, rows, overlap, grid, Number(url.searchParams.get("folha") ?? 0), title, options)) :
          pranchaAngicos(layers, pdf, undefined, title, options);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", pdf ? "application/pdf" : "image/svg+xml; charset=utf-8");
        if (pdf) res.setHeader("Content-Disposition", `attachment; filename="${atlas ? "Atlas-" : ""}LT-Angicos-Jaguaruana-II-A2.pdf"`);
        res.end(body);
      } catch (error) {
        console.error(error);
        res.statusCode = 500;
        res.end("Não foi possível montar a folha A2.");
      }
    });
    server.middlewares.use("/api/trpc", async (req: any, res: any) => {
      const url = new URL(req.url, "http://127.0.0.1");
      const methods = url.pathname.slice(1).split(",");
      const batch = url.searchParams.has("batch");
      const write = req.method === "POST";
      let payload;
      try {
        if (write) {
          if (req.headers.origin && req.headers.origin !== "http://" + req.headers.host) { res.statusCode = 403; res.end(); return; }
          const chunks: Buffer[] = [];
          let length = 0;
          for await (const chunk of req) {
            length += chunk.length;
            if (length > 12_000_000) { res.statusCode = 413; res.end(); return; }
            chunks.push(chunk);
          }
          payload = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        } else {
          payload = JSON.parse(url.searchParams.get("input") || "{}");
        }
      } catch {
        res.statusCode = 400;
        res.end("Entrada inválida.");
        return;
      }
      const results = [];
      for (const [index, method] of methods.entries()) {
        try {
          const data = await workflow(method, (batch ? payload[index] : payload)?.json, write);
          if (write && data === undefined) throw Error("Operação indisponível na prévia local.");
          results.push({ result: { data: { json: data ?? responses[method] ?? [] } } });
        } catch (error: any) {
          results.push({ error: { json: { message: error.message, code: -32600, data: { code: "BAD_REQUEST", httpStatus: 400, path: method } } } });
        }
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(batch ? results : results[0]));
    });
  },
};

export default {
  ...config,
  plugins: [...(config.plugins ?? []), demoApi],
};
