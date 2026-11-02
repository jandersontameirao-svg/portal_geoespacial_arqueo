import { ChangeEvent, useRef, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { effectiveUploadMime, isTiffMime, rasterNameFromFilename } from "@shared/tiffUploadPolicy";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o GeoTIFF"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.readAsDataURL(file);
  });
}

export default function RasterIngestionPanel({ projectId, canEdit }: { projectId: number; canEdit: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const { data: availability, isLoading } = trpc.raster.ingestionAvailability.useQuery(undefined, { enabled: canEdit });
  const [sourceLabel, setSourceLabel] = useState("Upload local autorizado pelo usuário do projeto");
  const [acquisitionAt, setAcquisitionAt] = useState(() => new Date().toISOString().slice(0, 16));
  const ingest = trpc.raster.ingestGeoTiff.useMutation({
    onSuccess: async (result) => {
      await utils.raster.listForMap.invalidate({ projectId });
      toast.success(`COG processado: ${result.tileCount ?? 0} tiles e hash SHA-256 registrado.`);
    },
    onError: (error) => toast.error(error.message),
  });

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const mimeType = effectiveUploadMime(file);
    if (!isTiffMime(mimeType)) return toast.error("Selecione um GeoTIFF (.tif ou .tiff) reconhecido pelo navegador.");
    if (file.size > 100 * 1024 * 1024) return toast.error("O limite configurado é 100 MB por GeoTIFF.");
    if (!sourceLabel.trim()) return toast.error("Informe a fonte/licença do raster.");
    const acquiredAt = new Date(acquisitionAt);
    if (Number.isNaN(acquiredAt.getTime())) return toast.error("Informe uma data de aquisição válida.");
    try {
      await ingest.mutateAsync({
        projectId, filename: file.name, mimeType, size: file.size,
        fileData: await fileToBase64(file), name: rasterNameFromFilename(file.name),
        acquisitionAt: acquiredAt.toISOString(), sourceLabel: sourceLabel.trim(), minZoom: 12, maxZoom: 14, nodata: 0, resampling: "cubic",
      });
    } catch { /* erro já comunicado pelo mutation */ }
  };

  if (!canEdit) return null;
  return <Card>
    <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><FileUp className="h-4 w-4 text-blue-600" />Ingerir GeoTIFF / COG</CardTitle><CardDescription>O arquivo é validado, convertido para COG EPSG:4674, recebe pirâmides e tiles PNG protegidos por projeto.</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : availability?.available ? <>
        <div className="space-y-1"><Label htmlFor="raster-source">Fonte/licença</Label><Input id="raster-source" value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} maxLength={500} /></div>
        <div className="space-y-1"><Label htmlFor="raster-acquisition">Aquisição (UTC)</Label><Input id="raster-acquisition" type="datetime-local" value={acquisitionAt} onChange={(event) => setAcquisitionAt(event.target.value)} /></div>
        <input ref={inputRef} type="file" accept=".tif,.tiff,image/tiff,image/geotiff,application/geotiff" className="hidden" onChange={handleFile} />
        <Button className="w-full" onClick={() => inputRef.current?.click()} disabled={ingest.isPending}>{ingest.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}{ingest.isPending ? "Processando COG e tiles…" : "Selecionar GeoTIFF"}</Button>
        <p className="text-xs text-muted-foreground">Adapter: {availability.mode}. Limite: 100 MB. O navegador não envia paths; o worker usa apenas volume configurado.</p>
      </> : <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-100">{availability?.reason || "Ingestão raster indisponível neste ambiente."}</p>}
    </CardContent>
  </Card>;
}
