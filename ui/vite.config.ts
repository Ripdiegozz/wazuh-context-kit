import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// Phase 1.5 inspector UI. Talks only to the local `wazuh-ctx serve` API
// (see /api proxy below) -- no external calls, no CDN fonts, no analytics.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4590",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
