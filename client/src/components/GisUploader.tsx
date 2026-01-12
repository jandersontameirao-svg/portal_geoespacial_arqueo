import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Upload, FileIcon, CheckCircle, XCircle, AlertTriangle, Loader2 } from "lucide-react";
import { storagePut } from "../../../server/storage";

interface UploadedFile {
  file: File;
  status: "pending" | "uploading" | "validating" | "completed" | "failed";
  progress: number;
  uploadId?: number;
  validationResult?: {
    isValid: boolean;
    errors?: string[];
    warnings?: string[];
    metadata?: {
      crs?: string;
      bounds?: number[];
      featureCount?: number;
      geometryTypes?: string[];
      attributes?: string[];
    };
  };
  error?: string;
}

const ACCEPTED_FORMATS = {
  "application/vnd.google-earth.kml+xml": [".kml"],
  "application/vnd.google-earth.kmz": [".kmz"],
  "application/geo+json": [".geojson", ".json"],
  "application/gpx+xml": [".gpx"],
  "application/gml+xml": [".gml"],
  "application/dxf": [".dxf"],
  "application/zip": [".zip"], // Para shapefiles
};

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export default function GisUploader() {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);

  const initiateMutation = trpc.gisUploads.initiate.useMutation();
  const confirmMutation = trpc.gisUploads.confirm.useMutation();

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const newFiles: UploadedFile[] = acceptedFiles.map((file) => ({
      file,
      status: "pending",
      progress: 0,
    }));

    setUploadedFiles((prev) => [...prev, ...newFiles]);

    // Processar cada arquivo
    for (let i = 0; i < newFiles.length; i++) {
      const fileIndex = uploadedFiles.length + i;
      await processFile(newFiles[i], fileIndex);
    }
  }, [uploadedFiles.length]);

  const processFile = async (uploadedFile: UploadedFile, index: number) => {
    const { file } = uploadedFile;

    try {
      // Determinar tipo de arquivo
      const extension = file.name.split(".").pop()?.toLowerCase();
      let fileType: "shp" | "kml" | "kmz" | "geojson" | "gpx" | "gml" | "dxf";

      if (extension === "zip") {
        fileType = "shp";
      } else if (["kml", "kmz", "geojson", "json", "gpx", "gml", "dxf"].includes(extension || "")) {
        fileType = extension === "json" ? "geojson" : (extension as any);
      } else {
        throw new Error(`Formato não suportado: ${extension}`);
      }

      // Atualizar status: uploading
      updateFileStatus(index, { status: "uploading", progress: 10 });

      // Iniciar upload
      const { uploadId, s3Key } = await initiateMutation.mutateAsync({
        filename: file.name,
        fileType,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
      });

      updateFileStatus(index, { uploadId, progress: 30 });

      // Ler conteúdo do arquivo
      const fileContent = await readFileAsText(file);

      updateFileStatus(index, { progress: 50 });

      // Fazer upload para S3 (simulado - na prática usar storagePut)
      // const { url } = await storagePut(s3Key, fileContent, file.type);
      const url = `https://storage.example.com/${s3Key}`; // Simulado

      updateFileStatus(index, { status: "validating", progress: 70 });

      // Confirmar upload e validar com IA
      const { validationResult } = await confirmMutation.mutateAsync({
        uploadId,
        s3Url: url,
        fileContent: fileContent.substring(0, 50000), // Truncar para análise
      });

      updateFileStatus(index, {
        status: validationResult.isValid ? "completed" : "failed",
        progress: 100,
        validationResult,
        error: validationResult.isValid ? undefined : validationResult.errors?.join(", "),
      });
    } catch (error: any) {
      updateFileStatus(index, {
        status: "failed",
        progress: 100,
        error: error.message,
      });
    }
  };

  const updateFileStatus = (index: number, updates: Partial<UploadedFile>) => {
    setUploadedFiles((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...updates } : f))
    );
  };

  const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_FORMATS,
    maxSize: MAX_FILE_SIZE,
    multiple: true,
  });

  const getStatusIcon = (status: UploadedFile["status"]) => {
    switch (status) {
      case "pending":
      case "uploading":
      case "validating":
        return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
      case "completed":
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case "failed":
        return <XCircle className="h-5 w-5 text-red-500" />;
    }
  };

  const getStatusBadge = (status: UploadedFile["status"]) => {
    const variants: Record<UploadedFile["status"], "default" | "secondary" | "destructive" | "outline"> = {
      pending: "secondary",
      uploading: "default",
      validating: "default",
      completed: "default",
      failed: "destructive",
    };

    const labels: Record<UploadedFile["status"], string> = {
      pending: "Pendente",
      uploading: "Enviando",
      validating: "Validando",
      completed: "Concluído",
      failed: "Falhou",
    };

    return <Badge variant={variants[status]}>{labels[status]}</Badge>;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload de Arquivos GIS</CardTitle>
          <CardDescription>
            Arraste e solte arquivos ou clique para selecionar. Formatos aceitos: SHP (ZIP), KML, KMZ, GeoJSON, GPX, GML, DXF (máx. 100MB)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
              isDragActive
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
          >
            <input {...getInputProps()} />
            <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            {isDragActive ? (
              <p className="text-lg font-medium">Solte os arquivos aqui...</p>
            ) : (
              <>
                <p className="text-lg font-medium mb-2">
                  Arraste arquivos GIS aqui
                </p>
                <p className="text-sm text-muted-foreground">
                  ou clique para selecionar
                </p>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {uploadedFiles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Arquivos ({uploadedFiles.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {uploadedFiles.map((uploadedFile, index) => (
              <div key={index} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1">
                    {getStatusIcon(uploadedFile.status)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <FileIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span className="font-medium truncate">
                          {uploadedFile.file.name}
                        </span>
                        {getStatusBadge(uploadedFile.status)}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {(uploadedFile.file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                </div>

                {(uploadedFile.status === "uploading" || uploadedFile.status === "validating") && (
                  <div className="space-y-2">
                    <Progress value={uploadedFile.progress} />
                    <p className="text-xs text-muted-foreground">
                      {uploadedFile.status === "uploading" ? "Enviando arquivo..." : "Validando com IA..."}
                    </p>
                  </div>
                )}

                {uploadedFile.error && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{uploadedFile.error}</AlertDescription>
                  </Alert>
                )}

                {uploadedFile.validationResult && (
                  <div className="space-y-2 text-sm">
                    {uploadedFile.validationResult.errors && uploadedFile.validationResult.errors.length > 0 && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          <strong>Erros:</strong>
                          <ul className="list-disc list-inside mt-1">
                            {uploadedFile.validationResult.errors.map((error, i) => (
                              <li key={i}>{error}</li>
                            ))}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}

                    {uploadedFile.validationResult.warnings && uploadedFile.validationResult.warnings.length > 0 && (
                      <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          <strong>Avisos:</strong>
                          <ul className="list-disc list-inside mt-1">
                            {uploadedFile.validationResult.warnings.map((warning, i) => (
                              <li key={i}>{warning}</li>
                            ))}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}

                    {uploadedFile.validationResult.metadata && (
                      <div className="bg-muted p-3 rounded space-y-1">
                        <p className="font-medium">Metadados:</p>
                        {uploadedFile.validationResult.metadata.crs && (
                          <p>
                            <strong>CRS:</strong> {uploadedFile.validationResult.metadata.crs}
                          </p>
                        )}
                        {uploadedFile.validationResult.metadata.featureCount !== undefined && (
                          <p>
                            <strong>Features:</strong> {uploadedFile.validationResult.metadata.featureCount}
                          </p>
                        )}
                        {uploadedFile.validationResult.metadata.geometryTypes && (
                          <p>
                            <strong>Tipos de Geometria:</strong>{" "}
                            {uploadedFile.validationResult.metadata.geometryTypes.join(", ")}
                          </p>
                        )}
                        {uploadedFile.validationResult.metadata.bounds && (
                          <p>
                            <strong>Bounds:</strong>{" "}
                            [{uploadedFile.validationResult.metadata.bounds.join(", ")}]
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
