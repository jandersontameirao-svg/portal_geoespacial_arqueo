import html2canvas from "html2canvas";
import type * as L from "leaflet";
import {
  assertMapPrintBounds,
  assertMapPrintSize,
  MAP_PRINT_MAX_PIXELS,
  type MapPrintBounds,
  type MapPrintLegendItem,
  type MapPrintSnapshot,
} from "@shared/mapPrint";

export interface CaptureMapSnapshotOptions {
  signal?: AbortSignal;
  /** Optional diagnostic context; never inserted as markup. */
  label?: string;
  /** Caller-supplied labels for visible layers only. No invented symbology. */
  legend?: MapPrintLegendItem[];
  /** Total deadline, including fonts, tiles, resource checks and rendering. */
  timeoutMs?: number;
  /** Can lower, but never raise, the hard 12 MP limit. */
  maxPixels?: number;
}

export class MapPrintCaptureError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "MapPrintCaptureError";
  }
}

const fail = (code: string, message: string): never => { throw new MapPrintCaptureError(code, message); };
const MAX_RESOURCES = 512;
const MAX_RESOURCE_PIXELS = 48_000_000;
const EXCLUDED_CONTROLS = [
  ".leaflet-control-zoom", ".leaflet-control-layers", ".leaflet-control-attribution",
  ".leaflet-draw", ".leaflet-bar", ".leaflet-control-geocoder",
  "[data-map-print-ignore]", "[data-html2canvas-ignore]",
].join(",");
const CARTOGRAPHIC_CONTROL = ".leaflet-control-scale, .legend, .map-legend, [data-map-print-legend]";

/** Do not exclude the whole control container: legends and scale bars are map content. */
export function shouldIgnoreMapPrintElement(element: Element): boolean {
  if (element.closest(CARTOGRAPHIC_CONTROL)) return false;
  return Boolean(element.closest(EXCLUDED_CONTROLS));
}

function makeGuard(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const abort = () => controller.abort(new DOMException("Captura cancelada.", "AbortError"));
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new MapPrintCaptureError("TIMEOUT",
    "Tempo limite da captura excedido. Aguarde as camadas carregarem e tente novamente.")), timeoutMs);
  return {
    signal: controller.signal,
    stop(reason: Error) { if (!controller.signal.aborted) controller.abort(reason); },
    check() { if (controller.signal.aborted) throw controller.signal.reason; },
    async wait<T>(work: PromiseLike<T>): Promise<T> {
      if (controller.signal.aborted) throw controller.signal.reason;
      return new Promise<T>((resolve, reject) => {
        const stopped = () => { cleanup(); reject(controller.signal.reason); };
        const cleanup = () => controller.signal.removeEventListener("abort", stopped);
        controller.signal.addEventListener("abort", stopped, { once: true });
        Promise.resolve(work).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
      });
    },
    dispose() { clearTimeout(timer); signal?.removeEventListener("abort", abort); },
  };
}
type Guard = ReturnType<typeof makeGuard>;

function readBounds(map: L.Map): MapPrintBounds {
  const bounds = map.getBounds();
  const value = { north: bounds.getNorth(), south: bounds.getSouth(), east: bounds.getEast(), west: bounds.getWest() };
  assertMapPrintBounds(value);
  return value;
}

function delay(guard: Guard, ms: number): Promise<void> {
  return guard.wait(new Promise<void>(resolve => setTimeout(resolve, ms)));
}

function visible(element: Element, container: HTMLElement): boolean {
  if (shouldIgnoreMapPrintElement(element)) return false;
  const win = container.ownerDocument.defaultView!;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = win.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) === 0) return false;
    if (current === container) break;
  }
  const rect = element.getBoundingClientRect(), frame = container.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.right > frame.left && rect.left < frame.right && rect.bottom > frame.top && rect.top < frame.bottom;
}

interface PrintGridLayer {
  _map?: L.Map;
  _container?: HTMLElement;
  _tileZoom?: number;
  _tiles?: Record<string, {
    el: HTMLElement;
    coords: { x: number; y: number; z: number };
    current?: boolean;
    loaded?: number;
  }>;
  options?: { minZoom?: number; maxZoom?: number };
}

