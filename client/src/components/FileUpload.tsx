import { useState, useRef, DragEvent, ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Upload, X, FileText, Image as ImageIcon, File } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

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
  // Documentos
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  // Imagens
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "image/tiff": [".tif", ".tiff"],
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

  const uploadMutation = trpc.files.upload.useMutation();

  const validateFile = (file: File): string | null => {
    // Validar tamanho
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      return `Arquivo muito grande. Tamanho máximo: ${maxSizeMB}MB`;
    }

    // Validar tipo
    if (!acceptedTypes.includes(file.type)) {
      return "Tipo de arquivo não permitido";
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
        const base64Promise = new Promise<string>((resolve) => {
          reader.onload = () => {
            const base64 = (reader.result as string).split(",")[1];
            resolve(base64);
          };
          reader.readAsDataURL(uploadFile.file);
        });

        const fileData = await base64Promise;

        // Determinar categoria
        let category: "geospatial" | "document" | "image" | "other" = "other";
        if (
          uploadFile.file.type.includes("kml") ||
          uploadFile.file.type.includes("kmz") ||
          uploadFile.file.type.includes("zip")
        ) {
          category = "geospatial";
        } else if (
          uploadFile.file.type.includes("pdf") ||
          uploadFile.file.type.includes("word") ||
          uploadFile.file.type.includes("sheet")
        ) {
          category = "document";
        } else if (uploadFile.file.type.startsWith("image/")) {
          category = "image";
        }

        // Atualizar progresso para 50% (preparando)
        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.file === uploadFile.file ? { ...f, progress: 50 } : f
          )
        );

        // Upload via tRPC (sem await para simular progresso)
        const uploadPromise = uploadMutation.mutateAsync({
          projectId,
          filename: uploadFile.file.name,
          mimeType: uploadFile.file.type,
          size: uploadFile.file.size,
          fileData,
          category,
        });

        // Simular progresso enquanto faz upload
        for (let progress = 50; progress <= 90; progress += 10) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          setUploadingFiles((prev) =>
            prev.map((f) =>
              f.file === uploadFile.file ? { ...f, progress } : f
            )
          );
        }

        // Aguardar conclusão do upload
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

        toast.success(`${uploadFile.file.name} enviado com sucesso!`);
      } catch (error) {
        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.file === uploadFile.file
              ? { ...f, status: "error", error: "Erro ao enviar arquivo" }
              : f
          )
        );
        toast.error(`Erro ao enviar ${uploadFile.file.name}`);
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
            Tipos aceitos: KML, KMZ, SHP (ZIP), PDF, DOCX, XLSX, Imagens
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
