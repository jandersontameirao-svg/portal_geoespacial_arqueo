import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { getFileCategory } from "@shared/fileTypeCategories";
import { 
  ArrowLeft, 
  Search, 
  Download, 
  Trash2, 
  FileText, 
  Image as ImageIcon, 
  Map as MapIcon,
  File,
  Filter,
  RefreshCw,
  FolderOpen,
  ExternalLink
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function Files() {
  const { user, isAuthenticated } = useAuth();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [fileToDelete, setFileToDelete] = useState<number | null>(null);

  // Query para listar arquivos
  const { data: files, isLoading, refetch } = trpc.files.listAll.useQuery(
    { category: category as any, search: search || undefined },
    { enabled: isAuthenticated }
  );

  // Mutation para download
  const downloadMutation = trpc.files.download.useMutation({
    onSuccess: (data) => {
      window.open(data.url, "_blank");
      toast.success("Download iniciado");
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao baixar arquivo");
    },
  });

  // Mutation para deletar
  const deleteMutation = trpc.files.delete.useMutation({
    onSuccess: () => {
      toast.success("Arquivo excluído com sucesso");
      refetch();
      setFileToDelete(null);
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao excluir arquivo");
    },
  });

  const handleDownload = (fileId: number) => {
    downloadMutation.mutate({ id: fileId });
  };

  const handleDelete = () => {
    if (fileToDelete) {
      deleteMutation.mutate({ id: fileToDelete });
    }
  };

  const getFileIcon = (fileType: string) => {
    switch (getFileCategory(fileType)) {
      case "geospatial":
        return <MapIcon className="w-5 h-5 text-green-500" />;
      case "document":
        return <FileText className="w-5 h-5 text-blue-500" />;
      case "image":
        return <ImageIcon className="w-5 h-5 text-purple-500" />;
      default:
        return <File className="w-5 h-5 text-slate-500" />;
    }
  };

  const getCategoryBadge = (fileType: string) => {
    switch (getFileCategory(fileType)) {
      case "geospatial":
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Geoespacial</Badge>;
      case "document":
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Documento</Badge>;
      case "image":
        return <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">Imagem</Badge>;
      default:
        return <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">Outro</Badge>;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Você precisa estar autenticado para acessar esta página.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <div className="container py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
              <FolderOpen className="w-8 h-8 text-purple-500" />
              Repositório de Arquivos
            </h1>
            <p className="text-slate-600 dark:text-slate-400 mt-1">
              Gerencie todos os arquivos dos seus projetos
            </p>
          </div>
        </div>

        {/* Filtros */}
        <Card className="mb-6">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Filter className="w-5 h-5" />
              Filtros
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="Buscar por nome do arquivo..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue placeholder="Categoria" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as categorias</SelectItem>
                  <SelectItem value="geospatial">Geoespacial (KML, SHP, GeoJSON, GeoTIFF)</SelectItem>
                  <SelectItem value="document">Documentos (PDF, DOCX)</SelectItem>
                  <SelectItem value="image">Imagens</SelectItem>
                  <SelectItem value="other">Outros</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => refetch()}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Atualizar
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Tabela de Arquivos */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Arquivos ({files?.length || 0})</span>
            </CardTitle>
            <CardDescription>
              Lista de todos os arquivos acessíveis nos seus projetos
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-16 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
                ))}
              </div>
            ) : files && files.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Arquivo</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead>Projeto</TableHead>
                      <TableHead>Tamanho</TableHead>
                      <TableHead>Data de Upload</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {files.map((file) => (
                      <TableRow key={file.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            {getFileIcon(file.fileType)}
                            <div>
                              <p className="font-medium text-slate-900 dark:text-white">
                                {file.name}
                              </p>

                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{getCategoryBadge(file.fileType)}</TableCell>
                        <TableCell>
                          <Link href={`/projects/${file.projectId}`}>
                            <span className="text-orange-600 hover:underline cursor-pointer flex items-center gap-1">
                              {file.projectName || `Projeto #${file.projectId}`}
                              <ExternalLink className="w-3 h-3" />
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell>{formatFileSize(file.size)}</TableCell>
                        <TableCell>{formatDate(file.uploadedAt)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDownload(file.id)}
                              disabled={downloadMutation.isPending}
                              title="Download"
                            >
                              <Download className="w-4 h-4" />
                            </Button>
                            {(user?.role === "admin" || user?.role === "editor") && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                    onClick={() => setFileToDelete(file.id)}
                                    title="Excluir"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Tem certeza que deseja excluir o arquivo "{file.name}"? 
                                      Esta ação não pode ser desfeita.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel onClick={() => setFileToDelete(null)}>
                                      Cancelar
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={handleDelete}
                                      className="bg-red-500 hover:bg-red-600"
                                    >
                                      Excluir
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-12">
                <FolderOpen className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">
                  Nenhum arquivo encontrado
                </h3>
                <p className="text-slate-500 dark:text-slate-400 mb-4">
                  {search || category !== "all"
                    ? "Tente ajustar os filtros de busca"
                    : "Faça upload de arquivos nos seus projetos para vê-los aqui"}
                </p>
                <Link href="/projects">
                  <Button>
                    <FolderOpen className="w-4 h-4 mr-2" />
                    Ver Projetos
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
