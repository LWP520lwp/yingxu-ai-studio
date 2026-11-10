import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  base: "/canvas-engine/",
  plugins: [react()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") }, dedupe: ["react", "react-dom"] },
  define: { __APP_VERSION__: JSON.stringify("映序 Canvas") },
  build: { outDir: "../web/public/canvas-engine", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
