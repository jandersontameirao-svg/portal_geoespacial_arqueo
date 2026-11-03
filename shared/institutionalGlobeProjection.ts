/** Geometry/transport contract for global WMS rasters; no DOM, network or Three dependency. */
export const INSTITUTIONAL_GLOBE_BOUNDS = [-180, -90, 180, 90] as const;
export const INSTITUTIONAL_GLOBE_MAX_LAYERS = 4;
export const INSTITUTIONAL_GLOBE_ROTATION_Y = -Math.PI / 2;
export const INSTITUTIONAL_GLOBE_IMAGE_WIDTH = 512;
export const INSTITUTIONAL_GLOBE_IMAGE_HEIGHT = 256;

export interface InstitutionalGlobeImage {
  dataUrl: string;
  crs: "EPSG:4326";
  /** Always west, south, east, north; not the WMS 1.3 wire axis order. */
  bounds: [-180, -90, 180, 90];
}

/** Three UVs with Texture.flipY=true: image north is v=1, west is u=0. */
export function institutionalGlobeUv(longitude: number, latitude: number) {
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  )
    throw new Error("Coordenadas fora do domínio global EPSG:4326.");
  return { u: (longitude + 180) / 360, v: (latitude + 90) / 180 };
}

/** react-globe.gl / three-globe axes: Greenwich +Z, east +X, north +Y. */
export function institutionalGlobeCartesian(
  longitude: number,
  latitude: number,
  radius = 100
) {
  institutionalGlobeUv(longitude, latitude);
  if (!Number.isFinite(radius) || radius <= 0)
    throw new Error("Raio do globo inválido.");
  const lon = (longitude * Math.PI) / 180;
  const lat = (latitude * Math.PI) / 180;
  return {
    x: radius * Math.cos(lat) * Math.sin(lon),
    y: radius * Math.sin(lat),
    z: radius * Math.cos(lat) * Math.cos(lon),
  };
}

/** A small radial separation, below the existing project points' 1% altitude. */
export function institutionalGlobeOverlayRadius(radius: number, index: number) {
  if (!Number.isFinite(radius) || radius <= 0)
    throw new Error("Raio do globo inválido.");
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= INSTITUTIONAL_GLOBE_MAX_LAYERS
  )
    throw new Error("No máximo 4 camadas institucionais no globo.");
  return radius * (1 + 0.0005 * (index + 1));
}

export function isInstitutionalGlobeGlobalBounds(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    INSTITUTIONAL_GLOBE_BOUNDS.every(
      (coordinate, index) => value[index] === coordinate
    )
  );
}

/** Reject URLs, SVG, mislabeled PNGs and unbounded images before image decoding. */
export function assertInstitutionalGlobeImage(
  value: unknown
): asserts value is InstitutionalGlobeImage {
  if (!value || typeof value !== "object")
    throw new Error("Resposta de imagem institucional inválida.");
  const image = value as Record<string, unknown>;
  if (image.crs !== "EPSG:4326")
    throw new Error("CRS inválido: o globo requer EPSG:4326.");
  if (!isInstitutionalGlobeGlobalBounds(image.bounds))
    throw new Error(
      "BBOX inválido: o globo requer [-180,-90,180,90] em longitude/latitude."
    );
  const prefix = "data:image/png;base64,";
  if (typeof image.dataUrl !== "string" || !image.dataUrl.startsWith(prefix))
    throw new Error(
      "Imagem inválida: esperado data URL PNG base64, nunca URL externa."
    );
  // A 512x256 PNG should be far below this 8 MiB encoded ceiling.
  if (image.dataUrl.length > 8 * 1024 * 1024)
    throw new Error("PNG institucional excede o limite de tamanho.");
  const encoded = image.dataUrl.slice(prefix.length);
  if (
    encoded.length < 44 ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    throw new Error("PNG institucional contém base64 inválido.");
  // Decode only its header here. The browser must still decode the complete PNG.
  const header = atob(encoded.slice(0, 44));
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    signature.some((byte, index) => header.charCodeAt(index) !== byte) ||
    [0, 0, 0, 13].some(
      (byte, index) => header.charCodeAt(index + 8) !== byte
    ) ||
    header.slice(12, 16) !== "IHDR"
  )
    throw new Error(
      "Conteúdo inválido: a imagem não tem assinatura/cabeçalho PNG."
    );
  const uint32 = (offset: number) =>
    header.charCodeAt(offset) * 0x1000000 +
    header.charCodeAt(offset + 1) * 0x10000 +
    header.charCodeAt(offset + 2) * 0x100 +
    header.charCodeAt(offset + 3);
  if (
    uint32(16) !== INSTITUTIONAL_GLOBE_IMAGE_WIDTH ||
    uint32(20) !== INSTITUTIONAL_GLOBE_IMAGE_HEIGHT
  )
    throw new Error("Dimensões inválidas: esperado PNG global 512×256.");
}

/** Identity, not layer id alone: a disabled/re-enabled id must reject its old request. */
export function isInstitutionalGlobeRequestCurrent<T>(
  signal: AbortSignal,
  request: T,
  current: T | undefined
): boolean {
  return !signal.aborted && request === current;
}
