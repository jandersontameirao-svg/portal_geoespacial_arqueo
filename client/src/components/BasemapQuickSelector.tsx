import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Info, Map as MapIcon } from "lucide-react";
import {
  DEFAULT_BASEMAP,
  SELECTABLE_BASEMAPS,
  type BasemapDefinition,
} from "@/lib/basemaps";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export interface BasemapQuickSelectorProps {
  basemapId: string;
  onBasemapChange: (id: string) => void;
  viewMode: "2d" | "3d";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Só é chamado pelo botão explícito de abrir o mapa 2D, nunca ao escolher um fundo. */
  onRequest2D?: () => void;
}

const shortNames: Record<string, string> = {
  "esri-imagery": "Satélite Esri",
  "esri-light-gray": "Cinza claro",
  "esri-dark-gray": "Cinza escuro",
};

export function getBasemapShortName(basemap: BasemapDefinition): string {
  return shortNames[basemap.id] ?? basemap.name;
}

/** Uma única amostra por provedor, apenas durante a abertura voluntária da lista. */
export function getBasemapPreviewUrl(
  basemap: BasemapDefinition
): string | undefined {
  if (
    !basemap.url ||
    basemap.kind !== "xyz" ||
    !["available", "legacy-available"].includes(basemap.availability) ||
    (basemap.minZoom ?? 0) > 3 ||
    (basemap.maxZoom ?? 3) < 3
  )
    return undefined;
  return basemap.url
    .replace("{z}", "3")
    .replace("{x}", "2")
    .replace("{y}", "4");
}

export function getBasemapFocusIndex(
  key: string,
  index: number,
  count: number
): number | undefined {
  if (count <= 0) return undefined;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown" || key === "ArrowRight") return (index + 1) % count;
  if (key === "ArrowUp" || key === "ArrowLeft")
    return (index - 1 + count) % count;
  return undefined;
}

