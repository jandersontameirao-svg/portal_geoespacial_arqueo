import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractKmlFromKmz, readResponseBytesLimited } from "../../client/src/lib/kml-file-viewer";

const smallKml = `<?xml version="1.0" encoding="UTF-8"?><kml><Document><Placemark><name>synthetic</name></Placemark></Document></kml>`;

async function makeKmz(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

describe("KML/KMZ bounded file reading", () => {
  it("extracts KML from the original KMZ bytes, preferring a unique doc.kml", async () => {
    const archive = await makeKmz({
      "doc.kml": smallKml,
      "styles/extra.kml": "<kml><Document /></kml>",
      "icons/pixel.bin": "synthetic local asset",
    });

    await expect(extractKmlFromKmz(archive)).resolves.toBe(smallKml);
  });

  it("rejects a raw response exceeding the compressed file limit", async () => {
    const archive = await makeKmz({ "doc.kml": smallKml });
    await expect(extractKmlFromKmz(archive, { limits: { maxArchiveBytes: archive.byteLength - 1 } }))
      .rejects.toThrow(/limite comprimido/i);
  });

  it("rejects expanded archive size before inflating any entry", async () => {
    const archive = await makeKmz({ "doc.kml": smallKml, "assets/large.txt": "x".repeat(512) });
    await expect(extractKmlFromKmz(archive, { limits: { maxTotalUncompressedBytes: 128 } }))
      .rejects.toThrow(/limite total descompactado/i);
  });

  it("rejects a KML entry whose declared expansion exceeds its per-entry cap", async () => {
    const archive = await makeKmz({ "doc.kml": "<kml>" + "x".repeat(256) + "</kml>" });
    await expect(extractKmlFromKmz(archive, { limits: { maxKmlBytes: 64 } }))
      .rejects.toThrow(/KML interno excede/i);
  });

  it("rejects a KMZ without KML and an ambiguous archive without doc.kml", async () => {
    const noKml = await makeKmz({ "readme.txt": "synthetic" });
    const ambiguous = await makeKmz({ "one.kml": smallKml, "two.kml": smallKml });
    await expect(extractKmlFromKmz(noKml)).rejects.toThrow(/Nenhum arquivo KML/i);
    await expect(extractKmlFromKmz(ambiguous)).rejects.toThrow(/vários KML/i);
  });

  it("enforces the ZIP entry count cap", async () => {
    const archive = await makeKmz({ "doc.kml": smallKml, "one.txt": "1", "two.txt": "2" });
    await expect(extractKmlFromKmz(archive, { limits: { maxZipEntries: 2 } }))
      .rejects.toThrow(/limite de 2 entradas/i);
  });

  it("reads an HTTP body incrementally and cancels when its actual bytes exceed the cap", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
      },
      cancel() { cancelled = true; },
    });
    const response = new Response(body);
    await expect(readResponseBytesLimited(response, 12)).rejects.toThrow(/limite de visualização/i);
    expect(cancelled).toBe(true);
  });

  it("stops a pending HTTP read when the owning file load is cancelled", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() { cancelled = true; },
    });
    const controller = new AbortController();
    const read = readResponseBytesLimited(new Response(body), 32, controller.signal);
    controller.abort(new Error("Leitura cancelada por troca de arquivo."));
    await expect(read).rejects.toThrow(/troca de arquivo/i);
    expect(cancelled).toBe(true);
  });
});