/** Read-only readiness check, also usable without a renderer in unit tests. */
export function inspectMapPrintTiles(map: L.Map): {
  pending: boolean;
  images: Set<HTMLImageElement>;
  managedImages: Set<HTMLImageElement>;
  ignoredTiles: Set<HTMLElement>;
} {
  const container = map.getContainer(), win = container.ownerDocument.defaultView!;
  const frame = container.getBoundingClientRect(), zoom = Math.round(map.getZoom());
  const images = new Set<HTMLImageElement>(), managedImages = new Set<HTMLImageElement>();
  const ignoredTiles = new Set<HTMLElement>();
  let pending = false;
  map.eachLayer(layer => {
    const grid = layer as unknown as PrintGridLayer;
    if (!grid._tiles) return;
    const tiles = Object.values(grid._tiles);
    const tileImages = (element: HTMLElement): HTMLImageElement[] => element.tagName.toLowerCase() === "img"
      ? [element as HTMLImageElement] : Array.from(element.querySelectorAll<HTMLImageElement>("img"));
    // Buffer/old-zoom/hidden tiles must not re-enter the generic image wait below.
    for (const tile of tiles) {
      ignoredTiles.add(tile.el);
      for (const image of tileImages(tile.el)) managedImages.add(image);
    }
    const root = grid._container;
    if (grid._map !== map || !root || !container.contains(root) || shouldIgnoreMapPrintElement(root) ||
        grid._tileZoom === undefined ||
        (grid.options?.minZoom !== undefined && zoom < grid.options.minZoom) ||
        (grid.options?.maxZoom !== undefined && zoom > grid.options.maxZoom)) return;
    // Layer containers have no intrinsic size. Honor deliberately hidden groups,
    // but NOT the tile's own visibility/opacity: Leaflet hides pending/error imgs.
    for (let current: Element | null = root; current; current = current.parentElement) {
      const style = win.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) === 0) return;
      if (current === container) break;
    }
    for (const tile of tiles) {
      // _tileZoom is Leaflet's actual (native-clamped) grid zoom, NOT URL zoom or
      // map zoom. current=false includes pruned/retained parent/child levels.
      if (tile.current === false || tile.coords.z !== grid._tileZoom || !root.contains(tile.el)) continue;
      const rect = tile.el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.right <= frame.left || rect.left >= frame.right || rect.bottom <= frame.top || rect.top >= frame.bottom) continue;
      ignoredTiles.delete(tile.el);
      const requiredImages = tileImages(tile.el);
      for (const image of requiredImages) images.add(image);
      // Leaflet marks even failed requests as `loaded` and can finish isLoading()
      // with no successful tile. A fallback errorTileUrl is not a valid map tile.
      if ((tile.loaded && !tile.el.classList.contains("leaflet-tile-loaded")) ||
          requiredImages.some(image => image.complete && (!image.naturalWidth || !image.naturalHeight))) {
        fail("TILE_ERROR", `Um tile de uma camada ativa do mapa falhou (z=${tile.coords.z}, x=${tile.coords.x}, y=${tile.coords.y}). Verifique a disponibilidade da camada e tente novamente; nenhuma captura parcial foi gerada.`);
      }
      if (!tile.loaded || !tile.el.classList.contains("leaflet-tile-loaded") || requiredImages.some(image => !image.complete)) pending = true;
    }
  });
  return { pending, images, managedImages, ignoredTiles };
}

function inIgnoredTile(node: Node, ignoredTiles: Set<HTMLElement>): boolean {
  return Array.from(ignoredTiles).some(tile => tile === node || tile.contains(node));
}

/** Only exempt already-classified non-viewport tiles, never arbitrary mutations. */
export function mapPrintMutationAffectsCapture(record: MutationRecord, ignoredTiles: Set<HTMLElement>): boolean {
  const target = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement;
  if (!target || shouldIgnoreMapPrintElement(target) || inIgnoredTile(target, ignoredTiles)) return false;
  // Pruning records removal on the level, not on the old/offscreen tile itself.
  if (record.type === "childList") {
    const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
    if (nodes.length && nodes.every(node => inIgnoredTile(node, ignoredTiles))) return false;
  }
  return true;
}

function validateSource(raw: string, document: Document): string {
  const url = new URL(raw, document.baseURI);
  if (url.username || url.password || !["https:", "http:", "blob:", "data:"].includes(url.protocol) ||
      (url.protocol === "data:" && !url.href.startsWith("data:image/"))) {
    return fail("RESOURCE_URL", "Recurso do mapa com protocolo não suportado para captura.");
  }
  return url.href;
}

