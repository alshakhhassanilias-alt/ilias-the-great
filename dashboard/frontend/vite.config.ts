import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const BACKEND = "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  base: "/",
  server: {
    port: 5173,
    proxy: {
      "/api": { target: BACKEND, changeOrigin: true },
      "/ws": { target: BACKEND, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
    // plotly.js-dist-min is a single ~3.5 MB pre-minified bundle; keep it in its own chunk.
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        manualChunks: { plotly: ["plotly.js-dist-min"] },
      },
    },
  },
});
