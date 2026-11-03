import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { defineConfig } from "vite";

/** Offline evaluation only: no application config, dotenv, backend or runtime plugins. */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: false,
  envPrefix: "__INDE_HARNESS_NO_CLIENT_ENV__",
  cacheDir: process.env.INDE_HARNESS_CACHE_DIR || "/tmp/atena-inde-harness-vite-cache",
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "client/src"), "@shared": path.resolve(import.meta.dirname, "shared") } },
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: false,
  server: { host: "127.0.0.1", port: 4191, strictPort: true, open: false, hmr: false, fs: { strict: true, deny: ["**/.*"] } },
});
