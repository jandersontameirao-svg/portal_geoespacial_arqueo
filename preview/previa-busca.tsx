import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import * as utm from "utm";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type Result = { key: string; title: string; detail: string; category: string } &
  ({ href: string } | { lat: number; lng: number; zoom: number });

function coordinates(value: string): [number, number] | undefined {
  const decimal = value.match(/^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/);
  if (decimal) {
    const lat = Number(decimal[1]);
    const lng = Number(decimal[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw Error("Coordenadas fora do intervalo.");
    return [lat, lng];
  }
  const grid = value.match(/^(\d{1,2})\s*([a-z])\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/i);
  if (grid) {
    const point = utm.toLatLon(Number(grid[3]), Number(grid[4]), Number(grid[1]), grid[2].toUpperCase());
    return [point.latitude, point.longitude];
  }
}

export function CoordinateSearch({ onNavigate }: { onNavigate: (lat: number, lng: number, zoom?: number) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [status, setStatus] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const query = value.trim();

  useEffect(() => {
    setResults([]);
    setStatus("");
    if (!open || !/[\p{L}\p{N}]{2}/u.test(query)) return;
    try { if (coordinates(query)) return; } catch { return; }

    // Wait for a pause in typing and cancel stale requests when the query changes.
    const controller = new AbortController();
    setStatus("Buscando…");
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/previa/busca?q=" + encodeURIComponent(query), { signal: controller.signal });
        if (!response.ok) throw Error();
        const matches: Result[] = await response.json();
        if (controller.signal.aborted) return;
        setResults(matches);
        setStatus(matches.length ? "" : "Nenhum resultado encontrado.");
      } catch {
        if (!controller.signal.aborted) setStatus("Não foi possível concluir a busca.");
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function select(result: Result) {
    if ("href" in result) { window.location.assign(result.href); return; }
    onNavigate(result.lat, result.lng, result.zoom);
    close();
  }

  return <div className="relative" onKeyDown={event => {
    if (open && event.key === "Escape") { event.stopPropagation(); close(); }
  }}>
    <Button ref={trigger} variant="secondary" size="icon" type="button" onClick={() => setOpen(!open)}
      title="Buscar no mapa" aria-label="Buscar no mapa" aria-expanded={open}
      className="bg-white/90 shadow-lg hover:bg-white">
      <Search className="size-5" aria-hidden="true" />
    </Button>
    {open && <section aria-label="Busca do Geoportal" className="absolute right-full z-10 mr-2 rounded-lg bg-white p-3 text-slate-900 shadow-lg"
      style={{ width: "min(22rem, calc(100vw - 8rem))", maxHeight: "min(24rem, 55vh)", overflowY: "auto", bottom: 0 }}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Buscar no mapa</h2>
        <Button variant="ghost" size="icon" type="button" className="size-7" onClick={close} aria-label="Fechar busca">
          <X className="size-4" />
        </Button>
      </div>
      <form className="flex gap-2" onSubmit={event => {
        event.preventDefault();
        try {
          const point = coordinates(query);
          if (point) { onNavigate(...point); close(); return; }
          if (results.length) select(results[0]);
        } catch { setStatus("Confira as coordenadas informadas."); }
      }}>
        <Input autoFocus value={value} onChange={event => setValue(event.target.value)}
          maxLength={120} aria-label="Projetos, arquivos, cidades ou coordenadas" placeholder="Projeto, cidade, arquivo ou coordenada" />
        <Button type="submit" size="icon" aria-label="Buscar" title="Buscar" className="shrink-0">
          <Search className="size-4" aria-hidden="true" />
        </Button>
      </form>
      <p role="status" className="mt-2 text-xs text-slate-600">{status || (!results.length && "Ex.: São Luís MA, -15.7801, -47.9292 ou 23K 500000 8000000")}</p>
      {results.length > 0 && <ul className="mt-1">
        {results.map(result => <li key={result.key}>
          <button type="button" onClick={() => select(result)}
            className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-slate-100 focus-visible:bg-slate-100">
            <span className="block text-sm font-medium">{result.title}</span>
            <span className="block text-xs text-slate-600">{result.category}{result.detail && " · " + result.detail}</span>
          </button>
        </li>)}
      </ul>}
    </section>}
  </div>;
}