async function loaded(image: HTMLImageElement, guard: Guard): Promise<void> {
  if (!image.complete) {
    await guard.wait(new Promise<void>((resolve, reject) => {
      const clean = () => {
        image.removeEventListener("load", ready); image.removeEventListener("error", broken);
        guard.signal.removeEventListener("abort", cancelled);
      };
      const ready = () => { clean(); resolve(); };
      const broken = () => { clean(); reject(new MapPrintCaptureError("IMAGE_LOAD", "Uma imagem visível não carregou. Verifique a camada e a permissão CORS do provedor.")); };
      const cancelled = () => { clean(); reject(guard.signal.reason); };
      image.addEventListener("load", ready, { once: true });
      image.addEventListener("error", broken, { once: true });
      guard.signal.addEventListener("abort", cancelled, { once: true });
      if (image.complete) ready();
    }));
  }
  guard.check();
  if (!image.naturalWidth || !image.naturalHeight) fail("IMAGE_LOAD", "Imagem visível vazia ou indisponível; captura interrompida para não omitir a camada.");
  if (typeof image.decode === "function") {
    try { await guard.wait(image.decode()); }
    catch (error) { guard.check(); fail("IMAGE_DECODE", "Não foi possível decodificar uma imagem visível do mapa."); }
  }
}

/** Copy only pixels the browser actually permits reading. Never use allowTaint or a proxy. */
function readablePng(source: HTMLImageElement | HTMLCanvasElement, document: Document): string {
  const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  assertMapPrintSize(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return fail("CANVAS_CONTEXT", "O navegador não disponibilizou contexto 2D para captura.");
    context.drawImage(source, 0, 0);
    context.getImageData(0, 0, 1, 1);
    const result = canvas.toDataURL("image/png");
    if (!result.startsWith("data:image/png;base64,")) return fail("CANVAS_EMPTY", "O navegador não conseguiu codificar a imagem do mapa.");
    return result;
  } finally { canvas.width = 0; canvas.height = 0; }
}

function imageFromSource(source: string, document: Document, guard: Guard): Promise<HTMLImageElement> {
  const image = document.createElement("img");
  // Set before src. Reload only a URL already used by visible map content.
  image.crossOrigin = "anonymous";
  image.decoding = "sync";
  image.src = validateSource(source, document);
  return loaded(image, guard).then(() => image);
}

