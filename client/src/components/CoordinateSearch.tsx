import { useRef, useState } from "react";
import * as utm from "utm";
import { Search, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { trpc } from "@/lib/trpc";

interface CoordinateSearchProps {
  onNavigate: (lat: number, lng: number, zoom?: number) => void;
}

type EntityResult = { key: string; title: string; category: string; detail: string; href: string };

/** Coordenada decimal (lat, lng) ou UTM (23K 500000 8000000). */
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

export function CoordinateSearch({ onNavigate }: CoordinateSearchProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [coordError, setCoordError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const query = value.trim();

  // Só consulta entidades quando não é coordenada e há 2+ caracteres.
  let isCoord = false;
  try { isCoord = Boolean(coordinates(query)); } catch { isCoord = false; }
  const entityQuery = trpc.search.global.useQuery(
    { query, types: ["projects", "files"] },
    { enabled: open && query.length >= 2 && !isCoord, staleTime: 10_000 },
  );

  const results: EntityResult[] = [
    ...(entityQuery.data?.projects ?? []).map((p) => ({ key: `project-${p.id}`, title: p.name, category: "Projeto", detail: p.clientName ?? "", href: `/projects/${p.id}` })),
    ...(entityQuery.data?.files ?? []).map((f) => ({ key: `file-${f.id}`, title: f.name, category: "Arquivo", detail: f.projectName ?? "", href: `/projects/${f.projectId}?tab=files` })),
  ];

  const status = coordError
    ? coordError
    : isCoord
      ? ""
      : query.length < 2
        ? "Ex.: Angicos, -15.7801, -47.9292 ou 23K 500000 8000000"
        : entityQuery.isFetching
          ? "Buscando…"
          : results.length === 0
            ? "Nenhum resultado encontrado."
            : "";

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <div className="relative" onKeyDown={(event) => {
      if (open && event.key === "Escape") { event.stopPropagation(); close(); }
    }}>
      <Button ref={trigger} variant="secondary" size="icon" type="button" onClick={() => setOpen(!open)}
        title="Buscar no mapa" aria-label="Buscar no mapa" aria-expanded={open}
        className="bg-white/90 shadow-lg hover:bg-white">
        <Search className="size-5" aria-hidden="true" />
      </Button>
      {open && (
        <section aria-label="Busca do Geoportal" className="absolute right-full z-10 mr-2 rounded-lg bg-white p-3 text-slate-900 shadow-lg"
          style={{ width: "min(22rem, calc(100vw - 8rem))", maxHeight: "min(24rem, 55vh)", overflowY: "auto", bottom: 0 }}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Buscar no mapa</h2>
            <Button variant="ghost" size="icon" type="button" className="size-7" onClick={close} aria-label="Fechar busca">
              <X className="size-4" />
            </Button>
          </div>
          <form className="flex gap-2" onSubmit={(event) => {
            event.preventDefault();
            setCoordError("");
            try {
              const point = coordinates(query);
              if (point) { onNavigate(point[0], point[1]); close(); return; }
              if (results.length) { window.location.assign(results[0].href); }
            } catch { setCoordError("Confira as coordenadas informadas."); }
          }}>
            <Input autoFocus value={value} onChange={(event) => { setValue(event.target.value); setCoordError(""); }}
              maxLength={120} aria-label="Projetos, arquivos ou coordenadas" placeholder="Projeto, arquivo ou coordenada" />
            <Button type="submit" size="icon" aria-label="Buscar" title="Buscar" className="shrink-0">
              <Search className="size-4" aria-hidden="true" />
            </Button>
          </form>
          <p role="status" className="mt-2 text-xs text-slate-600">{status}</p>
          {results.length > 0 && (
            <ul className="mt-1">
              {results.map((result) => (
                <li key={result.key}>
                  <button type="button" onClick={() => window.location.assign(result.href)}
                    className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-slate-100 focus-visible:bg-slate-100">
                    <span className="block text-sm font-medium">{result.title}</span>
                    <span className="block text-xs text-slate-600">{result.category}{result.detail && " · " + result.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
