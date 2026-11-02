import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, Plus, RefreshCw, Server, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function OgcCatalog() {
  const { user, isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const { data: services, isLoading } = trpc.ogcCatalog.listServices.useQuery(undefined, { enabled: isAuthenticated && user?.role === "admin" });
  const [name, setName] = useState("");
  const [publisher, setPublisher] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [serviceType, setServiceType] = useState<"wms" | "wfs">("wms");
  const create = trpc.ogcCatalog.createDraft.useMutation({
    onSuccess: async () => { await utils.ogcCatalog.listServices.invalidate(); setName(""); setPublisher(""); setEndpoint(""); toast.success("Rascunho OGC criado. Valide GetCapabilities antes de habilitar."); },
    onError: (error) => toast.error(error.message),
  });
  const validate = trpc.ogcCatalog.validate.useMutation({
    onSuccess: async (result) => { await utils.ogcCatalog.listServices.invalidate(); result.health === "healthy" ? toast.success(`Capabilities válidas: ${result.capabilities?.remoteLayers.length || 0} camada(s) descoberta(s)`) : toast.error(result.details || `Health: ${result.health}`); },
    onError: (error) => toast.error(error.message),
  });

  if (!isAuthenticated || user?.role !== "admin") return <div className="container py-12"><Card className="max-w-lg"><CardHeader><CardTitle>Acesso negado</CardTitle><CardDescription>Somente administradores podem gerenciar serviços OGC.</CardDescription></CardHeader><CardContent><Link href="/"><Button>Voltar</Button></Link></CardContent></Card></div>;

  const healthIcon = (health: string) => health === "healthy" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : health === "tls_error" ? <ShieldCheck className="h-4 w-4 text-red-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />;
  return <div className="container space-y-6 py-8">
    <div className="flex items-start gap-4"><Link href="/admin"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link><div><h1 className="flex items-center gap-2 text-3xl font-bold"><Server className="h-8 w-8 text-blue-600" />Catálogo OGC</h1><p className="mt-1 text-muted-foreground">WMS/WFS com allowlist HTTPS, GetCapabilities e estado de saúde explícito.</p></div></div>
    <Card className="border-amber-200 bg-amber-50/60"><CardContent className="flex gap-3 pt-6 text-sm text-amber-900"><ShieldCheck className="h-5 w-5 shrink-0" /><span>O endpoint precisa pertencer à allowlist do servidor. TLS é estrito: falha de certificado, redirect ou host fora da allowlist não será ignorado nem publicado.</span></CardContent></Card>
    <Card><CardHeader><CardTitle className="text-lg">Novo rascunho</CardTitle><CardDescription>O cadastro não habilita nem substitui fontes existentes. Valide antes de configurar uma variante primária ou fallback.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><div><Label htmlFor="ogc-name">Nome</Label><Input id="ogc-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="ICMBio Unidades de Conservação" /></div><div><Label htmlFor="ogc-publisher">Órgão/publicador</Label><Input id="ogc-publisher" value={publisher} onChange={(event) => setPublisher(event.target.value)} placeholder="ICMBio" /></div><div><Label>Serviço</Label><Select value={serviceType} onValueChange={(value) => setServiceType(value as "wms" | "wfs")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="wms">WMS — imagem de mapa</SelectItem><SelectItem value="wfs">WFS — feições</SelectItem></SelectContent></Select></div><div><Label htmlFor="ogc-endpoint">Endpoint HTTPS sem query</Label><Input id="ogc-endpoint" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://geoservicos.inde.gov.br/geoserver/ICMBio/ows" /></div><div className="md:col-span-2"><Button onClick={() => create.mutate({ name, publisher, serviceType, endpoint })} disabled={create.isPending || !name || !publisher || !endpoint}>{create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Criar rascunho seguro</Button></div></CardContent></Card>
    <Card><CardHeader><CardTitle className="text-lg">Serviços registrados</CardTitle><CardDescription>Health saudável significa apenas GetCapabilities válido; publicação e fallback exigem variantes aprovadas separadamente.</CardDescription></CardHeader><CardContent className="space-y-3">{isLoading ? <Loader2 className="mx-auto h-6 w-6 animate-spin" /> : services?.length ? services.map((service) => <div key={service.id} className="flex flex-col justify-between gap-3 rounded-lg border p-4 md:flex-row md:items-center"><div className="min-w-0"><p className="font-medium">{service.name}</p><p className="truncate text-sm text-muted-foreground">{service.publisher} · {service.serviceType.toUpperCase()} · {service.endpoint}</p></div><div className="flex items-center gap-3">{healthIcon(service.health)}<Badge variant="outline">{service.status}</Badge><Badge variant="secondary">{service.health}</Badge><Button size="sm" variant="outline" onClick={() => validate.mutate({ id: service.id })} disabled={validate.isPending}>{validate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Validar</Button></div></div>) : <div className="py-10 text-center text-sm text-muted-foreground"><XCircle className="mx-auto mb-2 h-8 w-8" />Nenhum serviço OGC registrado.</div>}</CardContent></Card>
  </div>;
}
