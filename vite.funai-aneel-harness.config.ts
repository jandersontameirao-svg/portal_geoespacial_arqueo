import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { defineConfig } from "vite";

/** TEST ONLY. No application config, dotenv, server or database is imported. */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: false,
  envPrefix: "__FUNAI_ANEEL_TEST_NO_ENV__",
  cacheDir: "/tmp/atena-funai-aneel-harness-cache",
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "client/src"), "@shared": path.resolve(import.meta.dirname, "shared") } },
  root: path.resolve(import.meta.dirname, "client"), publicDir: false,
  server: { host: "127.0.0.1", port: 4195, strictPort: true, open: false, hmr: false, fs: { strict: true, deny: ["**/.*"] } },
});
