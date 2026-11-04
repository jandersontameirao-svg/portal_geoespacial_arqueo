import { useMemo, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Plus, MessageSquarePlus, Sparkles, Trash2, X, ImagePlus } from "lucide-react";

const CATEGORIAS = [
  { value: "reclamacao", label: "Reclamação" },
  { value: "melhoria", label: "Melhoria" },
  { value: "bug", label: "Bug" },
  { value: "caracteristica", label: "Característica" },
] as const;

type Categoria = (typeof CATEGORIAS)[number]["value"];
type Status = "aberta" | "em_analise" | "resolvida";

const MAX_IMAGENS = 6;
const MAX_IMG_BYTES = 1_500_000; // ~1,5 MB por print

const categoriaBadge: Record<Categoria, string> = {
  reclamacao: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  melhoria: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  bug: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  caracteristica: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
};

const statusBadge: Record<Status, { label: string; className: string }> = {
  aberta: { label: "Aberta", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  em_analise: { label: "Em análise", className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  resolvida: { label: "Resolvida", className: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
};

function readImageFile(file: File): Promise<{ url: string; name: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ url: String(reader.result), name: file.name || "print.png" });
    reader.onerror = () => reject(new Error("Falha ao ler a imagem."));
    reader.readAsDataURL(file);
  });
}

