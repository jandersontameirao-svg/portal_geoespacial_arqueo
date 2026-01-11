import { useState, useRef, useEffect } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Checkbox } from "./ui/checkbox";
import { Printer, Download, Eye, FileText, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

interface MapPrintPreviewProps {
  projectId: number;
  projectName: string;
  clientName?: string;
  bounds?: { north: number; south: number; east: number; west: number };
  onClose: () => void;
  open: boolean;
}

// Tamanhos de página em mm
const PAGE_SIZES = {
  A4: { width: 210, height: 297, label: "A4 (210×297mm)" },
  A3: { width: 297, height: 420, label: "A3 (297×420mm)" },
  A1: { width: 594, height: 841, label: "A1 (594×841mm)" },
  A0: { width: 841, height: 1189, label: "A0 (841×1189mm)" },
};

// Escalas padrão
const STANDARD_SCALES = [500, 1000, 2000, 2500, 5000, 10000, 25000, 50000, 100000];

export default function MapPrintPreview({
  projectId,
  projectName,
  clientName,
  bounds,
  onClose,
  open,
}: MapPrintPreviewProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Form state
  const [title, setTitle] = useState(`Mapa - ${projectName}`);
  const [subtitle, setSubtitle] = useState("");
  const [author, setAuthor] = useState("Grupo Arqueo");
  const [pageSize, setPageSize] = useState<keyof typeof PAGE_SIZES>("A3");
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("landscape");
  const [scale, setScale] = useState(10000);
  const [showNorthArrow, setShowNorthArrow] = useState(true);
  const [showScaleBar, setShowScaleBar] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showFrame, setShowFrame] = useState(true);

  // Calcular fuso UTM baseado nos bounds
  const utmZone = bounds
    ? Math.floor(((bounds.east + bounds.west) / 2 + 180) / 6) + 1
    : 23;

  // Dimensões do layout
  const pageDims = PAGE_SIZES[pageSize];
  const layoutWidth = orientation === "landscape" ? pageDims.height : pageDims.width;
  const layoutHeight = orientation === "landscape" ? pageDims.width : pageDims.height;

  // Escala de preview (para caber na tela)
  const previewScale = Math.min(800 / layoutWidth, 600 / layoutHeight);

  const createPrintJob = trpc.printJobs.create.useMutation({
    onSuccess: () => {
      toast.success("Job de impressão criado com sucesso!");
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao criar job de impressão");
    },
  });

  const handleGeneratePDF = async () => {
    if (!printRef.current) return;

    setIsGenerating(true);
    try {
      // Capturar o elemento como canvas
      const canvas = await html2canvas(printRef.current, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
      });

      // Criar PDF
      const pdf = new jsPDF({
        orientation: orientation,
        unit: "mm",
        format: [layoutWidth, layoutHeight],
      });

      // Adicionar imagem ao PDF
      const imgData = canvas.toDataURL("image/png");
      pdf.addImage(imgData, "PNG", 0, 0, layoutWidth, layoutHeight);

      // Salvar PDF
      const filename = `mapa_${projectName.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.pdf`;
      pdf.save(filename);

      toast.success("PDF gerado com sucesso!");

      // Criar registro no banco
      createPrintJob.mutate({
        projectId,
        name: title,
        templateType: "abnt_tecnico",
        pageSize,
        orientation,
        scale,
        title,
        subtitle: subtitle || undefined,
        author,
        showNorthArrow,
        showScaleBar,
        showLegend,
        showGrid,
        showFrame,
        bounds,
      });
    } catch (error) {
      console.error("Erro ao gerar PDF:", error);
      toast.error("Erro ao gerar PDF");
    } finally {
      setIsGenerating(false);
    }
  };

  // Gerar coordenadas da grade UTM
  const generateGridLines = () => {
    if (!bounds || !showGrid) return { horizontal: [], vertical: [] };

    const gridSpacing = scale >= 25000 ? 10000 : scale >= 10000 ? 5000 : 1000;
    const horizontal: number[] = [];
    const vertical: number[] = [];

    // Simplificado - em produção usaria proj4 para conversão UTM real
    const latStep = gridSpacing / 111320;
    const lonStep = gridSpacing / (111320 * Math.cos(((bounds.north + bounds.south) / 2) * Math.PI / 180));

    for (let lat = Math.floor(bounds.south / latStep) * latStep; lat <= bounds.north; lat += latStep) {
      horizontal.push(lat);
    }

    for (let lon = Math.floor(bounds.west / lonStep) * lonStep; lon <= bounds.east; lon += lonStep) {
      vertical.push(lon);
    }

    return { horizontal, vertical };
  };

  const gridLines = generateGridLines();

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="w-5 h-5" />
            Gerar Mapa Técnico ABNT
          </DialogTitle>
          <DialogDescription>
            Configure o layout do mapa técnico no padrão ABNT NBR 13133
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Configurações */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Título do Mapa *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Título principal do mapa"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="subtitle">Subtítulo</Label>
              <Input
                id="subtitle"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="Subtítulo opcional"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="author">Autor / Responsável</Label>
              <Input
                id="author"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Nome do responsável técnico"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tamanho da Folha</Label>
                <Select value={pageSize} onValueChange={(v) => setPageSize(v as keyof typeof PAGE_SIZES)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAGE_SIZES).map(([key, val]) => (
                      <SelectItem key={key} value={key}>{val.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Orientação</Label>
                <Select value={orientation} onValueChange={(v) => setOrientation(v as "portrait" | "landscape")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="landscape">Paisagem</SelectItem>
                    <SelectItem value="portrait">Retrato</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Escala</Label>
              <Select value={scale.toString()} onValueChange={(v) => setScale(parseInt(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STANDARD_SCALES.map((s) => (
                    <SelectItem key={s} value={s.toString()}>1:{s.toLocaleString()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3 pt-2">
              <Label className="text-sm font-medium">Elementos do Layout</Label>
              
              <div className="flex items-center space-x-2">
                <Checkbox id="northArrow" checked={showNorthArrow} onCheckedChange={(c) => setShowNorthArrow(!!c)} />
                <label htmlFor="northArrow" className="text-sm">Seta Norte</label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Checkbox id="scaleBar" checked={showScaleBar} onCheckedChange={(c) => setShowScaleBar(!!c)} />
                <label htmlFor="scaleBar" className="text-sm">Escala Gráfica e Numérica</label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Checkbox id="legend" checked={showLegend} onCheckedChange={(c) => setShowLegend(!!c)} />
                <label htmlFor="legend" className="text-sm">Legenda</label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Checkbox id="grid" checked={showGrid} onCheckedChange={(c) => setShowGrid(!!c)} />
                <label htmlFor="grid" className="text-sm">Grade UTM com Coordenadas</label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Checkbox id="frame" checked={showFrame} onCheckedChange={(c) => setShowFrame(!!c)} />
                <label htmlFor="frame" className="text-sm">Moldura Cartográfica</label>
              </div>
            </div>

            <div className="bg-gray-50 p-3 rounded-lg text-sm">
              <div className="font-medium mb-2">Informações do Sistema</div>
              <div className="text-gray-600 space-y-1">
                <div>CRS: SIRGAS 2000 / UTM zona {utmZone}S (EPSG:319{80 + utmZone})</div>
                <div>Datum: SIRGAS 2000</div>
                <div>Projeção: UTM</div>
              </div>
            </div>
          </div>

          {/* Preview */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Preview do Layout</Label>
              <Button variant="outline" size="sm" onClick={() => setShowPreview(!showPreview)}>
                <Eye className="w-4 h-4 mr-1" />
                {showPreview ? "Ocultar" : "Mostrar"} Preview
              </Button>
            </div>

            {showPreview && (
              <div className="border rounded-lg p-4 bg-gray-100 overflow-auto">
                {/* Layout do Mapa para Impressão */}
                <div
                  ref={printRef}
                  style={{
                    width: layoutWidth * previewScale,
                    height: layoutHeight * previewScale,
                    backgroundColor: "white",
                    position: "relative",
                    fontFamily: "Arial, sans-serif",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                  }}
                >
                  {/* Moldura Externa */}
                  {showFrame && (
                    <div
                      style={{
                        position: "absolute",
                        top: 5 * previewScale,
                        left: 5 * previewScale,
                        right: 5 * previewScale,
                        bottom: 5 * previewScale,
                        border: `${2 * previewScale}px solid #000`,
                      }}
                    />
                  )}

                  {/* Moldura Interna */}
                  {showFrame && (
                    <div
                      style={{
                        position: "absolute",
                        top: 10 * previewScale,
                        left: 10 * previewScale,
                        right: 10 * previewScale,
                        bottom: 10 * previewScale,
                        border: `${1 * previewScale}px solid #000`,
                      }}
                    />
                  )}

                  {/* Área do Mapa */}
                  <div
                    style={{
                      position: "absolute",
                      top: 35 * previewScale,
                      left: 15 * previewScale,
                      right: showLegend ? 80 * previewScale : 15 * previewScale,
                      bottom: 60 * previewScale,
                      backgroundColor: "#e8f4e8",
                      border: `${1 * previewScale}px solid #666`,
                    }}
                  >
                    {/* Grade UTM */}
                    {showGrid && (
                      <svg width="100%" height="100%" style={{ position: "absolute" }}>
                        {/* Linhas horizontais */}
                        {[0.2, 0.4, 0.6, 0.8].map((pos, i) => (
                          <line
                            key={`h${i}`}
                            x1="0"
                            y1={`${pos * 100}%`}
                            x2="100%"
                            y2={`${pos * 100}%`}
                            stroke="#999"
                            strokeWidth="0.5"
                            strokeDasharray="4,4"
                          />
                        ))}
                        {/* Linhas verticais */}
                        {[0.2, 0.4, 0.6, 0.8].map((pos, i) => (
                          <line
                            key={`v${i}`}
                            x1={`${pos * 100}%`}
                            y1="0"
                            x2={`${pos * 100}%`}
                            y2="100%"
                            stroke="#999"
                            strokeWidth="0.5"
                            strokeDasharray="4,4"
                          />
                        ))}
                      </svg>
                    )}
                    <div
                      style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        color: "#666",
                        fontSize: 12 * previewScale,
                        textAlign: "center",
                      }}
                    >
                      [Área do Mapa]
                      <br />
                      <span style={{ fontSize: 10 * previewScale }}>
                        Camadas do projeto serão renderizadas aqui
                      </span>
                    </div>
                  </div>

                  {/* Coordenadas da Grade (bordas) */}
                  {showGrid && (
                    <>
                      {/* Coordenadas superiores */}
                      <div style={{
                        position: "absolute",
                        top: 25 * previewScale,
                        left: 15 * previewScale,
                        right: showLegend ? 80 * previewScale : 15 * previewScale,
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 6 * previewScale,
                      }}>
                        <span>500.000 E</span>
                        <span>510.000 E</span>
                        <span>520.000 E</span>
                      </div>
                      {/* Coordenadas laterais */}
                      <div style={{
                        position: "absolute",
                        top: 35 * previewScale,
                        left: 2 * previewScale,
                        bottom: 60 * previewScale,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        fontSize: 6 * previewScale,
                        writingMode: "vertical-rl",
                        textOrientation: "mixed",
                      }}>
                        <span>7.500.000 N</span>
                        <span>7.490.000 N</span>
                        <span>7.480.000 N</span>
                      </div>
                    </>
                  )}

                  {/* Título */}
                  <div
                    style={{
                      position: "absolute",
                      top: 12 * previewScale,
                      left: 15 * previewScale,
                      right: 15 * previewScale,
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: 14 * previewScale, fontWeight: "bold" }}>
                      {title || "TÍTULO DO MAPA"}
                    </div>
                    {subtitle && (
                      <div style={{ fontSize: 10 * previewScale, marginTop: 2 * previewScale }}>
                        {subtitle}
                      </div>
                    )}
                  </div>

                  {/* Seta Norte */}
                  {showNorthArrow && (
                    <div
                      style={{
                        position: "absolute",
                        top: 40 * previewScale,
                        right: showLegend ? 85 * previewScale : 20 * previewScale,
                        width: 30 * previewScale,
                        height: 40 * previewScale,
                        textAlign: "center",
                      }}
                    >
                      <svg viewBox="0 0 40 60" width="100%" height="100%">
                        <polygon points="20,0 25,20 20,15 15,20" fill="#000" />
                        <polygon points="20,15 25,20 20,60 15,20" fill="#666" />
                        <text x="20" y="58" textAnchor="middle" fontSize="12" fontWeight="bold">N</text>
                      </svg>
                    </div>
                  )}

                  {/* Legenda */}
                  {showLegend && (
                    <div
                      style={{
                        position: "absolute",
                        top: 90 * previewScale,
                        right: 15 * previewScale,
                        width: 60 * previewScale,
                        padding: 5 * previewScale,
                        border: `${1 * previewScale}px solid #000`,
                        backgroundColor: "white",
                        fontSize: 7 * previewScale,
                      }}
                    >
                      <div style={{ fontWeight: "bold", marginBottom: 5 * previewScale, textAlign: "center" }}>
                        LEGENDA
                      </div>
                      <div style={{ display: "flex", alignItems: "center", marginBottom: 3 * previewScale }}>
                        <div style={{ width: 15 * previewScale, height: 8 * previewScale, backgroundColor: "#3b82f6", marginRight: 3 * previewScale }} />
                        <span>Área de estudo</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", marginBottom: 3 * previewScale }}>
                        <div style={{ width: 15 * previewScale, height: 2 * previewScale, backgroundColor: "#ef4444", marginRight: 3 * previewScale }} />
                        <span>Limite</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center" }}>
                        <div style={{ width: 8 * previewScale, height: 8 * previewScale, backgroundColor: "#22c55e", borderRadius: "50%", marginRight: 3 * previewScale }} />
                        <span>Ponto</span>
                      </div>
                    </div>
                  )}

                  {/* Escala Gráfica */}
                  {showScaleBar && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: 45 * previewScale,
                        left: 15 * previewScale,
                        fontSize: 8 * previewScale,
                      }}
                    >
                      <div style={{ marginBottom: 2 * previewScale }}>Escala 1:{scale.toLocaleString()}</div>
                      <div style={{ display: "flex", alignItems: "center" }}>
                        <div style={{ width: 40 * previewScale, height: 6 * previewScale, backgroundColor: "#000" }} />
                        <div style={{ width: 40 * previewScale, height: 6 * previewScale, backgroundColor: "#fff", border: "1px solid #000" }} />
                        <div style={{ width: 40 * previewScale, height: 6 * previewScale, backgroundColor: "#000" }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", width: 120 * previewScale }}>
                        <span>0</span>
                        <span>{(scale / 1000).toFixed(0)}km</span>
                        <span>{(scale * 2 / 1000).toFixed(0)}km</span>
                        <span>{(scale * 3 / 1000).toFixed(0)}km</span>
                      </div>
                    </div>
                  )}

                  {/* Carimbo Técnico */}
                  <div
                    style={{
                      position: "absolute",
                      bottom: 12 * previewScale,
                      left: 15 * previewScale,
                      right: 15 * previewScale,
                      height: 30 * previewScale,
                      border: `${1 * previewScale}px solid #000`,
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr",
                      fontSize: 6 * previewScale,
                    }}
                  >
                    {/* Logo */}
                    <div style={{ borderRight: `${1 * previewScale}px solid #000`, padding: 2 * previewScale, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <div style={{ fontWeight: "bold", fontSize: 8 * previewScale, color: "#f97316" }}>
                        GRUPO<br/>ARQUEO
                      </div>
                    </div>
                    {/* Projeto */}
                    <div style={{ borderRight: `${1 * previewScale}px solid #000`, padding: 2 * previewScale }}>
                      <div style={{ fontWeight: "bold" }}>PROJETO:</div>
                      <div>{projectName}</div>
                    </div>
                    {/* Cliente */}
                    <div style={{ borderRight: `${1 * previewScale}px solid #000`, padding: 2 * previewScale }}>
                      <div style={{ fontWeight: "bold" }}>CLIENTE:</div>
                      <div>{clientName || "-"}</div>
                    </div>
                    {/* Autor/Data */}
                    <div style={{ borderRight: `${1 * previewScale}px solid #000`, padding: 2 * previewScale }}>
                      <div style={{ fontWeight: "bold" }}>AUTOR:</div>
                      <div>{author}</div>
                      <div style={{ marginTop: 2 * previewScale }}>
                        <span style={{ fontWeight: "bold" }}>DATA: </span>
                        {new Date().toLocaleDateString("pt-BR")}
                      </div>
                    </div>
                    {/* CRS */}
                    <div style={{ padding: 2 * previewScale }}>
                      <div style={{ fontWeight: "bold" }}>CRS:</div>
                      <div>SIRGAS 2000</div>
                      <div>UTM {utmZone}S</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => setShowPreview(true)} variant="outline">
            <Eye className="w-4 h-4 mr-2" />
            Visualizar
          </Button>
          <Button onClick={handleGeneratePDF} disabled={isGenerating || !title}>
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Gerando...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Exportar PDF
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
