import { useEffect, useRef, useState } from "react";
import { Popup, WMSTileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { FeatureCollection } from "geojson";
import { trpc } from "@/lib/trpc";

/**
 * Ferramenta "Consultar sítios IPHAN" (SICG) — botão rotulado no mapa que liga
 * a base WMS dos sítios arqueológicos do IPHAN e ativa o modo identificar: ao
 * clicar sobre um sítio, consulta o IPHAN no ponto e abre um popup com os dados
 * do bem (código, classificação, síntese…), link para o SICG e "Guardar com a
 * Atena". Porte fiel do PreviewIphanSites da prévia do Codex, ligado ao tRPC
 * real (iphanSites.inView) e à auth de produção.
 *
 * Quando a camada do IPHAN já está visível pelo painel "Camadas do mapa", o
 * botão se esconde e o identificar continua ativo (sem duplicar a base).
 */

type Site = {
  id: number;
  nome?: string;
  codigo?: string;
  classificacao?: string;
  tipoBem?: string;
  sintese?: string;
  cadastro?: string;
};

export default function IphanSitesLayer() {
  const map = useMap();
  const utils = trpc.useUtils();
  const { data: connections = [] } = trpc.connections.list.useQuery(undefined, {
    refetchOnWindowFocus: true,
  });
  // Base do IPHAN já ligada pelo painel "Camadas do mapa"?
  const layerAlreadyVisible = connections.some(
    (c) => c.enabled && c.type === "WMS" && /SICG:sitios/.test(c.layer ?? ""),
  );

  const [consult, setConsult] = useState(false);
  const active = consult || layerAlreadyVisible;
  const [result, setResult] = useState<{ point: L.LatLng; status: string; sites: Site[] }>();
  const current = useRef<AbortController | undefined>(undefined);
  const control = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (control.current) L.DomEvent.disableClickPropagation(control.current);
  }, [layerAlreadyVisible]);

  useEffect(() => {
    if (!active) return;
    const identify = async (event: L.LeafletMouseEvent) => {
      // Deixa o clique em feições vetoriais (desenho/edição) passar quando o
      // modo não foi ligado explicitamente pelo botão.
      if ((event.originalEvent.target as Element | null)?.closest?.(".leaflet-interactive") && !consult) return;
      current.current?.abort();
      const point = event.latlng;
      if (map.getZoom() < 10) {
        setResult({ point, status: "Aproxime o mapa e clique sobre um sítio.", sites: [] });
        return;
      }
      const container = map.latLngToContainerPoint(point);
      const sw = map.containerPointToLatLng(container.add([-9, 9]));
      const ne = map.containerPointToLatLng(container.add([9, -9]));
      const bbox = [sw.lng, sw.lat, ne.lng, ne.lat].join(",");
      const controller = new AbortController();
      current.current = controller;
      setResult({ point, status: "Consultando o IPHAN…", sites: [] });
      try {
        const data = await utils.iphanSites.inView.fetch({ bbox });
        if (controller.signal.aborted) return;
        const sites = (data as unknown as FeatureCollection).features.map((feature) => feature.properties as Site);
        setResult({ point, sites, status: sites.length ? "" : "Nenhum sítio retornado neste ponto do mapa." });
      } catch (error: any) {
        if (!controller.signal.aborted) {
          setResult({ point, sites: [], status: error?.message || "Consulta ao IPHAN indisponível." });
        }
      }
    };
    map.on("click", identify);
    return () => { map.off("click", identify); current.current?.abort(); };
  }, [active, consult, map, utils]);

  return (
    <>
      {!layerAlreadyVisible && (
        <div ref={control} className="absolute bottom-8 right-3 z-[1000]">
          <button
            type="button"
            aria-pressed={active}
            className="rounded-md border bg-white px-3 py-2 text-xs font-semibold text-slate-900 shadow hover:bg-slate-50 aria-pressed:bg-emerald-100"
            onClick={() => { setConsult((value) => !value); setResult(undefined); }}
          >
            Consultar sítios IPHAN
          </button>
          {active && <p className="mt-1 rounded bg-white px-2 py-1 text-xs text-slate-800 shadow">Clique sobre um sítio no mapa.</p>}
        </div>
      )}

      {consult && !layerAlreadyVisible && (
        <WMSTileLayer
          url="https://geoserver.iphan.gov.br/geoserver/SICG/wms"
          layers="SICG:sitios_pol,SICG:sitios"
          format="image/png"
          transparent
          version="1.1.1"
        />
      )}

      {active && result && (
        <Popup
          position={result.point}
          closeOnClick={false}
          maxWidth={360}
          maxHeight={320}
          eventHandlers={{ remove: () => { current.current?.abort(); setResult(undefined); } }}
        >
          {result.status && <div role="status">{result.status}</div>}
          {result.sites.map((site) => (
            <article key={site.id} className="space-y-2 border-b pb-3 pt-2">
              <strong className="block">{site.nome || "Sítio arqueológico sem nome informado"}</strong>
              <div>Tipo: {site.tipoBem || site.classificacao || "Não informado"}</div>
              <details className="space-y-1">
                <summary className="cursor-pointer font-semibold">Ver dados do sítio</summary>
                <div>Código IPHAN: {site.codigo || "Não informado"}</div>
                <div>Classificação: {site.classificacao || "Não informada"}</div>
                {site.cadastro && <div>Cadastro: {site.cadastro}</div>}
                <div><b>Síntese:</b> {site.sintese || "Não publicada"}</div>
                <div>Fonte: IPHAN / SICG</div>
              </details>
              <div className="flex flex-wrap items-center gap-2">
                <a href="https://sicg.iphan.gov.br/sicg/pesquisarBem" target="_blank" rel="noreferrer" className="underline">
                  Consultar fonte no SICG
                </a>
                <button
                  type="button"
                  className="rounded border px-2 py-1"
                  onClick={() => window.dispatchEvent(new CustomEvent("studio-open-atena", { detail: "Guardar sítio IPHAN " + site.id }))}
                >
                  Guardar com a Atena
                </button>
              </div>
            </article>
          ))}
        </Popup>
      )}
    </>
  );
}
