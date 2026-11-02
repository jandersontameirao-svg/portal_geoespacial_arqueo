import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Upload, FileIcon, CheckCircle, XCircle, AlertTriangle, Loader2, ArrowRight } from "lucide-react";
import { Link } from "wouter";

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

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    // Este componente histórico não possui contexto obrigatório de projeto e
    // anteriormente criava URL simulada. Para não registrar upload fictício,
    // mantém o feedback local e encaminha o usuário ao fluxo integrado.
    const newFiles: UploadedFile[] = acceptedFiles.map((file) => ({
      file,
      status: "failed",
      progress: 100,
      error: "Envie este arquivo dentro de um Projeto, na aba Arquivos. O upload legado não grava bytes nem cria camadas.",
    }));

    setUploadedFiles((prev) => [...prev, ...newFiles]);
  }, []);

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
          <CardTitle>Upload GIS legado</CardTitle>
          <CardDescription>
            Esta tela preserva o histórico de uploads GIS anterior, mas não aceita novos envios: ela não possui contexto obrigatório de projeto e não pode criar uma URL fictícia.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert className="mb-4"><AlertTriangle className="h-4 w-4" /><AlertDescription>Para upload, validação, camada e análise vinculados, abra um projeto e use a aba <strong>Arquivos</strong>.</AlertDescription></Alert>
          <Button asChild className="mb-4"><Link href="/projects">Abrir Projetos<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
              isDragActive
                ? "border-amber-500 bg-amber-50"
                : "border-border bg-muted/30"
            }`}
          >
            <input {...getInputProps({ "aria-label": "Upload legado desativado" })} />
            <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            {isDragActive ? (
              <p className="text-lg font-medium">O arquivo não será enviado nesta tela.</p>
            ) : (
              <>
                <p className="text-lg font-medium mb-2">Fluxo legado desativado para novos envios</p>
                <p className="text-sm text-muted-foreground">
                  Use Projeto → Arquivos para persistir e criar camadas vetoriais ou raster.
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
