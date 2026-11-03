import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { defineConfig } from "vite";
/** Offline UI only: never imports application Vite config, dotenv or runtime plugins. */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: false,
  cacheDir: process.env.IBGE_VITE_CACHE_DIR || "/tmp/atena-ibge-visual-vite-cache",
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "client/src"), "@shared": path.resolve(import.meta.dirname, "shared") } },
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: false,
  server: { host: "127.0.0.1", port: 4184, strictPort: true, open: false, hmr: false, fs: { strict: true, deny: ["**/.*"] } },
});
