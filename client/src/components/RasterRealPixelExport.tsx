import { useMemo, useState } from "react";
import { Download, FileImage, FileText, Loader2, Map as MapIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type Bounds = { north: number; south: number; east: number; west: number };

export default function RasterRealPixelExport({ projectId, bounds, title = "Exportação raster real", compact = false }: { projectId: number; bounds: Bounds; title?: string; compact?: boolean }) {
  const { data: layers, isLoading } = trpc.raster.listForMap.useQuery({ projectId }, { enabled: Number.isInteger(projectId) && projectId > 0 });
  const [selectedLayerId, setSelectedLayerId] = useState<string>("");
  const [result, setResult] = useState<{ downloads: { png: string; worldfile: string; prj: string; pdf: string } } | null>(null);
  const activeLayerId = useMemo(() => selectedLayerId ? Number(selectedLayerId) : layers?.[0]?.id, [layers, selectedLayerId]);
  const createExport = trpc.raster.createImageExport.useMutation({
    onSuccess: (value) => { setResult(value); toast.success("PNG georreferenciado e PDF com pixels raster foram gerados"); },
    onError: (error) => toast.error(error.message),
  });
  const generate = () => {
    if (!activeLayerId) return toast.error("Não há camada raster local aprovada neste projeto");
    createExport.mutate({ projectId, layerId: activeLayerId, bounds, width: 1536, height: 1024 });
  };
  return <Card className={compact ? "border-dashed" : ""}>
    <CardHeader className={compact ? "pb-3" : undefined}>
      <CardTitle className="flex items-center gap-2 text-base"><MapIcon className="h-4 w-4 text-emerald-600" />{title}</CardTitle>
      <CardDescription>Gera recorte local do COG em PNG, worldfile, PRJ e PDF. Os arquivos contêm pixels raster reais; não são apenas metadados.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : !layers?.length ? <p className="text-sm text-muted-foreground">Nenhuma camada raster local aprovada para este projeto.</p> : <>
        <div className="space-y-1"><Label>Camada COG local</Label><Select value={selectedLayerId || String(layers[0].id)} onValueChange={setSelectedLayerId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{layers.map((layer) => <SelectItem key={layer.id} value={String(layer.id)}>{layer.name} · {layer.crs} · NoData {layer.nodata}</SelectItem>)}</SelectContent></Select></div>
        <Button className="w-full" onClick={generate} disabled={createExport.isPending}>{createExport.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileImage className="mr-2 h-4 w-4" />}Gerar PNG/PDF com pixels reais</Button>
      </>}
      {result && <div className="grid gap-2 sm:grid-cols-2">
        <a className="inline-flex items-center justify-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent" href={result.downloads.png}><FileImage className="mr-2 h-4 w-4" />PNG</a>
        <a className="inline-flex items-center justify-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent" href={result.downloads.pdf}><FileText className="mr-2 h-4 w-4" />PDF</a>
        <a className="inline-flex items-center justify-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent" href={result.downloads.worldfile}><Download className="mr-2 h-4 w-4" />Worldfile</a>
        <a className="inline-flex items-center justify-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent" href={result.downloads.prj}><Download className="mr-2 h-4 w-4" />PRJ</a>
      </div>}
      {result && <img className="max-h-64 w-full rounded border object-contain bg-slate-950" src={result.downloads.png} alt="Prévia raster exportada com pixels reais" />}
    </CardContent>
  </Card>;
}