export default function Observacoes() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "editor";

  const [open, setOpen] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState<Categoria>("melhoria");
  const [area, setArea] = useState("");
  const [imagens, setImagens] = useState<Array<{ url: string; name: string }>>([]);
  const [ideia, setIdeia] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { data: observacoes, isLoading, refetch } = trpc.observacoes.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const resetForm = () => {
    setTitulo("");
    setDescricao("");
    setCategoria("melhoria");
    setArea("");
    setImagens([]);
    setIdeia("");
  };

  const createMutation = trpc.observacoes.create.useMutation({
    onSuccess: () => {
      toast.success("Observação registrada.");
      setOpen(false);
      resetForm();
      refetch();
    },
    onError: (e) => toast.error(e.message || "Erro ao registrar observação."),
  });

  const organizar = trpc.observacoes.organizarComAtena.useMutation({
    onSuccess: (draft) => {
      if (draft.titulo) setTitulo(draft.titulo);
      if (draft.descricao) setDescricao(draft.descricao);
      if (draft.categoria) setCategoria(draft.categoria as Categoria);
      if (draft.area) setArea(draft.area);
      toast.success("A Atena organizou sua ideia. Revise e salve.");
    },
    onError: (e) => toast.error(e.message || "Não foi possível organizar com a Atena."),
  });

  const updateStatus = trpc.observacoes.updateStatus.useMutation({
    onSuccess: () => refetch(),
    onError: (e) => toast.error(e.message || "Erro ao atualizar status."),
  });

  const deleteMutation = trpc.observacoes.delete.useMutation({
    onSuccess: () => {
      toast.success("Observação excluída.");
      refetch();
    },
    onError: (e) => toast.error(e.message || "Erro ao excluir."),
  });

  const addImages = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) return;
    const remaining = MAX_IMAGENS - imagens.length;
    if (remaining <= 0) {
      toast.error(`Máximo de ${MAX_IMAGENS} imagens.`);
      return;
    }
    const picked = list.slice(0, remaining);
    const tooBig = picked.find((f) => f.size > MAX_IMG_BYTES);
    if (tooBig) {
      toast.error("Cada imagem deve ter até 1,5 MB.");
      return;
    }
    try {
      const read = await Promise.all(picked.map(readImageFile));
      setImagens((cur) => [...cur, ...read]);
    } catch {
      toast.error("Falha ao anexar imagem.");
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      void addImages(files);
    }
  };

  const submit = () => {
    if (!titulo.trim() || !descricao.trim()) {
      toast.error("Preencha título e descrição.");
      return;
    }
    createMutation.mutate({
      titulo: titulo.trim(),
      descricao: descricao.trim(),
      categoria,
      area: area.trim() || undefined,
      imagens: imagens.length > 0 ? imagens : undefined,
    });
  };

  const grouped = useMemo(() => observacoes ?? [], [observacoes]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Acesso Restrito</CardTitle>
            <CardDescription>Faça login para acessar as observações.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container py-8">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
              <MessageSquarePlus className="h-8 w-8 text-orange-500" />
              Observações
            </h1>
            <p className="text-slate-600 dark:text-slate-400 mt-2">
              Reclamações, bugs, melhorias e ideias sobre o sistema — um backlog interno.
            </p>
          </div>

          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
            <DialogTrigger asChild>
              <Button size="lg" className="gap-2">
                <Plus className="w-5 h-5" />
                Nova observação
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Registrar observação</DialogTitle>
                <DialogDescription>
                  Descreva o problema ou a ideia. Você pode colar um print (Ctrl+V) no campo de descrição.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="rounded-lg border border-dashed border-orange-300 bg-orange-50/50 dark:bg-orange-900/10 p-3 space-y-2">
                  <Label className="flex items-center gap-2 text-sm">
                    <Sparkles className="h-4 w-4 text-orange-500" />
                    Organizar com a Atena (opcional)
                  </Label>
                  <Textarea
                    value={ideia}
                    onChange={(e) => setIdeia(e.target.value)}
                    placeholder="Escreva a ideia solta, ex.: 'tá difícil achar o botão de salvar no mapa'"
                    rows={2}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={organizar.isPending || ideia.trim().length < 3}
                    onClick={() => organizar.mutate({ ideia: ideia.trim() })}
                  >
                    {organizar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    Organizar e preencher
                  </Button>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="obs-titulo">Título</Label>
                  <Input id="obs-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={255} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Categoria</Label>
                    <Select value={categoria} onValueChange={(v) => setCategoria(v as Categoria)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CATEGORIAS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="obs-area">Área (opcional)</Label>
                    <Input id="obs-area" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Mapa, Projetos, Login…" maxLength={120} />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="obs-desc">Descrição</Label>
                  <Textarea id="obs-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} onPaste={onPaste} rows={5} placeholder="Contexto, comportamento esperado e como reproduzir. Cole prints com Ctrl+V." />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Imagens ({imagens.length}/{MAX_IMAGENS})</Label>
                    <Button type="button" variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} disabled={imagens.length >= MAX_IMAGENS}>
                      <ImagePlus className="mr-1 h-4 w-4" /> Anexar
                    </Button>
                    <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { if (e.target.files) void addImages(e.target.files); e.target.value = ""; }} />
                  </div>
                  {imagens.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {imagens.map((img, i) => (
                        <div key={i} className="relative">
                          <img src={img.url} alt={img.name} className="h-16 w-16 rounded border object-cover" />
                          <button type="button" onClick={() => setImagens((cur) => cur.filter((_, idx) => idx !== i))} className="absolute -right-1 -top-1 rounded-full bg-slate-900/80 p-0.5 text-white" aria-label="Remover imagem">
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => { setOpen(false); resetForm(); }}>Cancelar</Button>
                <Button onClick={submit} disabled={createMutation.isPending}>
                  {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Salvar observação
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : grouped.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-slate-500">Nenhuma observação registrada ainda.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {grouped.map((obs) => {
              const st = statusBadge[obs.status as Status];
              const imgs = (obs.imagens as Array<{ url: string; name: string }> | null) ?? [];
              return (
                <Card key={obs.id}>
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-base">{obs.titulo}</CardTitle>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <Badge className={categoriaBadge[obs.categoria as Categoria]}>
                            {CATEGORIAS.find((c) => c.value === obs.categoria)?.label || obs.categoria}
                          </Badge>
                          <Badge className={st.className}>{st.label}</Badge>
                          {obs.area && <span className="text-xs text-slate-500">· {obs.area}</span>}
                          <span className="text-xs text-slate-400">
                            {obs.criadoPorNome || "—"} · {new Date(obs.createdAt).toLocaleDateString("pt-BR")}
                          </span>
                        </div>
                      </div>
                      {canManage && (
                        <div className="flex items-center gap-1">
                          <Select value={obs.status} onValueChange={(v) => updateStatus.mutate({ id: obs.id, status: v as Status })}>
                            <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="aberta">Aberta</SelectItem>
                              <SelectItem value="em_analise">Em análise</SelectItem>
                              <SelectItem value="resolvida">Resolvida</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { if (confirm("Excluir esta observação?")) deleteMutation.mutate({ id: obs.id }); }}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{obs.descricao}</p>
                    {imgs.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {imgs.map((img, i) => (
                          <a key={i} href={img.url} target="_blank" rel="noreferrer">
                            <img src={img.url} alt={img.name} className="h-20 w-20 rounded border object-cover" />
                          </a>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
