import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { defineConfig, type Plugin } from "vite";

// Self-contained synthetic PNG encoder: no assets, network or optional dependencies.
function png(red: number, green: number, blue: number, alpha = 255): Buffer {
  const crc32 = (data: Buffer) => {
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, payload: Buffer) => {
    const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(payload.length); crc.writeUInt32BE(crc32(Buffer.concat([name, payload])));
    return Buffer.concat([length, name, payload, crc]);
  };
  const head = Buffer.alloc(13); head.writeUInt32BE(256, 0); head.writeUInt32BE(256, 4); head[8] = 8; head[9] = 6;
  const scan = Buffer.alloc(256 * (256 * 4 + 1));
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = y * 1025 + 1 + x * 4;
    scan[i] = red; scan[i + 1] = green; scan[i + 2] = blue; scan[i + 3] = alpha;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(scan)), chunk("IEND", Buffer.alloc(0))]);
}
function fixtures(): Plugin {
  const blue = png(32, 112, 208), purple = png(154, 68, 204), transparentWms = png(12, 24, 72, 0);
  return {
    name: "print-harness-loopback-fixtures",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url || "/", "http://127.0.0.1:4187");
        if (url.pathname.startsWith("/api/")) {
          res.statusCode = 451; res.end("HARNESS: no HTTP API/backend permitted"); return;
        }
        if (!url.pathname.startsWith("/__print_fixture__/")) return next();
        res.setHeader("Cache-Control", "no-store");
        if (url.pathname.includes("fail")) { res.statusCode = 503; res.end("synthetic tile failure"); return; }
        res.setHeader("Content-Type", "image/png");
        res.end(url.pathname.includes("purple") ? purple : url.pathname.includes("wms") ? transparentWms : blue);
      });
    },
  };
}
// Never imports normal app/server config, dotenv, runtime plugin or public assets.
export default defineConfig({
  plugins: [fixtures(), react(), tailwindcss()],
  envDir: false,
  cacheDir: process.env.PRINT_LAYOUT_VITE_CACHE_DIR || "/tmp/atena-print-layout-vite-cache",
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: false,
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "client/src"), "@shared": path.resolve(import.meta.dirname, "shared") } },
  server: { host: "127.0.0.1", port: 4187, strictPort: true, open: false, hmr: false, fs: { strict: true, deny: ["**/.*"] } },
});
