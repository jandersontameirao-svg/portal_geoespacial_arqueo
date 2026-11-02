import { useEffect, useMemo, useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { Download, Loader2, WandSparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { validAtenaCoordinates } from "@/lib/atenaChatCommands";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type Preview = inferRouterOutputs<AppRouter>["prospect"]["preview"];
type Unit = Preview["units"][number];
export default function ProspectionGenerator({ projectId }: { projectId: number | null }) {
  return projectId && Number.isSafeInteger(projectId) && projectId > 0 ? <ProspectionWorkspace key={projectId} projectId={projectId} /> : <p>Selecione um projeto autorizado para gerar unidades.</p>;
}
function ProspectionWorkspace({ projectId }: { projectId: number }) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const sources = trpc.prospect.sources.useQuery({ projectId }, { retry: false });
  const utils = trpc.useUtils();
  const [sourceKind, setSourceKind] = useState<"geometry" | "layer">("geometry");
  const [sourceId, setSourceId] = useState("");
  const [spacing, setSpacing] = useState("30");
  const [dx, setDx] = useState("30"); const [dy, setDy] = useState("30");
  const [offset, setOffset] = useState("15"); const [maxUnits, setMaxUnits] = useState("5000");
  const [prefix, setPrefix] = useState("UP"); const [zigzag, setZigzag] = useState(true);
  const [units, setUnits] = useState<Unit[]>([]);
  const [manual, setManual] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [metadata, setMetadata] = useState<Pick<Preview, "parameters" | "sourceGeometryIds"> | null>(null);
  const [message, setMessage] = useState<string | null>(null); const [failure, setFailure] = useState<string | null>(null);
  const preview = trpc.prospect.preview.useMutation();
  const save = trpc.prospect.save.useMutation();
  const locked = preview.isPending || save.isPending;
  const canWrite = sources.isSuccess && sources.data.canWrite;
  const parameterKey = JSON.stringify([projectId, sourceKind, sourceId, spacing, dx, dy, offset, maxUnits, prefix, zigzag]);
  const currentKey = useRef(parameterKey); currentKey.current = parameterKey;
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const invalidate = () => { setUnits([]); setMetadata(null); setPreviewKey(null); setManual(false); setMessage(null); setFailure(null); };
  useEffect(() => { invalidate(); }, [parameterKey]);
  const validParameters = [spacing, dx, dy, offset, maxUnits].every(value => value.trim() !== "" && Number.isFinite(Number(value))) && Number(spacing) > 0 && Number(dx) > 0 && Number(dy) > 0 && Number(offset) >= 0 && Number.isInteger(Number(maxUnits)) && Number(maxUnits) >= 1 && Number(maxUnits) <= 5000;
  const hasSource = sourceKind === "geometry" ? sources.data?.geometries.some(row => row.id === Number(sourceId)) : sources.data?.layers.some(row => row.id === Number(sourceId));
  const validUnits = units.length > 0 && units.every(unit => validAtenaCoordinates(unit.coordinates));
  const usable = previewKey === parameterKey && metadata != null && validUnits;
  const geojson = useMemo(() => ({ type: "FeatureCollection" as const, features: units.map(unit => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: unit.coordinates }, properties: { ...unit.properties, id: unit.id, number: unit.number, name: unit.name } })) }), [units]);
  const calculate = async () => {
    if (!validParameters || !hasSource || locked) return;
    invalidate(); const key = parameterKey;
    try {
      const response = await preview.mutateAsync({ projectId, ...(sourceKind === "geometry" ? { sourceGeometryId: Number(sourceId) } : { sourceLayerId: Number(sourceId) }), spacing: Number(spacing), dx: Number(dx), dy: Number(dy), lineOffsetM: Number(offset), zigzag, maxUnits: Number(maxUnits), prefix: prefix.trim() || "UP" });
      if (!mounted.current || key !== currentKey.current) return;
      setUnits(response.units); setMetadata({ parameters: response.parameters, sourceGeometryIds: response.sourceGeometryIds }); setPreviewKey(key); setRequestId(crypto.randomUUID());
      setMessage(response.count ? `Prévia calculada: ${response.count} unidade(s). Nenhuma gravação foi solicitada.` : "Nenhuma unidade caiu dentro da geometria com estes parâmetros.");
    } catch (error) { if (mounted.current) setFailure(error instanceof Error ? error.message : "Falha ao calcular prévia."); }
  };
  const update = (index: number, axis: 0 | 1, value: string) => {
    if (locked || value.trim() === "" || !Number.isFinite(Number(value))) return;
    const number = Number(value);
    if (Math.abs(number) > (axis === 0 ? 180 : 90)) { setFailure("Coordenada fora dos limites: longitude ±180°, latitude ±90°."); return; }
    setFailure(null);
    setUnits(previous => previous.map((unit, position) => {
      if (index !== position) return unit;
      const coordinates: [number, number] = axis === 0 ? [number, unit.coordinates[1]] : [unit.coordinates[0], number];
      return { ...unit, coordinates, storedCoordinates: [coordinates[1], coordinates[0]] };
    }));
    setManual(true); setRequestId(crypto.randomUUID());
  };
  const exportFile = () => {
    if (!usable) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(geojson, null, 2)], { type: "application/geo+json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `unidades-prospeccao-${projectId}.geojson`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const saving = useRef(false);
  const confirmSave = async () => {
    if (!usable || !metadata || !canWrite || locked || saving.current) return;
    if (!window.confirm(`Confirmar a gravação de ${units.length} unidade(s) como marcadores no projeto? ${manual ? "Serão usadas as coordenadas editadas. " : ""}Os insumos serão preservados.`)) return;
    saving.current = true; setFailure(null);
    try {
      const response = await save.mutateAsync({ projectId, requestId, parameters: metadata.parameters, sourceGeometryIds: metadata.sourceGeometryIds, units: units.map(unit => ({ id: unit.id, number: unit.number, name: unit.name, coordinates: [unit.coordinates[1], unit.coordinates[0]] })) });
      void utils.geometries.list.invalidate({ projectId }); void utils.prospect.sources.invalidate({ projectId }); void utils.atena.layers.invalidate({ projectId });
      if (mounted.current) { setMessage(`${response.count} unidade(s) ${response.replayed ? "já gravada(s); reenvio ignorado" : "salva(s)"}.`); setUnits([]); setMetadata(null); setPreviewKey(null); setManual(false); }
    } catch (error) { if (mounted.current) setFailure(`Gravação não confirmada: ${error instanceof Error ? error.message : "resposta indisponível"}. Verifique o histórico antes de alterar e reenviar.`); }
    finally { saving.current = false; }
  };
  return <section className="space-y-3 rounded-md border bg-muted/20 p-3 text-xs" aria-label="Gerador de unidades de prospecção">
    <h3 className="flex items-center gap-2 font-medium"><WandSparkles className="h-4 w-4" /> Gerar unidades de prospecção</h3>
    <p>Prévia em metros (UTM local), com grade em polígonos e zigue-zague em linhas. Nada é gravado na prévia. A tabela é editável; não é um mapa interativo.</p>
    {sources.isLoading && <p role="status">Consultando insumos e permissão de escrita…</p>}
    {sources.isError && <p role="alert" className="text-destructive">Não foi possível consultar insumos: {sources.error.message}</p>}
    {sources.isSuccess && !canWrite && <p role="note" className="rounded border border-amber-300 p-2 text-amber-800">Somente leitura: prévias permitidas; salvamento desabilitado.</p>}
    {message && <p role="status">{message}</p>}{failure && <p role="alert" className="text-destructive">{failure}</p>}
    <fieldset disabled={locked} className="space-y-3"><legend className="sr-only">Parâmetros de geração</legend>
      <label className="block">Tipo de insumo<select className="mt-1 w-full rounded border bg-background p-2" value={sourceKind} onChange={event => { setSourceKind(event.target.value === "layer" ? "layer" : "geometry"); setSourceId(""); invalidate(); }}><option value="geometry">Geometria individual</option><option value="layer">Camada (todas as geometrias)</option></select></label>
      <label className="block">Insumo do projeto<select className="mt-1 w-full rounded border bg-background p-2" value={sourceId} onChange={event => { setSourceId(event.target.value); invalidate(); }} disabled={sources.isError || sources.isLoading}><option value="">Selecione…</option>{sourceKind === "geometry" ? sources.data?.geometries.map(row => <option key={row.id} value={row.id}>{row.name} · {row.type}{row.layerName ? ` · ${row.layerName}` : ""}</option>) : sources.data?.layers.map(row => <option key={row.id} value={row.id}>{row.name} · {row.featureCount} geometria(s)</option>)}</select></label>
      <div className="grid grid-cols-2 gap-2"><label>Espaçamento (m)<Input type="number" min="0.1" value={spacing} onChange={event => setSpacing(event.target.value)} /></label><label>Offset por lado (m)<Input type="number" min="0" value={offset} onChange={event => setOffset(event.target.value)} /></label><label>dx da grade (m)<Input type="number" min="0.1" value={dx} onChange={event => setDx(event.target.value)} /></label><label>dy da grade (m)<Input type="number" min="0.1" value={dy} onChange={event => setDy(event.target.value)} /></label><label>Máximo de unidades<Input type="number" min="1" max="5000" value={maxUnits} onChange={event => setMaxUnits(event.target.value)} /></label><label>Prefixo/ID<Input maxLength={24} value={prefix} onChange={event => setPrefix(event.target.value)} /></label></div>
      <label className="flex gap-2"><input type="checkbox" checked={zigzag} onChange={event => setZigzag(event.target.checked)} /> Zigue-zague alternado na linha (± offset)</label>
      <Button type="button" className="w-full" variant="secondary" disabled={!hasSource || !validParameters || sources.isError} onClick={() => void calculate()}>{preview.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Calcular prévia</Button>
    </fieldset>
    {usable && <div className="space-y-2 border-t pt-3"><div className="flex items-center justify-between"><b>Prévia: {units.length} unidade(s)</b><Button type="button" size="sm" variant="outline" onClick={exportFile}><Download className="h-3 w-3" /> GeoJSON</Button></div>
      {manual && <p role="note" className="rounded border border-amber-300 p-2 text-amber-800">Ajustes manuais presentes: a confirmação salvará as coordenadas editadas, não a grade original. O servidor revalidará os limites.</p>}
      <div className="max-h-64 overflow-auto rounded border"><table className="w-full text-[11px]"><thead><tr className="border-b text-left"><th className="p-1">ID</th><th className="p-1">Latitude</th><th className="p-1">Longitude</th></tr></thead><tbody>{units.map((unit, index) => <tr key={unit.id} className="border-b"><td className="p-1">{unit.name}</td><td className="p-1"><Input aria-label={`Latitude de ${unit.name}`} type="number" min={-90} max={90} step="0.000001" disabled={locked} value={unit.coordinates[1]} onChange={event => update(index, 1, event.target.value)} /></td><td className="p-1"><Input aria-label={`Longitude de ${unit.name}`} type="number" min={-180} max={180} step="0.000001" disabled={locked} value={unit.coordinates[0]} onChange={event => update(index, 0, event.target.value)} /></td></tr>)}</tbody></table></div>
      <Button type="button" className="w-full" disabled={!canWrite || locked} onClick={() => void confirmSave()}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar e salvar {units.length} unidade(s)</Button>
    </div>}
  </section>;
}
