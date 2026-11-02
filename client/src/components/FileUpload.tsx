import { useState, useRef, DragEvent, ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Upload, X, FileText, Image as ImageIcon, File } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { effectiveUploadMime, resolveTiffUpload, type TiffUploadMode } from "@shared/tiffUploadPolicy";

interface FileUploadProps {
  projectId: number;
  onUploadComplete?: () => void;
  maxSizeMB?: number;
  acceptedTypes?: string[];
}

interface UploadingFile {
  file: File;
  progress: number;
  status: "uploading" | "success" | "error";
  error?: string;
}

const ACCEPTED_TYPES = {
  // Geoespacial
  "application/vnd.google-earth.kml+xml": [".kml"],
  "application/vnd.google-earth.kmz": [".kmz"],
  "application/zip": [".zip"],
  "application/x-zip-compressed": [".zip"],
  "application/geo+json": [".geojson"],
  "application/json": [".geojson", ".json"],
  // Documentos
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  // Imagens
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "image/tiff": [".tif", ".tiff"],
  "image/geotiff": [".tif", ".tiff"],
  "application/geotiff": [".tif", ".tiff"],
};

export default function FileUpload({
  projectId,
  onUploadComplete,
  maxSizeMB = 100,
  acceptedTypes = Object.keys(ACCEPTED_TYPES),
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tiffMode, setTiffMode] = useState<TiffUploadMode>("raster");

  const uploadMutation = trpc.files.upload.useMutation();
  const rasterIngestMutation = trpc.raster.ingestGeoTiff.useMutation();
  const { data: rasterAvailability, isLoading: availabilityLoading } = trpc.raster.ingestionAvailability.useQuery();

  const validateFile = (file: File): string | null => {
    // Validar tamanho
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      return `Arquivo muito grande. Tamanho máximo: ${maxSizeMB}MB`;
    }

    // Validar tipo
    if (!acceptedTypes.includes(effectiveUploadMime(file))) {
      return "Tipo de arquivo não permitido";
    }
    const policy = resolveTiffUpload(file, tiffMode);
    if (policy.route === "raster" && !rasterAvailability?.available) {
      return availabilityLoading
        ? "Aguarde a verificação da ingestão raster ou escolha guardar somente o original."
        : `${rasterAvailability?.reason || "Ingestão raster indisponível."} Para armazenar sem processamento, escolha guardar somente o original.`;
    }

    return null;
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const newFiles: UploadingFile[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const error = validateFile(file);

      if (error) {
        toast.error(`${file.name}: ${error}`);
        continue;
      }

      newFiles.push({
        file,
        progress: 0,
        status: "uploading",
      });
    }

    if (newFiles.length === 0) return;

    setUploadingFiles((prev) => [...prev, ...newFiles]);

    // Upload real via tRPC
    for (const uploadFile of newFiles) {
      try {
        // Converter arquivo para base64
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onerror = () => reject(new Error("Não foi possível ler o arquivo"));
          reader.onload = () => {
            const base64 = (reader.result as string).split(",")[1];
            resolve(base64);
          };
          reader.readAsDataURL(uploadFile.file);
        });

        const fileData = await base64Promise;

        // Determinar categoria
        let category: "geospatial" | "document" | "image" | "other" = "other";
        const policy = resolveTiffUpload(uploadFile.file, tiffMode);
        const mimeType = policy.mime;
        if (
          mimeType.includes("kml") ||
          mimeType.includes("kmz") ||
          mimeType.includes("zip") ||
          mimeType.includes("json") ||
          policy.route === "raster"
        ) {
          category = "geospatial";
        } else if (
          mimeType.includes("pdf") ||
          mimeType.includes("word") ||
          mimeType.includes("sheet")
        ) {
          category = "document";
        } else if (mimeType.startsWith("image/") || policy.isTiff) {
          category = "image";
        }

        // Atualizar progresso para 50% (preparando)
        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.file === uploadFile.file ? { ...f, progress: 50 } : f
          )
        );

        // Gerar descrição automática baseada no arquivo
        const autoDescription = `Arquivo ${category === "geospatial" ? "geoespacial" : category === "document" ? "documento" : category === "image" ? "imagem" : ""} ${uploadFile.file.name} enviado em ${new Date().toLocaleDateString("pt-BR")}`;
        
        // Resultado real da mutação; nunca tentar o upload genérico após falha raster.
        const uploadPromise = policy.route === "raster"
          ? rasterIngestMutation.mutateAsync({
              projectId,
              filename: uploadFile.file.name,
              mimeType: mimeType as "image/tiff" | "image/geotiff" | "application/geotiff",
              size: uploadFile.file.size,
              fileData,
              name: policy.rasterName,
              description: autoDescription,
              acquisitionAt: new Date().toISOString(),
              sourceLabel: "Upload local autorizado pelo usuário do projeto",
              minZoom: 12,
              maxZoom: 14,
              nodata: 0,
              resampling: "cubic" as const,
            })
          : uploadMutation.mutateAsync({
              projectId,
              filename: uploadFile.file.name,
              mimeType: policy.genericMime,
              size: uploadFile.file.size,
              fileData,
              category,
              description: autoDescription,
              tags: [category, uploadFile.file.name.split(".").pop() || "arquivo"],
            });

        // Aguardar imediatamente para capturar também rejeições rápidas.
        await uploadPromise;

        // Marcar como 100% e sucesso
        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.file === uploadFile.file ? { ...f, progress: 100 } : f
          )
        );

        await new Promise((resolve) => setTimeout(resolve, 300));

        // Marcar como sucesso
        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.file === uploadFile.file ? { ...f, status: "success" } : f
          )
        );

        toast.success(policy.isTiff && policy.route === "generic"
          ? `${uploadFile.file.name}: original armazenado; raster/COG não processado.`
          : `${uploadFile.file.name} enviado com sucesso!`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao enviar arquivo";
        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.file === uploadFile.file
              ? { ...f, status: "error", error: message }
              : f
          )
        );
        toast.error(`${uploadFile.file.name}: ${message}`);
      }
    }

    // Limpar arquivos concluídos após 2 segundos
    setTimeout(() => {
      setUploadingFiles((prev) => prev.filter((f) => f.status === "uploading"));
      if (onUploadComplete) onUploadComplete();
    }, 2000);
  };

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    handleFiles(files);
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
  };

  const removeFile = (file: File) => {
    setUploadingFiles((prev) => prev.filter((f) => f.file !== file));
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith("image/")) return <ImageIcon className="w-5 h-5" />;
    if (mimeType === "application/pdf") return <FileText className="w-5 h-5" />;
    return <File className="w-5 h-5" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
  };

  return (
    <div className="space-y-4">
      <div className="rounded border p-3 space-y-2">
        <label className="text-sm font-medium" htmlFor={`tiff-mode-${projectId}`}>Tratamento dos arquivos TIFF / GeoTIFF</label>
        <select id={`tiff-mode-${projectId}`} data-testid="tiff-upload-mode" className="block w-full rounded border bg-background text-foreground p-2 text-sm" value={tiffMode} onChange={(event) => setTiffMode(event.target.value as TiffUploadMode)} disabled={uploadingFiles.some((file) => file.status === "uploading")}>
          <option value="raster">Processar como raster / COG (requer serviço disponível)</option>
          <option value="original">Guardar somente o TIFF original (sem camada raster / COG)</option>
        </select>
        <p className="text-xs text-muted-foreground">{tiffMode === "original"
          ? "O original é armazenado como imagem, com scanner e controle de acesso normais. Não cria camada, tiles nem georreferenciamento."
          : availabilityLoading ? "Verificando disponibilidade do serviço raster…"
            : rasterAvailability?.available ? "Serviço raster disponível. O servidor valida e processa o arquivo."
              : `${rasterAvailability?.reason || "Ingestão raster indisponível."} Você pode escolher guardar somente o original. Não há conversão automática para esse modo.`}</p>
      </div>
      {/* Área de Drop */}
      <Card
        className={`border-2 border-dashed transition-colors ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-slate-300 dark:border-slate-700"
        }`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="p-8 text-center">
          <Upload className="w-12 h-12 mx-auto mb-4 text-slate-400" />
          <p className="text-lg font-medium text-slate-900 dark:text-slate-50 mb-2">
            Arraste arquivos aqui
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
            ou clique no botão abaixo para selecionar
          </p>
          <Button
            onClick={() => fileInputRef.current?.click()}
            variant="outline"
          >
            Selecionar Arquivos
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept={acceptedTypes.join(",")}
            onChange={handleFileInputChange}
          />
          <p className="text-xs text-slate-500 dark:text-slate-500 mt-4">
            Tipos aceitos: KML, KMZ, SHP (ZIP), GeoTIFF/COG, PDF, DOCX, XLSX, Imagens
            <br />
            Tamanho máximo: {maxSizeMB}MB por arquivo
          </p>
        </div>
      </Card>

      {/* Lista de Arquivos em Upload */}
      {uploadingFiles.length > 0 && (
        <div className="space-y-3">
          {uploadingFiles.map((uploadFile, index) => (
            <Card key={index} className="p-4">
              <div className="flex items-start gap-3">
                <div className="text-slate-600 dark:text-slate-400">
                  {getFileIcon(uploadFile.file.type)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-50 truncate">
                      {uploadFile.file.name}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => removeFile(uploadFile.file)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
                    {formatFileSize(uploadFile.file.size)}
                  </p>

                  {uploadFile.status === "uploading" && (
                    <Progress value={uploadFile.progress} className="h-2" />
                  )}

                  {uploadFile.status === "success" && (
                    <p className="text-xs text-green-600 dark:text-green-400">
                      ✓ Upload concluído
                    </p>
                  )}

                  {uploadFile.status === "error" && (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      ✗ {uploadFile.error}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
