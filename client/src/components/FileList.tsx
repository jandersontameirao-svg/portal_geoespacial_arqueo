import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { 
  FileText, 
  Image as ImageIcon, 
  File, 
  Download, 
  Trash2, 
  Eye, 
  MapPin,
  FileArchive,
  History,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import MapViewer from "@/components/MapViewer";

interface FileListProps {
  projectId: number;
  canEdit?: boolean;
}

function FileVersionHistory({ fileId, currentVersion }: { fileId: number; currentVersion: number }) {
  const { data: versions, isLoading } = trpc.files.versions.useQuery({ fileId });
  const downloadVersion = trpc.files.downloadVersion.useMutation({
    onSuccess: (data) => {
      window.open(data.url, "_blank");
      toast.success(`Download da versão iniciado${data.sha256 ? " com hash registrado" : ""}`);
    },
    onError: (error) => toast.error(error.message || "Não foi possível baixar a versão"),
  });

  return (
    <details className="mt-3 rounded border border-dashed p-2 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-slate-600 dark:text-slate-300"><History className="h-3.5 w-3.5" />Histórico de versões · atual v{currentVersion}</summary>
      <div className="mt-2 space-y-2">
        {isLoading ? <span className="text-muted-foreground">Carregando versões...</span> : !versions?.length ? <span className="text-muted-foreground">Sem versão registrada. Arquivos antigos permanecem preservados, mas precisam de migração de inventário.</span> : versions.map((version) => <div key={version.id} className="flex items-center justify-between gap-2 rounded bg-muted/40 p-2"><span className="min-w-0"><span className="flex items-center gap-1 font-medium"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />v{version.version}</span><span className="block truncate text-[11px] text-muted-foreground" title={version.sha256 || undefined}>{version.sha256 ? `SHA-256 ${version.sha256.slice(0, 12)}…` : "Checksum histórico indisponível"}</span></span><Button size="sm" variant="ghost" className="h-7 px-2" disabled={downloadVersion.isPending} onClick={() => downloadVersion.mutate({ fileId, version: version.version })}>Baixar</Button></div>)}
      </div>
    </details>
  );
}

export default function FileList({ projectId, canEdit = false }: FileListProps) {
  const [viewerFile, setViewerFile] = useState<{ url: string; name: string; type: "kml" | "kmz" } | null>(null);

  const { data: files, isLoading, refetch } = trpc.files.list.useQuery(
    { projectId },
    { enabled: projectId > 0 }
  );

  const downloadMutation = trpc.files.download.useMutation({
    onSuccess: (data) => {
      // Abrir URL em nova aba para download
      window.open(data.url, "_blank");
      toast.success("Download iniciado!");
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao fazer download");
    },
  });

  const deleteMutation = trpc.files.delete.useMutation({
    onSuccess: () => {
      toast.success("Arquivo excluído com sucesso!");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao excluir arquivo");
    },
  });

  const getFileIcon = (fileType: string) => {
    switch (fileType) {
      case "kml":
      case "kmz":
        return <MapPin className="w-8 h-8 text-blue-500" />;
      case "shp":
        return <FileArchive className="w-8 h-8 text-purple-500" />;
      case "pdf":
        return <FileText className="w-8 h-8 text-red-500" />;
      case "docx":
        return <FileText className="w-8 h-8 text-blue-600" />;
      case "xlsx":
        return <FileText className="w-8 h-8 text-green-600" />;
      case "image":
        return <ImageIcon className="w-8 h-8 text-pink-500" />;
      default:
        return <File className="w-8 h-8 text-slate-400" />;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDownload = (fileId: number) => {
    downloadMutation.mutate({ id: fileId });
  };

  const handleDelete = (fileId: number, fileName: string) => {
    if (confirm(`Tem certeza que deseja excluir o arquivo "${fileName}"?`)) {
      deleteMutation.mutate({ id: fileId });
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-8">
        <p className="text-slate-600 dark:text-slate-400">Carregando arquivos...</p>
      </div>
    );
  }

  if (!files || files.length === 0) {
    return (
      <div className="text-center py-12">
        <FileText className="w-16 h-16 text-slate-300 dark:text-slate-700 mx-auto mb-4" />
        <p className="text-slate-600 dark:text-slate-400 mb-2">Nenhum arquivo enviado ainda</p>
        <p className="text-sm text-slate-500 dark:text-slate-500">
          Use o formulário acima para fazer upload de arquivos
        </p>
      </div>
    );
  }

  return (
    <>
      {viewerFile && (
        <MapViewer
          fileUrl={viewerFile.url}
          fileName={viewerFile.name}
          fileType={viewerFile.type}
          isOpen={true}
          onClose={() => setViewerFile(null)}
        />
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {files.map((file) => (
        <Card key={file.id} className="hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">{getFileIcon(file.fileType)}</div>
              
              <div className="flex-1 min-w-0">
                <h4 className="font-medium text-sm text-slate-900 dark:text-slate-50 truncate">
                  {file.name}
                </h4>
                
                <div className="mt-1 space-y-1">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatFileSize(file.fileSize)}
                  </p>
                  
                  {file.uploadedAt && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {format(new Date(file.uploadedAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                    </p>
                  )}
                  
                  {file.isGeospatial && (
                    <span className="inline-block px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded">
                      Geoespacial
                    </span>
                  )}
                  <span className="inline-block px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 rounded">v{file.currentVersion}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => handleDownload(file.id)}
                disabled={downloadMutation.isPending}
              >
                <Download className="w-3 h-3 mr-1" />
                Download
              </Button>

              {file.isGeospatial && (file.fileType === "kml" || file.fileType === "kmz") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setViewerFile({ url: file.s3Url, name: file.name, type: file.fileType as "kml" | "kmz" })}
                  title="Visualizar no mapa"
                >
                  <Eye className="w-3 h-3" />
                </Button>
              )}

              {canEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDelete(file.id, file.name)}
                  disabled={deleteMutation.isPending}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              )}
            </div>
            <FileVersionHistory fileId={file.id} currentVersion={file.currentVersion} />
          </CardContent>
        </Card>
      ))}
      </div>
    </>
  );
}
