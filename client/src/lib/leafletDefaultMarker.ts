import L from "leaflet";
import markerIcon2xUrl from "leaflet/dist/images/marker-icon-2x.png?url";
import markerIconUrl from "leaflet/dist/images/marker-icon.png?url";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png?url";

/**
 * O CSS original do Leaflet referencia imagens relativas a `images/`. Em um build
 * Vite multi-entrada isso pode resultar em marcador quebrado. Os imports `?url`
 * fazem o bundler emitir os três PNGs com hash e esta configuração é compartilhada
 * pelo Portal e pelo laboratório isolado.
 */
export function configureLeafletDefaultMarker(): void {
  // Icon.Default antepõe imagePath mesmo para uma URL absoluta do Vite, o que
  // produz /images//@fs/... no servidor de desenvolvimento. Ao remover sua
  // implementação especializada, a implementação base respeita a URL já
  // resolvida pelo bundler.
  delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2xUrl,
    iconUrl: markerIconUrl,
    shadowUrl: markerShadowUrl,
  });
}

configureLeafletDefaultMarker();
