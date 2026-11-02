import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { defineConfig } from "vite";
/** Harness local apenas: sem config do aplicativo, plugin Manus, dotenv ou backend. */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: false,
  cacheDir: process.env.PANELS_ATENA_VITE_CACHE_DIR || "/tmp/atena-panels-visual-vite-cache",
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "client/src"), "@shared": path.resolve(import.meta.dirname, "shared") } },
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: false,
  server: { host: "127.0.0.1", port: 4183, strictPort: true, open: false, fs: { strict: true, deny: ["**/.*"] } },
});
