import { useState } from "react";
import GisUploader from "@/components/GisUploader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { FileIcon, Trash2, Download, Loader2 } from "lucide-react";

export default function GisUploads() {
  const { data: uploads, isLoading, refetch } = trpc.gisUploads.list.useQuery({});
  const deleteMutation = trpc.gisUploads.delete.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  const handleDelete = async (id: number) => {
    if (confirm("Tem certeza que deseja excluir este arquivo?")) {
      await deleteMutation.mutateAsync({ id });
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      pending: "secondary",
      processing: "default",
      completed: "default",
      failed: "destructive",
    };

    const labels: Record<string, string> = {
      pending: "Pendente",
      processing: "Processando",
      completed: "Concluído",
      failed: "Falhou",
    };

    return (
      <Badge variant={variants[status] || "outline"}>
        {labels[status] || status}
      </Badge>
    );
  };

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Histórico de uploads GIS legados</h1>
        <p className="text-muted-foreground">
          Registros anteriores não são automaticamente camadas de projeto. Novos envios devem ser feitos em Projeto → Arquivos.
        </p>
      </div>

      <GisUploader />

      <Card>
        <CardHeader>
          <CardTitle>Registros anteriores</CardTitle>
          <CardDescription>
            O histórico é preservado; arquivos sem vínculo de projeto não podem ser abertos como camada de mapa.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : uploads && uploads.length > 0 ? (
            <div className="space-y-3">
              {uploads.map((upload) => (
                <div
                  key={upload.id}
                  className="border rounded-lg p-4 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <FileIcon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium truncate">
                          {upload.originalName}
                        </span>
                        {getStatusBadge(upload.status)}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span>{upload.fileType.toUpperCase()}</span>
                        <span>
                          {(upload.fileSize / 1024 / 1024).toFixed(2)} MB
                        </span>
                        <span>
                          {new Date(upload.createdAt).toLocaleDateString("pt-BR")}
                        </span>
                      </div>
                      {upload.metadata && typeof upload.metadata === 'object' ? (
                        <div className="mt-2 text-xs text-muted-foreground">
                          {(upload.metadata as any).featureCount && (
                            <span className="mr-3">
                              {(upload.metadata as any).featureCount} features
                            </span>
                          )}
                          {(upload.metadata as any).crs && (
                            <span className="mr-3">CRS: {(upload.metadata as any).crs}</span>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {upload.status === "completed" && (
                      <>
                        {upload.s3Url.includes("storage.example.com") ? <Badge variant="outline">URL de teste indisponível</Badge> : <Button variant="outline" size="sm" onClick={() => window.open(upload.s3Url, "_blank")}><Download className="h-4 w-4" /></Button>}
                      </>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(upload.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <FileIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Nenhum arquivo enviado ainda</p>
              <p className="text-sm">Use o formulário acima para fazer upload</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