function backgroundUrls(value: string): string[] {
  const urls: string[] = [];
  const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g;
  for (const match of Array.from(value.matchAll(pattern))) urls.push(match[1] ?? match[2] ?? match[3].trim());
  if (/image-set\(/i.test(value)) fail("BACKGROUND_UNSUPPORTED", "Fundo CSS image-set não suportado; utilize imagem convencional antes de capturar.");
  return urls;
}

interface PreparedResources {
  images: Map<Element, string>;
  backgrounds: Map<Element, string>;
  pseudos: Map<Element, Record<string, string>>;
}

async function prepareResources(container: HTMLElement, guard: Guard, checkStable: () => void, tiles: ReturnType<typeof inspectMapPrintTiles>): Promise<PreparedResources> {
  const document = container.ownerDocument, win = document.defaultView!;
  const result: PreparedResources = { images: new Map(), backgrounds: new Map(), pseudos: new Map() };
  const safeUrls = new Map<string, Promise<string>>();
  let resourceCount = 0, pixelCount = 0;
  function account(width: number, height: number) {
    assertMapPrintSize(width, height);
    resourceCount++; pixelCount += width * height;
    if (resourceCount > MAX_RESOURCES || pixelCount > MAX_RESOURCE_PIXELS) {
      fail("RESOURCE_LIMIT", "Recursos visíveis excedem 512 imagens ou 48 MP acumulados. Reduza a área/camadas para capturar.");
    }
  }
  async function safeImage(image: HTMLImageElement): Promise<string> {
    await loaded(image, guard); checkStable();
    const source = validateSource(image.currentSrc || image.src, document);
    account(image.naturalWidth, image.naturalHeight);
    try { return readablePng(image, document); }
    catch (error) {
      if (!(error instanceof DOMException && error.name === "SecurityError")) throw error;
      // The live Leaflet tile may have loaded in no-cors mode. Do not mutate it.
      // A separate anonymous request works ONLY if its actual provider permits CORS.
      return safeUrl(source);
    }
  }
  function safeUrl(source: string): Promise<string> {
    const url = validateSource(source, document);
    let cached = safeUrls.get(url);
    if (!cached) {
      cached = (async () => {
        try {
          const image = await imageFromSource(url, document, guard);
          account(image.naturalWidth, image.naturalHeight);
          return readablePng(image, document);
        } catch (error) {
          guard.check();
          if (error instanceof MapPrintCaptureError && error.code === "RESOURCE_LIMIT") throw error;
          return fail("CORS", "Imagem/camada visível não permite leitura dos pixels (CORS) ou está indisponível. O provedor deve autorizar o acesso; nenhum proxy ou omissão foi utilizado.");
        }
      })();
      safeUrls.set(url, cached);
    }
    return cached;
  }
  async function freezeBackground(value: string): Promise<string> {
    let frozen = value;
    for (const source of backgroundUrls(value)) {
      const data = await safeUrl(source);
      const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g;
      frozen = frozen.replace(pattern, (whole, a, b, c) => (a ?? b ?? c.trim()) === source ? `url("${data}")` : whole);
    }
    return frozen;
  }

  const elements = [container, ...Array.from(container.querySelectorAll("*"))].filter(element => {
    if (inIgnoredTile(element, tiles.ignoredTiles)) return false;
    if (tiles.managedImages.has(element as HTMLImageElement)) return tiles.images.has(element as HTMLImageElement);
    return visible(element, container);
  });
  if (elements.length > 20_000) fail("DOM_LIMIT", "A vista contém elementos demais para uma captura segura. Reduza as camadas visíveis.");
  // Bounded workers; no bulk reloads of arbitrary endpoints.
  let index = 0;
  async function worker() {
    while (index < elements.length) {
      guard.check(); checkStable();
      const element = elements[index++];
      if (element.tagName.toLowerCase() === "img") result.images.set(element, await safeImage(element as HTMLImageElement));
      if (element.tagName.toLowerCase() === "canvas") {
        const canvas = element as HTMLCanvasElement;
        account(canvas.width, canvas.height);
        if (!canvas.getContext("2d")) fail("WEBGL_UNSUPPORTED", "Canvas WebGL não suportado nesta captura Leaflet; não é seguro capturar um buffer possivelmente vazio.");
        try { result.images.set(element, readablePng(canvas, document)); }
        catch (error) { guard.check(); fail("CANVAS_CORS", "Raster/canvas visível não permite leitura dos pixels (CORS). Captura cancelada para não gerar camada vazia."); }
      }
      if (["video", "iframe", "object", "embed"].includes(element.tagName.toLowerCase())) {
        fail("MEDIA_UNSUPPORTED", "Há mídia ou conteúdo incorporado visível não suportado para captura fiel.");
      }
      const style = win.getComputedStyle(element);
      if (style.maskImage && style.maskImage !== "none") fail("MASK_UNSUPPORTED", "Máscara CSS visível não suportada para captura fiel.");
      if (style.backgroundImage !== "none" && backgroundUrls(style.backgroundImage).length) {
        result.backgrounds.set(element, await freezeBackground(style.backgroundImage));
      }
      if (!(element instanceof SVGElement)) {
        for (const pseudo of ["::before", "::after"]) {
          const pseudoStyle = win.getComputedStyle(element, pseudo);
          if (pseudoStyle.content !== "none" && pseudoStyle.content !== "normal" && backgroundUrls(pseudoStyle.backgroundImage).length) {
            const existing = result.pseudos.get(element) ?? {};
            existing[pseudo] = await freezeBackground(pseudoStyle.backgroundImage);
            result.pseudos.set(element, existing);
          }
          if (/url\(/.test(pseudoStyle.content)) fail("PSEUDO_UNSUPPORTED", "Ícone CSS em content:url não suportado para captura fiel; utilize img ou background-image.");
        }
      }
    }
  }
  await guard.wait(Promise.all(Array.from({ length: 4 }, worker)));
  // Rasterize each SVG with computed styles, so stylesheet-driven Leaflet paths
  // cannot silently disappear in html2canvas's implicit SVG serialization.
  for (const svg of Array.from(container.querySelectorAll("svg"))) {
    if (svg.ownerSVGElement || !visible(svg, container)) continue;
    guard.check(); checkStable();
    const clone = svg.cloneNode(true) as SVGSVGElement;
    if (clone.querySelector("foreignObject, script, animate, animateTransform, animateMotion, set")) {
      fail("SVG_UNSUPPORTED", "SVG animado/foreignObject não suportado para captura estável.");
    }
    const originals: Element[] = [svg, ...Array.from(svg.querySelectorAll("*"))];
    const copies: Element[] = [clone, ...Array.from(clone.querySelectorAll("*"))];
    for (let i = 0; i < originals.length; i++) {
      const source = originals[i], copy = copies[i] as SVGElement;
      const computed = win.getComputedStyle(source);
      // Copy SVG presentation properties, not page layout/animations/outer transforms.
      for (const name of ["fill", "fill-opacity", "fill-rule", "stroke", "stroke-opacity", "stroke-width", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "opacity", "visibility", "display", "paint-order", "vector-effect", "font-family", "font-size", "font-weight", "text-anchor", "dominant-baseline", "clip-path", "clip-rule", "mask", "filter", "color"]) {
        let value = computed.getPropertyValue(name);
        value = value.replace(/url\(["']?([^)'"\s]+)["']?\)/g, (_whole, ref: string) => {
          const fragment = ref.startsWith("#") ? ref : new URL(ref, document.baseURI).hash;
          const target = fragment && document.getElementById(decodeURIComponent(fragment.slice(1)));
          if (!target || !svg.contains(target)) return fail("SVG_REFERENCE", "SVG referencia recurso externo/não resolvido; captura fiel indisponível.");
          return `url("${fragment}")`;
        });
        if (value) copy.style.setProperty(name, value);
      }
      if (i > 0 && computed.transform !== "none") {
        copy.style.transform = computed.transform;
        copy.style.transformOrigin = computed.transformOrigin;
      }
      if (source.tagName.toLowerCase() === "image") {
        const href = source.getAttribute("href") || source.getAttributeNS("http://www.w3.org/1999/xlink", "href");
        if (!href) fail("SVG_IMAGE", "SVG contém imagem sem endereço legível.");
        const data = await safeUrl(href!);
        copy.setAttribute("href", data);
        copy.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", data);
      }
      if (source.tagName.toLowerCase() === "use") {
        const href = source.getAttribute("href") || source.getAttributeNS("http://www.w3.org/1999/xlink", "href") || "";
        const target = href.startsWith("#") && document.getElementById(href.slice(1));
        if (!target || !svg.contains(target)) fail("SVG_REFERENCE", "SVG use externo não suportado; incorpore o símbolo na própria camada.");
      }
    }
    const rect = svg.getBoundingClientRect();
    const width = Math.ceil(svg.width.baseVal.value || rect.width), height = Math.ceil(svg.height.baseVal.value || rect.height);
    assertMapPrintSize(width, height);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width)); clone.setAttribute("height", String(height));
    clone.style.transform = "none"; clone.style.position = "static";
    // Root opacity stays on the replacement element; child/path opacities stay
    // in the raster. Applying both would incorrectly square layer opacity.
    clone.style.opacity = "1";
    clone.style.margin = "0"; clone.style.left = "auto"; clone.style.top = "auto";
    clone.style.width = `${width}px`; clone.style.height = `${height}px`;
    const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
    const image = await imageFromSource(source, document, guard);
    account(image.naturalWidth, image.naturalHeight);
    result.images.set(svg, readablePng(image, document));
  }
  return result;
}

