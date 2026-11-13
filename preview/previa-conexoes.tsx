import { useEffect, useState } from "react";

type Connection = { id?: number; name: string; type: string; address: string; status?: string; layer?: string; enabled?: boolean; official?: boolean };
const blank: Connection = { name: "", type: "WMS", address: "" };
async function request(connection?: Connection) {
  const response = await fetch("/api/trpc/previewConnections." + (connection ? "save" : "list"), connection ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ json: connection }),
  } : undefined);
  const payload = await response.json();
  if (!response.ok || payload.error) throw Error(payload.error?.json?.message ?? "Falha ao acessar o cadastro.");
  return payload.result.data.json;
}

export default function PreviewConnections() {
  const [items, setItems] = useState<Connection[]>([]);
  const [draft, setDraft] = useState<Connection>();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(connection: Connection) {
    setBusy(true); setNotice("");
    try {
      const saved: Connection = await request(connection);
      setItems(current => [...current.filter(item => item.id !== saved.id), saved]);
      window.dispatchEvent(new Event("preview-connections-changed"));
      setDraft(undefined); setNotice("Fonte atualizada.");
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => { request().then(setItems).catch(error => setNotice(error.message)); }, []);
  const field = "mt-1 w-full rounded-md border bg-background px-3 py-2";
  return <section className="mb-6 space-y-4 rounded-xl border bg-card p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">Conexões cadastradas</h2>
      <button type="button" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={() => { setNotice(""); setDraft(blank); }}>Nova conexão</button>
    </div>
    <p className="text-sm text-muted-foreground">Cadastre as fontes que poderão ser integradas ao Geoportal. O cadastro guarda o endereço e o tipo de fonte para configuração posterior.</p>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {draft && <form className="grid gap-3 rounded-lg border p-4" onSubmit={async event => {
      event.preventDefault();
      await save(draft);
    }}>
      <label className="text-sm">Nome da fonte<input className={field} required maxLength={100} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
      <label className="text-sm">Tipo de fonte<select className={field} value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value, enabled: false })}>
        {["WMS", "WFS", "ArcGIS REST", "GeoJSON", "PostGIS"].map(type => <option key={type}>{type}</option>)}
      </select></label>
      <label className="text-sm">Endereço da fonte<input className={field} required maxLength={500} value={draft.address} placeholder={draft.type === "PostGIS" ? "servidor:5432/banco" : "https://servidor/servico"} onChange={e => setDraft({ ...draft, address: e.target.value })} /></label>
      {draft.type === "WMS" && <label className="text-sm">Identificador da camada WMS<input className={field} value={draft.layer ?? ""} onChange={e => setDraft({ ...draft, layer: e.target.value, enabled: e.target.value.trim() ? draft.enabled : false })} placeholder="workspace:camada" /></label>}
      <div className="flex gap-2"><button disabled={busy} className="rounded border px-3 py-2 text-sm">Salvar conexão</button>
        <button disabled={busy} type="button" className="px-3 text-sm" onClick={() => setDraft(undefined)}>Cancelar</button></div>
    </form>}
    {!items.length && <p className="text-sm text-muted-foreground">Nenhuma fonte cadastrada.</p>}
    <ul className="space-y-2">{items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
      <div><strong>{item.name}</strong><p className="break-all text-muted-foreground">{item.type} · {item.official ?
        <a href={item.address} target="_blank" rel="noreferrer" className="underline">{item.address}</a> : item.address}</p>
        {(item.official || item.type === "WMS") && item.layer ? <label className="flex gap-2"><input type="checkbox" disabled={busy || !!draft} checked={!!item.enabled} onChange={e => void save({ ...item, enabled: e.target.checked })} /> Exibir {item.name} no mapa</label> :
          <span>{item.status ?? (item.type === "WMS" ? "Informe a camada WMS para ligar a fonte." : "Cadastro para integração futura.")}</span>}
        {item.layer && item.status && <p className="text-muted-foreground">{item.status}</p>}</div>
      {!item.official && <button type="button" className="rounded border px-3 py-1" onClick={() => { setNotice(""); setDraft(item); }}>Editar fonte</button>}
    </li>)}</ul>
  </section>;
}
