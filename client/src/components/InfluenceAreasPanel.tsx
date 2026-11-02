import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, GeoJSON } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type Outputs = inferRouterOutputs<AppRouter>;
type Preview = Outputs["influence"]["preview"];
type Analysis = Outputs["official"]["analyze"];
export default function InfluenceAreasPanel({ projectId }: { projectId: number | null }) {
  return projectId && Number.isSafeInteger(projectId) && projectId > 0 ? <InfluenceWorkspace key={projectId} projectId={projectId} /> : <p>Selecione um projeto autorizado para calcular áreas de influência.</p>;
}
function InfluenceWorkspace({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const layers = trpc.atena.layers.useQuery({ projectId }, { retry: false });
  const access = trpc.prospect.sources.useQuery({ projectId }, { retry: false });
  const catalog = trpc.official.catalog.useQuery(undefined, { retry: false });
  const [source, setSource] = useState(""); const [target, setTarget] = useState("");
  const [width, setWidth] = useState(35); const [distance, setDistance] = useState(250);
  const [origin, setOrigin] = useState<"ada" | "source">("ada");
  const [result, setResult] = useState<Preview | null>(null);
  const [officialId, setOfficialId] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [touches, setTouches] = useState<string[]>([]); const [includeAii, setIncludeAii] = useState(true);
  const [reviewMunicipalities, setReviewMunicipalities] = useState<Array<{ code: string; name: string }>>([]);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [failure, setFailure] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const preview = trpc.influence.preview.useMutation();
  const save = trpc.influence.save.useMutation();
  const officialAnalysis = trpc.official.analyze.useMutation();
  const parameters = { projectId, sourceLayerId: Number(source), halfWidthM: width, distanceM: distance, aidOrigin: origin, includeTouchCodes: touches };
  const parameterKey = JSON.stringify(parameters);
  const currentKey = useRef(parameterKey); currentKey.current = parameterKey;
  const currentOfficial = useRef(officialId); currentOfficial.current = officialId;
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const valid = source !== "" && layers.data?.some(layer => layer.id === Number(source)) && Number.isFinite(width) && width >= 1 && width <= 500 && Number.isFinite(distance) && distance >= 1 && distance <= 10000;
  const canWrite = access.isSuccess && access.data.canWrite;
  const locked = preview.isPending || save.isPending;
  const usable = result && previewKey === parameterKey ? result : null;
  const bounds = useMemo(() => {
    if (!usable) return null;
    try { const value = L.geoJSON(usable.featureCollection).getBounds(); return value.isValid() ? value : null; }
    catch { return null; }
  }, [usable]);
  const invalidate = () => { setResult(null); setPreviewKey(null); setAnalysis(null); setMessage(null); setFailure(null); };
  useEffect(() => { invalidate(); }, [parameterKey]);
  useEffect(() => { setAnalysis(null); }, [officialId]);
  const calculate = async () => {
    if (!valid || locked) return;
    invalidate(); const key = parameterKey;
    try {
      const response = await preview.mutateAsync(parameters);
      if (!mounted.current || key !== currentKey.current) return;
      setResult(response); setPreviewKey(key); setRequestId(crypto.randomUUID());
      setReviewMunicipalities(previous => {
        const rows = [...previous, ...(response.aii?.review ?? [])];
        return rows.filter((row, index) => rows.findIndex(candidate => candidate.code === row.code) === index);
      });
      setMessage("Prévia calculada. Nenhuma nova versão foi salva.");
    } catch (error) { if (mounted.current) setFailure(error instanceof Error ? error.message : "Falha ao calcular áreas."); }
  };
  const exportFile = () => {
    if (!usable) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(usable.featureCollection, null, 2)], { type: "application/geo+json" }));
    const link = document.createElement("a"); link.href = url; link.download = `areas-influencia-${projectId}.geojson`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const saving = useRef(false);
  const confirmSave = async () => {
    if (!usable || !target || target === source || !layers.data?.some(layer => layer.id === Number(target)) || !canWrite || locked || saving.current || (includeAii && (!usable.aii || usable.aiiBlocked))) return;
    if (!window.confirm(`Salvar nova versão ${includeAii ? "ADA/AID/AII" : "somente ADA/AID"} na camada de destino, sem substituir os insumos? A fonte remota será revalidada no servidor; a gravação pode ser bloqueada.`)) return;
    saving.current = true; setFailure(null);
    try {
      const response = await save.mutateAsync({ ...usable.parameters, targetLayerId: Number(target), includeAii, requestId });
      void utils.geometries.list.invalidate({ projectId }); void utils.atena.layers.invalidate({ projectId }); void utils.prospect.sources.invalidate({ projectId });
      if (mounted.current) { setResult(null); setPreviewKey(null); setAnalysis(null); setMessage(`${response.count} geometria(s) ${response.replayed ? "já gravada(s); reenvio ignorado" : "salva(s)"}.`); }
    } catch (error) { if (mounted.current) setFailure(`Gravação não confirmada: ${error instanceof Error ? error.message : "resposta indisponível"}. Verifique o histórico antes de alterar e reenviar.`); }
    finally { saving.current = false; }
  };
  const analyze = async () => {
    const ada = usable?.featureCollection.features.find(feature => feature.properties?.role === "ADA");
    const allowed = !catalog.isError && catalog.data?.some(row => row.id === officialId && row.queryable && row.connectionMode === "remote" && row.geometryMode === "vector");
    if (!ada || !allowed || officialAnalysis.isPending) return;
    setAnalysis(null); setFailure(null); const key = parameterKey; const id = officialId;
    try {
      const response = await officialAnalysis.mutateAsync({ projectId, institutionId: id, ada: { ...ada, properties: ada.properties ?? {} } });
      if (mounted.current && key === currentKey.current && id === currentOfficial.current) setAnalysis(response);
    } catch (error) { if (mounted.current && key === currentKey.current && id === currentOfficial.current) setFailure(`Fonte oficial não confirmou a análise: ${error instanceof Error ? error.message : "indisponível"}. Nenhum dado local foi usado como fallback.`); }
  };
  return <section className="space-y-3 rounded-lg border p-3 text-xs" aria-label="Ciclo de áreas de influência">
    <h3 className="font-semibold">Calcular, visualizar e salvar ADA/AID/AII</h3>
    <p>AII oficial: municípios inteiros IBGE 2025, sem recorte ou buffer, somente com consulta e proveniência confirmadas. Se a fonte remota estiver bloqueada, a AII continuará bloqueada; não há fallback silencioso para cache SP.</p>
    {[layers, access, catalog].map((query, index) => query.isError && <p key={index} role="alert" className="text-destructive">Falha em {["camadas", "permissões", "catálogo oficial"][index]}: {query.error?.message}</p>)}
    {access.isSuccess && !canWrite && <p role="note" className="text-amber-800">Somente leitura: cálculo e exportação de prévia disponíveis; salvamento bloqueado.</p>}
    {message && <p role="status">{message}</p>}{failure && <p role="alert" className="text-destructive">{failure}</p>}
    <fieldset disabled={locked} className="space-y-3"><legend className="sr-only">Parâmetros de áreas de influência</legend>
      <label className="block">Camada de origem<select className="mt-1 w-full rounded border bg-background p-2" value={source} onChange={event => { setSource(event.target.value); setTarget(""); setTouches([]); setReviewMunicipalities([]); invalidate(); }}><option value="">Selecione…</option>{layers.data?.map(layer => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-2"><label>ADA: largura/lado (m)<Input type="number" min={1} max={500} value={width} onChange={event => { setWidth(Number(event.target.value)); invalidate(); setTouches([]); setReviewMunicipalities([]); }} /></label><label>AID: distância (m)<Input type="number" min={1} max={10000} value={distance} onChange={event => { setDistance(Number(event.target.value)); invalidate(); }} /></label></div>
      <label className="block">Origem da AID<select className="w-full rounded border bg-background p-2" value={origin} onChange={event => { setOrigin(event.target.value === "source" ? "source" : "ada"); invalidate(); }}><option value="ada">ADA</option><option value="source">Eixo/polígono original</option></select></label>
      {reviewMunicipalities.length > 0 && <fieldset className="space-y-1 rounded border p-2"><legend>Revisão dos contatos de fronteira</legend><p>Alterar a seleção exige recalcular a prévia antes de salvar.</p>{reviewMunicipalities.map(row => <label key={row.code} className="block"><input type="checkbox" checked={touches.includes(row.code)} onChange={event => { setTouches(previous => event.target.checked ? [...previous.filter(code => code !== row.code), row.code] : previous.filter(code => code !== row.code)); invalidate(); }} /> Incluir após revisão: {row.name} ({row.code})</label>)}</fieldset>}
      <Button type="button" className="w-full" disabled={!valid || layers.isError} onClick={() => void calculate()}>{preview.isPending ? "Calculando…" : "Calcular prévia"}</Button>
    </fieldset>
    {usable && <>
      {usable.notes.length > 0 && <ul className="list-disc pl-4">{usable.notes.map(note => <li key={note}>{note}</li>)}</ul>}
      {usable.aiiBlocked && <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">AII bloqueada: {usable.aiiBlocked}</p>}
      {usable.aii && <div><b>AII: {usable.aii.municipalities.length} município(s), IBGE {usable.aii.year} · edição {usable.aii.edition}</b><p className="break-words text-muted-foreground">Consulta: {usable.aii.queriedAt} · Proveniência: {usable.aii.provenance.institutionId} · {usable.aii.provenance.endpoint} · cobertura {usable.aii.coverage}</p><ul>{usable.aii.municipalities.map(row => <li key={row.code}>{row.code} — {row.name}</li>)}</ul></div>}
      {bounds ? <MapContainer key={requestId} bounds={bounds} boundsOptions={{ padding: [12, 12] }} style={{ height: 260, width: "100%" }} scrollWheelZoom={false}><GeoJSON data={usable.featureCollection} style={feature => ({ color: feature?.properties?.role === "ADA" ? "#f97316" : feature?.properties?.role === "AID" ? "#2563eb" : "#16a34a", fillOpacity: 0.2, fillRule: "evenodd" })} onEachFeature={(feature, layer) => { const content = document.createElement("div"); content.textContent = String(feature.properties?.municipalityName ?? feature.properties?.name ?? feature.properties?.role ?? "Área"); layer.bindPopup(content); }} /></MapContainer> : <p role="alert">Prévia sem envelope cartográfico válido; nenhum mapa foi desenhado.</p>}
      <p className="text-muted-foreground">Prévia vetorial sem mapa-base externo. Laranja: ADA · azul: AID · verde: AII.</p>
      <label className="block">Intersectar a ADA com fonte vetorial remota<select className="w-full rounded border bg-background p-2" value={officialId} onChange={event => { setOfficialId(event.target.value); setAnalysis(null); }}><option value="">Escolha uma conexão autorizada…</option>{!catalog.isError && catalog.data?.filter(row => row.queryable && row.connectionMode === "remote" && row.geometryMode === "vector").map(row => <option key={row.id} value={row.id}>{row.institution}</option>)}</select></label>
      <Button type="button" variant="outline" disabled={!officialId || catalog.isError || officialAnalysis.isPending || locked} onClick={() => void analyze()}>{officialAnalysis.isPending ? "Consultando fonte oficial…" : "Consultar fonte e calcular interseção"}</Button>
      {analysis && <div className="rounded border p-2"><b>{analysis.totalIntersected} feição(ões) oficiais interceptadas</b><p className="break-words">Fonte: {analysis.provenance.endpoint} · edição {analysis.provenance.edition} · consulta {analysis.provenance.queriedAt}</p>{analysis.overlaps.map((overlap, index) => <details key={index}><summary>{String(overlap.id ?? index + 1)} · {overlap.areaM2.toFixed(2)} m² de interseção poligonal</summary><pre className="max-h-32 overflow-auto whitespace-pre-wrap">{JSON.stringify(overlap.attributes, null, 2)}</pre></details>)}</div>}
      <Button type="button" variant="outline" className="w-full" onClick={exportFile}>Exportar GeoJSON com geometrias e atributos</Button>
      <label className="block">Camada de destino<select className="w-full rounded border bg-background p-2" value={target} disabled={locked} onChange={event => { setTarget(event.target.value); setRequestId(crypto.randomUUID()); }}><option value="">Selecione uma camada distinta…</option>{layers.data?.filter(layer => String(layer.id) !== source).map(layer => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select></label>
      <label className="flex gap-2"><input type="checkbox" checked={includeAii} disabled={locked} onChange={event => { setIncludeAii(event.target.checked); setRequestId(crypto.randomUUID()); }} /> Incluir AII no salvamento (exige consulta oficial validada)</label>
      {includeAii && usable.aiiBlocked && <p className="text-amber-800">Para salvar somente ADA/AID, desmarque explicitamente a inclusão da AII. O bloqueio da AII não será ocultado.</p>}
      <Button type="button" className="w-full" disabled={!target || target === source || !canWrite || locked || (includeAii && (!usable.aii || Boolean(usable.aiiBlocked)))} onClick={() => void confirmSave()}>{save.isPending ? "Salvando…" : "Confirmar e salvar nova versão"}</Button>
    </>}
  </section>;
}