function readAttributions(map: L.Map, document: Document): string[] {
  const values = new Set<string>();
  map.eachLayer(layer => {
    const raw = layer.getAttribution?.();
    if (!raw) return;
    // Parse in an inert template: do not attach provider HTML or execute it.
    const template = document.createElement("template");
    template.innerHTML = raw;
    template.content.querySelectorAll("script, style").forEach(element => element.remove());
    const text = (template.content.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) values.add(text);
  });
  return Array.from(values);
}

/** html2canvas 1.4 cannot parse Tailwind 4's oklch()/color() values. */
function normalizeCloneColors(document: Document, root: HTMLElement): void {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) fail("CANVAS_CONTEXT", "Contexto de conversão de cores indisponível.");
  const cache = new Map<string, string>();
  const modern = /\b(?:oklch|oklab|lab|lch|color)\(/ig;
  const convert = (value: string): string => {
    let output = "", cursor = 0;
    modern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = modern.exec(value))) {
      const start = match.index;
      let end = modern.lastIndex, depth = 1;
      while (end < value.length && depth) {
        if (value[end] === "(") depth++;
        if (value[end] === ")") depth--;
        end++;
      }
      if (depth) fail("CSS_COLOR", "Cor CSS moderna inválida na vista do mapa.");
      const color = value.slice(start, end);
      let rgb = cache.get(color);
      if (!rgb) {
        if (!document.defaultView!.CSS.supports("color", color)) fail("CSS_COLOR", "O navegador não suporta uma cor presente no mapa.");
        context!.clearRect(0, 0, 1, 1);
        context!.fillStyle = color;
        context!.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = Array.from(context!.getImageData(0, 0, 1, 1).data);
        rgb = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
        cache.set(color, rgb);
      }
      output += value.slice(cursor, start) + rgb;
      cursor = end; modern.lastIndex = end;
    }
    return output + value.slice(cursor);
  };
  const elements = [root, ...Array.from(root.querySelectorAll("*"))];
  for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) elements.push(ancestor);
  for (const element of elements) {
    const computed = document.defaultView!.getComputedStyle(element);
    const style = (element as HTMLElement | SVGElement).style;
    if (!style) continue;
    for (const property of ["color", "background-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "outline-color", "text-decoration-color", "box-shadow", "text-shadow", "background-image"]) {
      const value = computed.getPropertyValue(property);
      if (/\b(?:oklch|oklab|lab|lch|color)\(/i.test(value)) style.setProperty(property, convert(value), "important");
    }
  }
  canvas.width = canvas.height = 0;
}

/**
 * Snapshot of current rendered Leaflet pixels, not a re-request at print DPI.
 * Strictly rejects unavailable/CORS-blocked resources and view/layer changes.
 * html2canvas itself has no cancellation API: callers reject promptly, while any
 * already-started bounded raster render may finish in the background and is cleaned up.
 */
export async function captureMapSnapshot(map: L.Map, options: CaptureMapSnapshotOptions = {}): Promise<MapPrintSnapshot> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) fail("TIMEOUT_OPTION", "O tempo limite deve estar entre 1 e 60000 ms.");
  const guard = makeGuard(options.signal, timeoutMs);
  let observer: MutationObserver | undefined;
  let frame: HTMLIFrameElement | null = null;
  let mapListenerAttached = false;
  const events = "movestart move zoomstart zoom zoomanim resize layeradd layerremove unload";
  const changed = () => guard.stop(new MapPrintCaptureError("VIEW_CHANGED", "A vista ou as camadas mudaram durante a captura. Mantenha o mapa parado e tente novamente."));
  try {
    guard.check();
    if (typeof window === "undefined" || !map || typeof map.getContainer !== "function") fail("MAP_UNINITIALIZED", "Mapa Leaflet não inicializado.");
    const container = map.getContainer();
    if (!container?.isConnected || !container.ownerDocument.defaultView) fail("MAP_UNINITIALIZED", "O mapa precisa estar montado e visível para capturar.");
    const internal = map as L.Map & { _loaded?: boolean; _animatingZoom?: boolean; _panAnim?: { _inProgress?: boolean } };
    if (!internal._loaded) fail("MAP_UNINITIALIZED", "Mapa Leaflet ainda não inicializado; aguarde o carregamento.");
    if (map.options.crs?.code !== "EPSG:3857") fail("CRS_UNSUPPORTED", "A captura suporta somente o CRS real EPSG:3857.");
    if (internal._animatingZoom || internal._panAnim?._inProgress || container.classList.contains("leaflet-zoom-anim")) fail("MAP_MOVING", "Aguarde o fim do movimento/zoom antes de capturar.");
    const size = map.getSize(), width = container.clientWidth, height = container.clientHeight;
    assertMapPrintSize(width, height, options.maxPixels ?? MAP_PRINT_MAX_PIXELS);
    if (size.x !== width || size.y !== height) fail("MAP_SIZE_STALE", "O tamanho Leaflet não coincide com a vista. Aguarde a atualização do mapa.");
    const rect = container.getBoundingClientRect();
    if (!visible(container, container) || Math.abs(rect.width - width) > 1 || Math.abs(rect.height - height) > 1) fail("MAP_LAYOUT", "Mapa oculto, com borda ou transformação CSS: a captura não pode garantir seus limites reais.");
    const bounds = readBounds(map), zoom = map.getZoom();
    if (!Number.isFinite(zoom)) fail("MAP_UNINITIALIZED", "O nível de zoom do mapa não é válido.");
    const checkStable = () => {
      guard.check();
      const current = readBounds(map), currentSize = map.getSize(), currentRect = container.getBoundingClientRect();
      if (!container.isConnected || map.getZoom() !== zoom || internal._animatingZoom || internal._panAnim?._inProgress ||
          currentSize.x !== width || currentSize.y !== height || container.clientWidth !== width || container.clientHeight !== height ||
          Math.abs(currentRect.width - rect.width) > 0.1 || Math.abs(currentRect.height - rect.height) > 0.1 ||
          Math.abs(currentRect.left - rect.left) > 0.1 || Math.abs(currentRect.top - rect.top) > 0.1 ||
          (Object.keys(bounds) as Array<keyof MapPrintBounds>).some(key => Math.abs(current[key] - bounds[key]) > 1e-9)) {
        changed(); guard.check();
      }
    };
    map.on(events, changed); mapListenerAttached = true;
    inspectMapPrintTiles(map); // Already failed tiles must not wait for the deadline.
    await delay(guard, 80); checkStable();
    // isLoading() covers offscreen keepBuffer tiles too. For registered grids,
    // wait only for the current viewport, including CSS-hidden pending images.
    const waitForResources = async () => {
      while (true) {
        guard.check(); checkStable();
        const tiles = inspectMapPrintTiles(map);
        let loading = tiles.pending;
        map.eachLayer(layer => {
          const candidate = layer as L.Layer & { _tiles?: unknown; isLoading?: () => boolean };
          if (!candidate._tiles && candidate.isLoading?.()) loading = true;
        });
        const images = Array.from(container.querySelectorAll("img"))
          .filter(image => !tiles.managedImages.has(image) && visible(image, container));
        if (!loading && images.every(image => image.complete)) return tiles;
        await delay(guard, 50);
      }
    };
    await waitForResources();
    if (container.ownerDocument.fonts?.ready) await guard.wait(container.ownerDocument.fonts.ready);
    checkStable();
    // From this point even geometry/style changes without a bounds change invalidate
    // capture. Tile fade-in is allowed to settle before this strict freeze.
    await delay(guard, 250); checkStable();
    const tiles = await waitForResources();
    const checkTiles = () => {
      if (inspectMapPrintTiles(map).pending) fail("MAP_RESOURCE", "Uma camada ativa voltou a carregar tiles durante a captura. Aguarde o carregamento e tente novamente; nenhuma captura parcial foi gerada.");
    };
    const affectsCapture = (record: MutationRecord) => mapPrintMutationAffectsCapture(record, tiles.ignoredTiles);
    const ignoreElement = (element: Element) => shouldIgnoreMapPrintElement(element) || inIgnoredTile(element, tiles.ignoredTiles);
    observer = new MutationObserver(records => {
      try {
        checkTiles();
        if (records.some(affectsCapture)) changed();
      } catch (error) { guard.stop(error as Error); }
    });
    observer.observe(container, { attributes: true, childList: true, characterData: true, subtree: true });
    const resources = await prepareResources(container, guard, checkStable, tiles);
    checkStable(); checkTiles();
    const attributions = readAttributions(map, container.ownerDocument);
    const legend = (options.legend ?? []).map(item => {
      if (!item || typeof item.label !== "string" || !item.label.trim() || item.label.length > 500 ||
          (item.color !== undefined && (typeof item.color !== "string" || item.color.length > 100))) {
        return fail("LEGEND_INVALID", "Legenda fornecida contém item inválido.");
      }
      return { label: item.label, ...(item.color ? { color: item.color } : {}) };
    });
    const originals = [container, ...Array.from(container.querySelectorAll("*"))];
    const replacements = new Map<number, string>();
    const backgrounds = new Map<number, string>();
    const pseudos = new Map<number, Record<string, string>>();
    originals.forEach((element, index) => {
      const image = resources.images.get(element); if (image) replacements.set(index, image);
      const background = resources.backgrounds.get(element); if (background) backgrounds.set(index, background);
      const pseudo = resources.pseudos.get(element); if (pseudo) pseudos.set(index, pseudo);
    });
    // Use child-index paths, not transient attributes on the live map. html2canvas
    // drops ignored nodes while cloning, so a filtered tree must be matched.
    const included = originals.filter(element => !ignoreElement(element));
    const originalIndexes = new Map(originals.map((element, index) => [element, index]));
    const render = html2canvas(container, {
      scale: 1, width, height, useCORS: true, allowTaint: false,
      backgroundColor: null, logging: false, imageTimeout: Math.min(timeoutMs, 10_000),
      removeContainer: true, foreignObjectRendering: false,
      ignoreElements: ignoreElement,
      onclone: async (document, clonedContainer) => {
        frame = document.defaultView?.frameElement as HTMLIFrameElement | null;
        guard.check(); checkStable();
        const copies = [clonedContainer, ...Array.from(clonedContainer.querySelectorAll("*"))]
          .filter(element => !element.closest("html2canvaspseudoelement"));
        // html2canvas has already materialized ::before/::after as extra nodes.
        // Exclude these generated subtrees when matching the original tree.
        if (copies.length !== included.length) fail("CLONE_MISMATCH", "A estrutura visual mudou ao copiar o mapa; captura interrompida para preservar camadas.");
        const pairs = copies.map((copy, index) => ({ copy, original: included[index] }));
        const pseudoStyles = document.createElement("style");
        for (const { copy, original } of pairs) {
          guard.check();
          const index = originalIndexes.get(original)!;
          const background = backgrounds.get(index);
          if (background) (copy as HTMLElement).style.backgroundImage = background;
          const pseudo = pseudos.get(index);
          if (pseudo) {
            copy.setAttribute("data-map-print-pseudo", String(index));
            for (const [selector, value] of Object.entries(pseudo)) {
              pseudoStyles.textContent += `[data-map-print-pseudo="${index}"]${selector}{background-image:${value}!important;}\n`;
              const generated = selector === "::before" ? copy.firstElementChild : copy.lastElementChild;
              if (generated?.tagName.toLowerCase() === "html2canvaspseudoelement") {
                (generated as HTMLElement).style.backgroundImage = value;
              }
            }
          }
          const imageData = replacements.get(index);
          if (!imageData) continue;
          if (copy.tagName.toLowerCase() === "img") {
            const image = copy as HTMLImageElement;
            image.removeAttribute("srcset"); image.removeAttribute("sizes");
            image.loading = "eager"; image.src = imageData;
          } else {
            const image = document.createElement("img");
            // Preserve the actual Leaflet CSS transform/position/opacity, with
            // standalone SVG layout removed only INSIDE its raster data URL.
            for (const attribute of Array.from(copy.attributes)) {
              if (!["xmlns", "viewBox", "preserveAspectRatio", "width", "height"].includes(attribute.name)) image.setAttribute(attribute.name, attribute.value);
            }
            const sourceRect = original.getBoundingClientRect();
            const style = container.ownerDocument.defaultView!.getComputedStyle(original);
            image.style.cssText = style.cssText || (copy as HTMLElement).style.cssText;
            for (const property of ["position", "left", "top", "right", "bottom", "transform", "transform-origin", "opacity", "z-index", "display", "visibility", "margin", "padding", "border", "box-sizing"]) {
              image.style.setProperty(property, style.getPropertyValue(property));
            }
            image.style.width = style.width !== "auto" ? style.width : `${sourceRect.width}px`;
            image.style.height = style.height !== "auto" ? style.height : `${sourceRect.height}px`;
            image.src = imageData;
            copy.replaceWith(image);
          }
        }
        document.head.appendChild(pseudoStyles);
        normalizeCloneColors(document, clonedContainer);
        guard.check();
        // currentSrc may still point to the previous live URL immediately after
        // assigning src; decode the frozen PNG before html2canvas parses it.
        await guard.wait(Promise.all(Array.from(clonedContainer.querySelectorAll("img"))
          .filter(image => image.src.startsWith("data:image/png;base64,"))
          .map(image => loaded(image, guard))));
        checkStable();
      },
    });
    // Cleanup is scoped to this invocation, never another caller's capture iframe.
    render.then(() => frame?.remove(), () => frame?.remove());
    const canvas = await guard.wait(render);
    checkStable(); checkTiles();
    if (observer.takeRecords().some(affectsCapture)) { changed(); guard.check(); }
    assertMapPrintSize(canvas.width, canvas.height, options.maxPixels ?? MAP_PRINT_MAX_PIXELS);
    if (canvas.width !== width || canvas.height !== height) fail("OUTPUT_SIZE", "Dimensões do PNG divergiram da vista original.");
    let imageDataUrl: string;
    try {
      canvas.getContext("2d")!.getImageData(0, 0, 1, 1);
      imageDataUrl = canvas.toDataURL("image/png");
    } catch (error) { return fail("OUTPUT_CORS", "PNG final ilegível por restrição CORS; nenhuma imagem parcial foi entregue."); }
    if (!imageDataUrl.startsWith("data:image/png;base64,")) fail("OUTPUT_EMPTY", "O navegador não gerou um PNG válido.");
    checkStable();
    return {
      imageDataUrl, width: canvas.width, height: canvas.height, bounds,
      capturedAt: new Date().toISOString(), crs: "EPSG:3857", attributions, legend,
      warnings: [
        "Captura da vista real Leaflet na resolução de tela; não adiciona detalhe nem garante DPI de impressão.",
        "Escala e coordenadas de apresentação são aproximadas em Web Mercator; não constituem produto topográfico certificado ou conformidade NBR.",
        ...(!attributions.length ? ["Nenhuma atribuição foi informada pelas camadas ativas; verifique as licenças antes de distribuir."] : []),
      ],
    };
  } catch (error) {
    if (guard.signal.aborted) throw guard.signal.reason;
    if (error instanceof Error) {
      if (options.label) error.message = `${options.label.slice(0, 100)}: ${error.message}`;
      throw error;
    }
    throw new MapPrintCaptureError("CAPTURE_FAILED", "Falha ao capturar a vista real. Verifique as camadas e tente novamente.");
  } finally {
    observer?.disconnect();
    if (mapListenerAttached) map.off(events, changed);
    guard.dispose();
    (frame as HTMLIFrameElement | null)?.remove();
  }
}
