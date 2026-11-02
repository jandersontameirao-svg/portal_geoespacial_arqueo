import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { defineConfig } from "vite";

/**
 * Servidor de validação visual exclusivamente local.
 * Não usa vitePluginManusRuntime, backend, OAuth ou configuração do Portal.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  server: {
    host: "127.0.0.1",
    port: 4178,
    strictPort: true,
    fs: { strict: true, deny: ["**/.*"] },
  },
});
