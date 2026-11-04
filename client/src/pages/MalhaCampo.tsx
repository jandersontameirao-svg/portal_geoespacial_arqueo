import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Upload, Grid3x3, Download, MapPin, Route, Shapes, Target } from "lucide-react";
import { DEFAULT_BASEMAP } from "@/lib/basemaps";
import {
  parseGeoFile,
  gerarMalha,
  buildKml,
  buildGpx,
  nomeArquivoMalha,
  baixarArquivo,
  type ParsedGeo,
  type MalhaResultado,
  type LngLat,
} from "@/lib/geo";

const LINHA_COR = "#8a1a2b"; // vinho (geometria de origem)
const MALHA_COR = "#14b8a6"; // teal (pontos da malha)
const MAX_PONTOS_CONSULTA = 4000;

const tipoLabel: Record<MalhaResultado["tipoMalha"], string> = {
  linear: "Linear",
  poligonal: "Poligonal",
  mista: "Mista",
  pontual: "Pontual",
};

export default function MalhaCampo() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);
  const [mapContainer, setMapContainer] = useState<HTMLDivElement | null>(null);
  const mapContainerRef = useCallback((node: HTMLDivElement | null) => setMapContainer(node), []);

  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedGeo | null>(null);
  const [spacing, setSpacing] = useState(200);
  const [result, setResult] = useState<MalhaResultado | null>(null);
  const [parsing, setParsing] = useState(false);
  const [consultaPontos, setConsultaPontos] = useState<LngLat[] | null>(null);

  const municipios = trpc.geo.municipiosCruzados.useQuery(
    { pontos: consultaPontos ?? [] },
    { enabled: !!consultaPontos && consultaPontos.length > 0, retry: false },
  );

  // Cria o mapa uma vez.
  useEffect(() => {
    if (!mapContainer || mapRef.current) return;
    const map = L.map(mapContainer, { center: [-15.78, -47.92], zoom: 4 });
    L.tileLayer(DEFAULT_BASEMAP.url!, {
      attribution: DEFAULT_BASEMAP.attribution,
      maxZoom: DEFAULT_BASEMAP.maxZoom ?? 19,
      crossOrigin: DEFAULT_BASEMAP.crossOrigin,
    }).addTo(map);
    overlayRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, [mapContainer]);

  // Redesenha overlays quando a malha muda.
  useEffect(() => {
    const map = mapRef.current;
    const overlay = overlayRef.current;
    if (!map || !overlay) return;
    overlay.clearLayers();
    if (!parsed) return;

    for (const line of parsed.linhas) {
      L.polyline(line.map(([lng, lat]) => [lat, lng] as [number, number]), { color: LINHA_COR, weight: 3 }).addTo(overlay);
    }
    for (const ring of parsed.poligonos) {
      L.polygon(ring.map(([lng, lat]) => [lat, lng] as [number, number]), { color: LINHA_COR, weight: 2, fillOpacity: 0.15 }).addTo(overlay);
    }
    if (result) {
      for (const [lng, lat] of result.pontos) {
        L.circleMarker([lat, lng], { radius: 3, color: MALHA_COR, weight: 1, fillColor: MALHA_COR, fillOpacity: 0.9 }).addTo(overlay);
      }
      if (result.bbox) {
        const [minLng, minLat, maxLng, maxLat] = result.bbox;
        map.fitBounds([[minLat, minLng], [maxLat, maxLng]], { padding: [40, 40], maxZoom: 16 });
      }
    }
  }, [parsed, result]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setParsing(true);
    setResult(null);
    setConsultaPontos(null);
    try {
      const p = await parseGeoFile(file);
      setParsed(p);
      setFileName(file.name);
      const malha = gerarMalha(p, spacing);
      setResult(malha);
      toast.success(`${malha.quantidadePontos} ponto(s) de malha gerado(s).`);
    } catch (e) {
      setParsed(null);
      toast.error(e instanceof Error ? e.message : "Falha ao ler o arquivo.");
    } finally {
      setParsing(false);
    }
  };

  const regerar = (novoEspacamento: number) => {
    if (!parsed) return;
    const malha = gerarMalha(parsed, novoEspacamento);
    setResult(malha);
    setConsultaPontos(null); // invalida municípios (dependem da malha)
  };

  const exportar = (ext: "kml" | "gpx") => {
    if (!parsed || !result) return;
    const nome = nomeArquivoMalha(fileName.replace(/\.[^.]+$/, "") || "malha", spacing, ext);
    if (ext === "kml") {
      baixarArquivo(nome, buildKml(nome, { meshPoints: result.pontos, linhas: parsed.linhas, poligonos: parsed.poligonos }), "application/vnd.google-earth.kml+xml");
    } else {
      baixarArquivo(nome, buildGpx(nome, { meshPoints: result.pontos, linhas: parsed.linhas }), "application/gpx+xml");
    }
  };

  const identificarMunicipios = () => {
    if (!result || result.pontos.length === 0) return;
    setConsultaPontos(result.pontos.slice(0, MAX_PONTOS_CONSULTA));
  };

  const stats = useMemo(() => {
    if (!result) return null;
    return [
      { label: "Tipo de malha", value: tipoLabel[result.tipoMalha], icon: Shapes },
      { label: "Pontos", value: result.quantidadePontos.toLocaleString("pt-BR"), icon: Target },
      { label: "Extensão", value: `${result.extensaoKm.toFixed(2)} km`, icon: Route },
      { label: "Área", value: `${result.areaHa.toFixed(2)} ha`, icon: Grid3x3 },
    ];
  }, [result]);

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }
  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md"><CardHeader><CardTitle>Acesso Restrito</CardTitle><CardDescription>Faça login para usar a malha de campo.</CardDescription></CardHeader></Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container py-8">
        <div className="mb-6">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
            <Grid3x3 className="h-8 w-8 text-teal-600" />
            Malha de Campo
          </h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2">
            Importe uma geometria (KML, KMZ, GPX, GeoJSON ou SHP.zip), gere a malha de pontos de prospecção e exporte em KML/GPX. Geração 100% determinística.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="flex min-h-[520px] flex-col overflow-hidden">
            <CardContent className="flex min-h-0 flex-1 p-0">
              <div ref={mapContainerRef} className="h-full min-h-[520px] w-full" aria-label="Mapa da malha de campo" />
            </CardContent>
          </Card>

          <aside className="space-y-4">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">1. Importar geometria</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <Label htmlFor="geo-file" className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 p-4 text-sm text-slate-600 hover:border-teal-400 dark:border-slate-700 dark:text-slate-300">
                  {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {fileName || "Escolher arquivo"}
                </Label>
                <input id="geo-file" type="file" accept=".kml,.kmz,.gpx,.geojson,.json,.zip" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
                <p className="text-xs text-slate-400">Formatos: KML, KMZ, GPX, GeoJSON, SHP (.zip).</p>
              </CardContent>
            </Card>

            {parsed && (
              <>
                <Card>
                  <CardHeader className="pb-3"><CardTitle className="text-base">2. Espaçamento da malha</CardTitle><CardDescription>{spacing} m entre pontos</CardDescription></CardHeader>
                  <CardContent className="space-y-3">
                    <Slider value={[spacing]} min={25} max={1000} step={25} onValueChange={([v]) => setSpacing(v)} onValueCommit={([v]) => regerar(v)} />
                    <div className="flex items-center gap-2">
                      <Input type="number" min={5} max={5000} value={spacing} onChange={(e) => setSpacing(Number(e.target.value) || 0)} className="h-8" />
                      <Button size="sm" variant="outline" onClick={() => regerar(spacing)}>Regerar</Button>
                    </div>
                    <p className="text-xs text-slate-400">Menor espaçamento = malha mais densa. Máx. 5.000 pontos por polígono.</p>
                  </CardContent>
                </Card>

                {stats && (
                  <Card>
                    <CardHeader className="pb-3"><CardTitle className="text-base">Resultado</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-2 gap-2">
                      {stats.map((s) => (
                        <div key={s.label} className="rounded-lg border p-2">
                          <div className="flex items-center gap-1 text-xs text-slate-500"><s.icon className="h-3.5 w-3.5" />{s.label}</div>
                          <p className="mt-1 text-sm font-semibold">{s.value}</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><MapPin className="h-4 w-4 text-blue-600" />Municípios cruzados</CardTitle><CardDescription>Point-in-polygon sobre malhas oficiais do IBGE.</CardDescription></CardHeader>
                  <CardContent className="space-y-2">
                    <Button size="sm" variant="outline" className="w-full" disabled={!result || municipios.isFetching} onClick={identificarMunicipios}>
                      {municipios.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MapPin className="mr-2 h-4 w-4" />}
                      Identificar municípios
                    </Button>
                    {municipios.error && <p className="text-xs text-destructive">{municipios.error.message}</p>}
                    {municipios.data && (
                      municipios.data.municipios.length === 0 ? (
                        <p className="text-xs text-slate-400">Nenhum município identificado (geometria fora do Brasil?).</p>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {municipios.data.municipios.map((m) => <Badge key={m} variant="outline" className="text-[11px]">{m}</Badge>)}
                        </div>
                      )
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3"><CardTitle className="text-base">3. Exportar malha</CardTitle></CardHeader>
                  <CardContent className="flex gap-2">
                    <Button variant="outline" className="flex-1" disabled={!result} onClick={() => exportar("kml")}><Download className="mr-1 h-4 w-4" />KML</Button>
                    <Button variant="outline" className="flex-1" disabled={!result} onClick={() => exportar("gpx")}><Download className="mr-1 h-4 w-4" />GPX</Button>
                  </CardContent>
                </Card>
              </>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