function BasemapPreview({ basemap }: { basemap: BasemapDefinition }) {
  const url = getBasemapPreviewUrl(basemap);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    url ? "loading" : "error"
  );
  const shade =
    basemap.id === "esri-dark-gray"
      ? "bg-slate-700 text-white"
      : basemap.id === "esri-imagery"
        ? "bg-emerald-100 text-emerald-950"
        : "bg-slate-100 text-slate-700";
  return (
    <span
      className={`relative flex h-11 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-border ${shade}`}
      aria-hidden="true"
    >
      {status !== "loaded" && (
        <span className="px-1 text-center text-[9px] leading-tight">
          {status === "error" ? "Sem prévia" : "Carregando"}
        </span>
      )}
      {url && status !== "error" && (
        <img
          src={url}
          alt=""
          width={64}
          height={44}
          decoding="async"
          crossOrigin={
            basemap.crossOrigin === true
              ? "anonymous"
              : basemap.crossOrigin || undefined
          }
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
          className={`absolute inset-0 h-full w-full object-cover ${status === "loaded" ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </span>
  );
}

function BasemapSourceDetails({ basemap }: { basemap: BasemapDefinition }) {
  return (
    <details className="group min-w-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <summary
            aria-label={`Créditos e condições: ${basemap.name}`}
            className="flex h-11 w-9 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
          >
            <Info className="h-4 w-4" aria-hidden="true" />
          </summary>
        </TooltipTrigger>
        <TooltipContent
          side="left"
          className="z-[1200] max-w-[min(22rem,calc(100vw-2rem))] break-words print:hidden"
        >
          <p className="font-medium">{basemap.name} — créditos e condições</p>
          <p>{basemap.attribution}</p>
          <p>Toque ou pressione Enter para consultar os detalhes e a fonte.</p>
        </TooltipContent>
      </Tooltip>
      <div className="mt-1 space-y-2 rounded-md bg-muted/50 p-2 text-xs leading-relaxed [overflow-wrap:anywhere]">
        <p className="font-medium">{basemap.name}</p>
        <p>{basemap.description}</p>
        <p>{basemap.attribution}</p>
        {basemap.licenseUrl && (
          <a
            href={basemap.licenseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
          >
            Condições da fonte (nova aba)
          </a>
        )}
      </div>
    </details>
  );
}

export default function BasemapQuickSelector({
  basemapId,
  onBasemapChange,
  viewMode,
  open,
  onOpenChange,
  onRequest2D,
}: BasemapQuickSelectorProps) {
  const id = useId();
  const selected =
    SELECTABLE_BASEMAPS.find(basemap => basemap.id === basemapId) ??
    DEFAULT_BASEMAP;
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = SELECTABLE_BASEMAPS.findIndex(
    basemap => basemap.id === selected.id
  );
  const handleOptionKey = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    const next = getBasemapFocusIndex(
      event.key,
      index,
      SELECTABLE_BASEMAPS.length
    );
    if (next === undefined) return;
    event.preventDefault();
    optionRefs.current[next]?.focus();
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          id="map-panel-trigger-basemap"
          type="button"
          variant={open ? "default" : "ghost"}
          size="sm"
          aria-label={`Mapa de fundo: ${getBasemapShortName(selected)}${viewMode === "3d" ? ". Escolha para o mapa 2D; o globo 3D não muda." : ""}`}
          data-testid="map-panel-toggle-basemap"
          title={`Mapa de fundo: ${selected.name}${viewMode === "3d" ? " (somente 2D)" : ""}`}
          className={`h-auto min-h-10 min-w-0 flex-[1.6] gap-1 whitespace-normal px-1 py-1 text-[10px] sm:gap-2 sm:px-2 sm:text-xs ${open ? "bg-orange-500 text-white hover:bg-orange-600" : ""}`}
        >
          <MapIcon
            className="hidden h-4 w-4 shrink-0 sm:block"
            aria-hidden="true"
          />
          <span className="min-w-0 text-left leading-tight [overflow-wrap:anywhere]">
            <span className="block">
              Mapa de fundo{viewMode === "3d" ? " · 2D" : ""}
            </span>
            <span className="block font-semibold">
              {getBasemapShortName(selected)}
            </span>
          </span>
          <ChevronDown
            className="hidden h-3 w-3 shrink-0 sm:block"
            aria-hidden="true"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        collisionPadding={12}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-mode`}
        data-testid="basemap-quick-selector"
        data-html2canvas-ignore="true"
        className="pointer-events-auto z-[1100] w-[min(21rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-xl p-2 print:hidden motion-reduce:animate-none"
        style={{
          maxHeight:
            "min(75dvh, var(--radix-popover-content-available-height))",
        }}
        onOpenAutoFocus={event => {
          event.preventDefault();
          optionRefs.current[Math.max(0, selectedIndex)]?.focus();
        }}
      >
        <h2 id={`${id}-title`} className="px-2 pt-1 text-sm font-semibold">
          Mapa de fundo
        </h2>
        <p
          id={`${id}-mode`}
          className="px-2 py-1 text-xs leading-relaxed text-muted-foreground"
        >
          {viewMode === "3d"
            ? "Escolhas para o mapa 2D. O globo 3D não muda; sua textura é independente."
            : "Escolha um fundo para o mapa 2D."}
        </p>
        {open && (
          <ul aria-label="Fundos cartográficos 2D" className="space-y-1">
            {SELECTABLE_BASEMAPS.map((basemap, index) => {
              const active = basemap.id === selected.id;
              return (
                <li
                  key={basemap.id}
                  className="relative rounded-lg border border-transparent has-[details[open]]:border-border"
                >
                  <button
                    ref={element => {
                      optionRefs.current[index] = element;
                    }}
                    type="button"
                    aria-pressed={active}
                    aria-label={`${basemap.name}${active ? ", ativo no mapa 2D" : ", usar no mapa 2D"}`}
                    data-testid={`basemap-option-${basemap.id}`}
                    onKeyDown={event => handleOptionKey(event, index)}
                    onClick={() => {
                      onBasemapChange(basemap.id);
                      onOpenChange(false);
                    }}
                    className={`flex min-h-14 w-[calc(100%_-_2.5rem)] items-center gap-2 rounded-lg p-1.5 text-left focus-visible:outline-2 focus-visible:outline-ring ${active ? "bg-accent text-accent-foreground" : "hover:bg-accent/70"}`}
                  >
                    <BasemapPreview basemap={basemap} />
                    <span className="min-w-0 flex-1 text-sm leading-tight [overflow-wrap:anywhere]">
                      <span className="block font-medium">
                        {getBasemapShortName(basemap)}
                      </span>
                      {basemap.availability === "legacy-available" && (
                        <span className="text-[10px] text-muted-foreground">
                          Fonte legada
                        </span>
                      )}
                    </span>
                    {active && (
                      <span className="flex shrink-0 flex-col items-center text-[9px]">
                        <Check className="h-4 w-4" aria-hidden="true" />
                        Ativo
                      </span>
                    )}
                  </button>
                  <div className="px-1 pb-0.5 [&_summary]:absolute [&_summary]:right-0 [&_summary]:top-1.5">
                    <BasemapSourceDetails basemap={basemap} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="px-2 pt-2 text-[10px] leading-relaxed text-muted-foreground">
          Amostras ilustrativas, não da área atual. “Sem prévia” indica amostra
          indisponível; nenhum outro provedor é usado como substituto. Créditos
          e condições em ⓘ.
        </p>
        {viewMode === "3d" && onRequest2D && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 h-auto w-full whitespace-normal py-2"
            onClick={() => {
              onOpenChange(false);
              onRequest2D();
            }}
          >
            Abrir mapa 2D com o fundo selecionado
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
