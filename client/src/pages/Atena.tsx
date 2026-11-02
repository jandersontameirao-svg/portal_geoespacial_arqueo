import { useLocation, useSearch } from "wouter";
import { Sparkles } from "lucide-react";
import AtenaPanel from "@/components/AtenaPanel";
import { atenaNavigationPath, parseAtenaProjectId } from "@/lib/atenaChatCommands";

/** O shell/Header e o registro /atena pertencem ao integrador, não a esta página. */
export default function Atena() {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const candidate = parseAtenaProjectId(location, search);
  const malformed = new URLSearchParams(search).has("projectId") && candidate == null;
  return <main className="min-h-screen bg-muted/20">
    <div className="container max-w-5xl space-y-6 py-8">
      <header className="space-y-2"><h1 className="flex items-center gap-3 text-3xl font-bold"><Sparkles className="h-7 w-7 text-primary" /> Atena</h1><p className="max-w-3xl text-muted-foreground">Análises GIS com pedido estruturado, plano revisável, confirmação explícita e histórico. Gere prévias de áreas de influência, unidades de prospecção e PDFs a partir dos dados autorizados do projeto.</p></header>
      <div role="note" className="rounded-lg border bg-card p-4 text-sm">A disponibilidade da interpretação, dos modelos e das fontes oficiais é informada pelo servidor. Fonte bloqueada não é substituída por dados simulados. Nenhum pedido é executado automaticamente.</div>
      {malformed && <p role="alert" className="rounded border border-amber-300 p-3 text-sm text-amber-800">Parâmetro de projeto inválido. Selecione um projeto autorizado abaixo; nenhum ID da URL foi consultado.</p>}
      <AtenaPanel initialProjectId={candidate} embedded onProjectChange={id => navigate(atenaNavigationPath("atena", id), { replace: true })} />
    </div>
  </main>;
}
