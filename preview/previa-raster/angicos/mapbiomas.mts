import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../../package.json", import.meta.url));
const { PNG } = createRequire(require.resolve("qrcode"))("pngjs");
const service = "https://tiles.arcgis.com/tiles/qFQYQQeTXZSPY7Fs/arcgis/rest/services/MapBiomas_Mapas_de_Cobertura_do_Solo/MapServer";
const colors: Record<string, string> = {
  "1f8d49": "Formação florestal", "7dc975": "Formação savânica", "04381d": "Mangue",
  "007785": "Floresta alagável", "02d659": "Restinga arbórea", "519799": "Campo alagado",
  "d6bc74": "Formação campestre", "fc8114": "Apicum", "ffaa5f": "Afloramento rochoso",
  ad5100: "Restinga herbácea", edde8e: "Pastagem", f5b3c8: "Soja", db7093: "Cana",
  c71585: "Arroz", ff69b4: "Algodão", f54ca9: "Outras lavouras temporárias",
  d082de: "Lavoura perene", d68fe2: "Café", "9932cc": "Citrus", "9065d0": "Dendê",
  e6ccff: "Outras lavouras perenes", "7a5900": "Silvicultura", ffefc3: "Mosaico de usos",
  ffa07a: "Praia, duna e areal", d4271e: "Área urbanizada", "9c0027": "Mineração",
  c12100: "Usina fotovoltaica", db4d4f: "Outras áreas não vegetadas",
  "2532e4": "Rio, lago e oceano", "091077": "Aquicultura", ffffff: "Não observado",
};

// The published cache mixes PNG and JPEG. Use the Pillow runtime already
// bundled with local QGIS for JPEG and keep its original display colors.
function decodeJpeg(body: Buffer): Promise<Buffer> {
  const python = process.env.PREVIA_PYTHON ?? "C:/Program Files/QGIS 3.44.12/apps/Python312/python.exe";
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-c", "import io,sys; from PIL import Image; im=Image.open(io.BytesIO(sys.stdin.buffer.read())); assert im.size==(256,256); sys.stdout.buffer.write(im.convert('RGBA').tobytes())"],
      { windowsHide: true, timeout: 10000, stdio: ["pipe", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", chunk => chunks.push(chunk));
    child.stdin.on("error", reject);
    child.on("error", reject);
    child.on("close", code => {
      const data = Buffer.concat(chunks);
      if (code === 0 && data.length === 256*256*4) resolve(data);
      else reject(Error("Não foi possível ler um tile JPEG do MapBiomas."));
    });
    child.stdin.end(body);
  });
}

const tiles = new Map<string, Promise<Buffer | undefined>>();
function getTile(key: string) {
  const cached = tiles.get(key);
  if (cached) return cached;
  const pending = fetch(service + "/tile/9/" + key, { signal: AbortSignal.timeout(12000) }).then(async response => {
    if (response.status === 404) return;
    if (!response.ok) throw Error("MapBiomas indisponível (" + response.status + ").");
    const body = Buffer.from(await response.arrayBuffer());
    if (body[0] === 0xff && body[1] === 0xd8) return decodeJpeg(body);
    if (body[0] !== 0x89) {
      if (body[0] === 0x7b && /tile not found|tile does not exist|unable to get tile/i.test(body.toString())) return;
      throw Error("Formato inesperado do tile MapBiomas " + key + ".");
    }
    const tile = PNG.sync.read(body);
    if (tile.width !== 256 || tile.height !== 256) throw Error("Dimensão inesperada do tile MapBiomas.");
    return tile.data as Buffer;
  }).catch(error => {
    tiles.delete(key);
    throw error;
  });
  if (tiles.size >= 64) tiles.delete(tiles.keys().next().value!);
  tiles.set(key, pending);
  return pending;
}

export type ThematicRaster = { url: string; legend: { color: string; name: string }[] };
export async function mapBiomasRaster(inverse: (point: [number, number]) => [number, number], west: number,
  north: number, width: number, height: number): Promise<ThematicRaster> {
  const image = new PNG({ width: 880, height: 740 });
  const samples = new Map<string, [number, number][]>();
  // Sample the public SIRGAS 2000 tiles at each projected paper pixel.
  // Preserve the color of the closest source pixel for categorical classes.
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const [lon, lat] = inverse([west + (x + .5) * width / image.width, north - (y + .5) * height / image.height]);
    const col = Math.floor((lon + 180) * 131072 / 360);
    const row = Math.floor((180 - lat) * 131072 / 360);
    const key = Math.floor(row / 256) + "/" + Math.floor(col / 256);
    if (!samples.has(key)) samples.set(key, []);
    samples.get(key)!.push([(y * image.width + x) * 4, ((row & 255) * 256 + (col & 255)) * 4]);
  }
  if (samples.size > 36) throw Error("Reduza a área de impressão do MapBiomas.");
  const used = new Set<string>();
  await Promise.all([...samples].map(async ([key, pixels]) => {
    const tile = await getTile(key);
    if (!tile) return;
    for (const [target, source] of pixels) {
      if (!tile[source + 3]) continue;
      tile.copy(image.data, target, source, source + 4);
      used.add(tile.toString("hex", source, source + 3));
    }
  }));
  if (!used.size) throw Error("O MapBiomas não retornou cobertura para a folha.");
  const legend = Object.entries(colors).filter(([color]) => used.has(color)).map(([color, name]) => ({ color: "#" + color, name }));
  if (!legend.length) throw Error("Nenhuma cor da legenda pôde ser confirmada no recorte MapBiomas.");
  return { url: "data:image/png;base64," + PNG.sync.write(image).toString("base64"), legend };
}
