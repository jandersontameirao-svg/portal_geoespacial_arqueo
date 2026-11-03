import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  AlertCircle,
  ChevronDown,
  Download,
  Eye,
  Loader2,
  Printer,
  Save,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { MapPrintSnapshot } from "@shared/mapPrint";
import {
  PRINT_LAYOUT_SEEDS,
  PRINT_PAPER_SIZES,
  isMapPrintLayoutConfig,
  readMapPrintLayoutConfig,
  writeMapPrintLayoutConfig,
  type PrintLayoutConfig,
  type PrintPaper,
  type PrintOrientation,
} from "@shared/mapPrintLayouts";
import {
  buildPrintScene,
  createMapPrintPdf,
  decodePrintSnapshot,
  printSceneSvg,
  type PrintDocumentInput,
} from "@/lib/mapPrintRender";

export interface MapPrintPreviewProps {
  projectId: number;
  projectName: string;
  clientName?: string;
  /** Compatibility hint only: exports always use the actual captured extent. */
  bounds?: { north: number; south: number; east: number; west: number };
  onClose: () => void;
  open: boolean;
  captureMap?: (signal?: AbortSignal) => Promise<MapPrintSnapshot>;
}
const selectClass =
  "flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const copyLayout = (layout: PrintLayoutConfig): PrintLayoutConfig => ({
  ...layout,
  elements: { ...layout.elements },
});
const messageOf = (error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : "Não foi possível preparar o mapa. Tente novamente.";
  return /cors|taint|cross.?origin|seguran[cç]a|security|exportar pixels/i.test(
    message
  )
    ? `${message} Uma fonte permite visualizar, mas não exportar pixels; desative-a ou use uma fonte com permissão de impressão.`
    : message;
};
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="h-4 w-4 accent-teal-700"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
export default function MapPrintPreview({
  projectId,
  projectName,
  clientName,
  onClose,
  open,
  captureMap,
}: MapPrintPreviewProps) {
  const [title, setTitle] = useState(`Mapa — ${projectName}`);
  const [subtitle, setSubtitle] = useState("");
  const [author, setAuthor] = useState("");
  const [layout, setLayout] = useState<PrintLayoutConfig>(() =>
    copyLayout(PRINT_LAYOUT_SEEDS[0].config)
  );
  const [modelId, setModelId] = useState<string>(PRINT_LAYOUT_SEEDS[0].id);
  const [modelName, setModelName] = useState("");
  const [snapshot, setSnapshot] = useState<MapPrintSnapshot | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const captureRef = useRef(captureMap);
  const captureController = useRef<AbortController | null>(null);
  const exportController = useRef<AbortController | null>(null);
  useEffect(() => {
    captureRef.current = captureMap;
  }, [captureMap]);
  const userQuery = trpc.auth.me.useQuery(undefined, {
    enabled: open,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const templatesQuery = trpc.atlas.templates.list.useQuery(
    { projectId },
    {
      enabled: open && projectId > 0,
      retry: false,
      refetchOnWindowFocus: false,
    }
  );
  const canSave =
    userQuery.data?.role === "admin" || userQuery.data?.role === "editor";
  const saveModel = trpc.atlas.templates.create.useMutation({
    onSuccess: data => {
      toast.success("Modelo de impressão salvo no projeto.");
      setModelName("");
      setModelId(`saved:${data.id}`);
      void templatesQuery.refetch();
    },
    onError: err =>
      toast.error(`Não foi possível salvar o modelo: ${err.message}`),
  });
  const startCapture = useCallback(async () => {
    captureController.current?.abort();
    exportController.current?.abort();
    const controller = new AbortController();
    captureController.current = controller;
    setSnapshot(null);
    setError(null);
    setExportError(null);
    setIsGenerating(false);
    setIsCapturing(true);
    try {
      if (!captureRef.current)
        throw new Error(
          "A captura do mapa não está disponível nesta vista. Abra a impressão a partir do mapa 2D."
        );
      const result = await captureRef.current(controller.signal);
      if (controller.signal.aborted) return;
      await decodePrintSnapshot(result, controller.signal);
      if (!controller.signal.aborted) setSnapshot(result);
    } catch (err) {
      if (!controller.signal.aborted) setError(messageOf(err));
    } finally {
      if (!controller.signal.aborted) setIsCapturing(false);
    }
  }, []);
  useEffect(() => {
    if (open) void startCapture();
    else {
      setSnapshot(null);
      setIsCapturing(false);
      setIsGenerating(false);
    }
    return () => {
      captureController.current?.abort();
      exportController.current?.abort();
    };
  }, [open, projectId, startCapture]);
  const previousProject = useRef(projectId);
  useEffect(() => {
    if (previousProject.current !== projectId) {
      previousProject.current = projectId;
      setTitle(`Mapa — ${projectName}`);
      setModelId(PRINT_LAYOUT_SEEDS[0].id);
      setLayout(copyLayout(PRINT_LAYOUT_SEEDS[0].config));
      setModelName("");
    }
  }, [projectId, projectName]);
  const input = useMemo<PrintDocumentInput | null>(
    () =>
      snapshot
        ? { snapshot, layout, title, subtitle, author, projectName, clientName }
        : null,
    [snapshot, layout, title, subtitle, author, projectName, clientName]
  );
  const rendered = useMemo(() => {
    if (!input) return { scene: null, svg: null, error: null };
    try {
      const scene = buildPrintScene(input);
      return { scene, svg: printSceneSvg(scene), error: null };
    } catch (err) {
      return { scene: null, svg: null, error: messageOf(err) };
    }
  }, [input]);
  const previewUrl = useMemo(
    () =>
      rendered.svg
        ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(rendered.svg)}`
        : undefined,
    [rendered.svg]
  );
  const changeElement = (
    key: keyof PrintLayoutConfig["elements"],
    value: boolean
  ) =>
    setLayout(current => ({
      ...current,
      elements: { ...current.elements, [key]: value },
    }));
  const selectModel = (id: string) => {
    const seed = PRINT_LAYOUT_SEEDS.find(item => item.id === id);
    const saved = templatesQuery.data?.find(item => `saved:${item.id}` === id);
    const config = seed?.config ?? readMapPrintLayoutConfig(saved?.config);
    if (config) {
      setModelId(id);
      setLayout(copyLayout(config));
      setExportError(null);
    }
  };
  const close = () => {
    captureController.current?.abort();
    exportController.current?.abort();
    onClose();
  };
  const download = async () => {
    if (
      !input ||
      !rendered.scene ||
      !title.trim() ||
      isCapturing ||
      isGenerating
    )
      return;
    exportController.current?.abort();
    const controller = new AbortController();
    exportController.current = controller;
    setIsGenerating(true);
    setExportError(null);
    try {
      // Paint first. No page-sized raster or canvas is allocated.
      await new Promise(resolve => setTimeout(resolve, 25));
      if (controller.signal.aborted) return;
      const pdf = createMapPrintPdf(input, rendered.scene);
      if (controller.signal.aborted) return;
      const name =
        projectName
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-zA-Z0-9_-]+/g, "_")
          .slice(0, 80) || "projeto";
      pdf.save(`mapa_${name}_${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success("PDF baixado localmente. Nenhum job foi criado.");
    } catch (err) {
      if (!controller.signal.aborted)
        setExportError(`Não foi possível baixar o PDF: ${messageOf(err)}`);
    } finally {
      if (!controller.signal.aborted) setIsGenerating(false);
    }
  };
  const eligible =
    templatesQuery.data?.filter(template =>
      readMapPrintLayoutConfig(template.config)
    ) ?? [];
  const unsupported =
    templatesQuery.data?.filter(
      template => !readMapPrintLayoutConfig(template.config)
    ) ?? [];
  const visibleError = error || rendered.error || exportError;
  return (
    <Dialog
      open={open}
      onOpenChange={value => {
        if (!value) close();
      }}
    >
      <DialogContent className="max-h-[94dvh] overflow-y-auto p-4 sm:max-w-6xl sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-teal-700" />
            Imprimir mapa
          </DialogTitle>
          <DialogDescription>
            Escolha o modelo e baixe a vista atual em PDF. O mapa usa os pixels
            e os limites reais da captura.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="map-print-title">Título do mapa</Label>
              <Input
                id="map-print-title"
                maxLength={160}
                value={title}
                onChange={event => setTitle(event.target.value)}
                placeholder="Informe o título"
              />
              {!title.trim() && (
                <p className="text-xs text-destructive">
                  Informe um título para baixar o PDF.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="map-print-model">Modelo de layout</Label>
              <select
                id="map-print-model"
                className={selectClass}
                value={modelId}
                onChange={event => selectModel(event.target.value)}
              >
                <optgroup label="Modelos iniciais">
                  {PRINT_LAYOUT_SEEDS.map(seed => (
                    <option key={seed.id} value={seed.id}>
                      {seed.name}
                    </option>
                  ))}
                </optgroup>
                {eligible.length > 0 && (
                  <optgroup label="Modelos salvos no projeto">
                    {eligible.map(template => (
                      <option key={template.id} value={`saved:${template.id}`}>
                        {template.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {unsupported.length > 0 && (
                  <optgroup label="Outros modelos preservados (não aplicáveis)">
                    {unsupported.map(template => (
                      <option
                        disabled
                        key={template.id}
                        value={`unsupported:${template.id}`}
                      >
                        {template.name} —{" "}
                        {isMapPrintLayoutConfig(template.config)
                          ? "versão incompatível"
                          : "Atlas multipágina"}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {
                  PRINT_LAYOUT_SEEDS.find(seed => seed.id === layout.signature)
                    ?.description
                }{" "}
                Alterações abaixo valem para esta impressão.
              </p>
              {templatesQuery.isLoading && (
                <p className="text-xs text-muted-foreground">
                  Carregando modelos do projeto…
                </p>
              )}
              {templatesQuery.isError && (
                <p className="text-xs text-amber-700">
                  Modelos salvos indisponíveis. Os modelos iniciais e a
                  exportação local continuam disponíveis.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-3 rounded-lg border p-3">
              <Toggle
                label="Legenda"
                checked={layout.elements.legend}
                onChange={value => changeElement("legend", value)}
              />
              <Toggle
                label="Grade geográfica"
                checked={layout.elements.grid}
                onChange={value => changeElement("grid", value)}
              />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              A grade usa latitude/longitude em graus, posicionadas em
              EPSG:3857. Não é uma grade UTM.
            </p>
            <details className="group rounded-lg border">
              <summary className="flex cursor-pointer list-none items-center justify-between p-3 text-sm font-medium">
                Opções avançadas
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-4 border-t p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="map-print-paper">Papel</Label>
                    <select
                      id="map-print-paper"
                      className={selectClass}
                      value={layout.paper}
                      onChange={event =>
                        setLayout(current => ({
                          ...current,
                          paper: event.target.value as PrintPaper,
                        }))
                      }
                    >
                      {Object.entries(PRINT_PAPER_SIZES).map(([key, paper]) => (
                        <option key={key} value={key}>
                          {key} · {paper.width} × {paper.height} mm
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="map-print-orientation">Orientação</Label>
                    <select
                      id="map-print-orientation"
                      className={selectClass}
                      value={layout.orientation}
                      onChange={event =>
                        setLayout(current => ({
                          ...current,
                          orientation: event.target.value as PrintOrientation,
                        }))
                      }
                    >
                      <option value="landscape">Paisagem</option>
                      <option value="portrait">Retrato</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="map-print-subtitle">Subtítulo</Label>
                  <Input
                    id="map-print-subtitle"
                    maxLength={200}
                    value={subtitle}
                    onChange={event => setSubtitle(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="map-print-author">Autor / responsável</Label>
                  <Input
                    id="map-print-author"
                    maxLength={100}
                    value={author}
                    onChange={event => setAuthor(event.target.value)}
                    placeholder="Opcional"
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  <Toggle
                    label="Norte"
                    checked={layout.elements.north}
                    onChange={value => changeElement("north", value)}
                  />
                  <Toggle
                    label="Moldura"
                    checked={layout.elements.frame}
                    onChange={value => changeElement("frame", value)}
                  />
                  <Toggle
                    label="Escala calculada"
                    checked={layout.elements.scale}
                    onChange={value => changeElement("scale", value)}
                  />
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  A escala é calculada para o centro da captura e para o tamanho
                  real do mapa na folha. Ela varia com a latitude; não
                  representa certificação técnica. A1/A0 não acrescentam
                  resolução aos pixels capturados.
                </p>
                <div className="space-y-2 border-t pt-3">
                  <Label htmlFor="map-print-save-name">
                    Salvar como novo modelo
                  </Label>
                  <Input
                    id="map-print-save-name"
                    disabled={!canSave}
                    maxLength={255}
                    value={modelName}
                    onChange={event => setModelName(event.target.value)}
                    placeholder="Nome do modelo (mín. 3 caracteres)"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={
                      !canSave ||
                      modelName.trim().length < 3 ||
                      saveModel.isPending ||
                      projectId <= 0
                    }
                    onClick={() => {
                      if (!canSave) return;
                      saveModel.mutate({
                        projectId,
                        name: modelName.trim(),
                        templateType:
                          layout.signature === "tecnico"
                            ? "abnt_tecnico"
                            : "cliente",
                        config: writeMapPrintLayoutConfig(layout),
                        isDefault: false,
                      });
                    }}
                  >
                    {saveModel.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Salvar modelo
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {canSave
                      ? "Salva papel, orientação e elementos. Não inclui imagem, título ou dados do mapa e não altera modelos existentes."
                      : "Somente editores e administradores podem salvar modelos. A impressão local continua disponível."}
                  </p>
                </div>
              </div>
            </details>
            {visibleError && (
              <div
                role="alert"
                className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{visibleError}</span>
              </div>
            )}
          </div>
          <section
            aria-label="Pré-visualização de impressão"
            className="min-w-0 rounded-xl border bg-slate-100 p-3 text-slate-800 sm:p-4"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                Prévia · {layout.paper} ·{" "}
                {layout.orientation === "landscape" ? "Paisagem" : "Retrato"}
              </span>
              <span className="text-xs text-slate-500">
                {rendered.scene
                  ? `${Math.round(rendered.scene.effectiveDpi)} DPI efetivos do mapa`
                  : "Vista atual"}
              </span>
            </div>
            {isCapturing ? (
              <div
                role="status"
                className="flex min-h-64 flex-col items-center justify-center gap-3 text-sm"
              >
                <Loader2 className="h-7 w-7 animate-spin text-teal-700" />
                Capturando a vista real do mapa…
              </div>
            ) : previewUrl ? (
              <img
                src={previewUrl}
                alt="Prévia da folha com a captura real do mapa, legenda e créditos"
                className="mx-auto h-auto max-h-[60vh] w-full object-contain drop-shadow-lg"
              />
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-5 text-center text-sm text-slate-600">
                <Printer className="h-8 w-8 text-slate-400" />
                <p>
                  {visibleError
                    ? "A prévia não está disponível. Corrija o problema e tente novamente."
                    : "Aguardando uma captura real do mapa."}
                </p>
                <p className="text-xs">
                  Nenhum mapa de exemplo ou PDF vazio será gerado.
                </p>
              </div>
            )}
            {snapshot && (
              <div className="mt-3 space-y-1 text-xs leading-relaxed text-slate-600">
                <p>
                  Captura:{" "}
                  {new Date(snapshot.capturedAt).toLocaleString("pt-BR")} ·{" "}
                  {snapshot.width} × {snapshot.height} px · EPSG:3857
                </p>
                <p>
                  Proporção original preservada. O PDF mantém textos e linhas
                  vetoriais; o mapa é a imagem da vista, sem inventar 300 DPI.
                </p>
              </div>
            )}
            {!!rendered.scene?.warnings.length && (
              <div
                role="status"
                className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900"
              >
                <p className="mb-1 font-semibold">Observações da captura</p>
                <ul className="list-inside list-disc space-y-1">
                  {rendered.scene.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
        <DialogFooter className="gap-2 border-t pt-4 sm:justify-between">
          <Button type="button" variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isCapturing || isGenerating}
              onClick={() => void startCapture()}
            >
              {isCapturing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Eye className="mr-2 h-4 w-4" />
              )}
              Pré-visualizar
            </Button>
            <Button
              type="button"
              disabled={
                !input ||
                !rendered.scene ||
                !title.trim() ||
                isCapturing ||
                isGenerating
              }
              onClick={() => void download()}
            >
              {isGenerating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {isGenerating ? "Gerando PDF…" : "Baixar PDF"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
