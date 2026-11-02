import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { defineConfig } from "vite";

/** Offline-only component harness. No application config, runtime Manus, backend or auth. */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: false,
  cacheDir: process.env.F1F2_VITE_CACHE_DIR || "/tmp/atena-f1f2-vite-cache",
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client/src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: false,
  server: {
    host: "127.0.0.1",
    port: 4181,
    strictPort: true,
    open: false,
    fs: { strict: true, deny: ["**/.*"] },
  },
});
