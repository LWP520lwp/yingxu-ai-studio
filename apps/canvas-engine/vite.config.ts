import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

export default defineConfig({
  base: "/canvas-engine/",
  plugins: [
    react(),
    {
      name: "canvas-distribution-notices",
      generateBundle() {
        const licenses = [
          ["UPSTREAM-MIT-LICENSE.txt", "legal/UPSTREAM-MIT-LICENSE.txt"],
          ["PROJECT-LICENSE.txt", "../../LICENSE"],
        ];
        for (const [name, source] of licenses) {
          this.emitFile({
            type: "asset",
            fileName: `legal/${name}`,
            source: readFileSync(resolve(import.meta.dirname, source), "utf8"),
          });
        }
      },
    },
  ],
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "src") },
    dedupe: ["react", "react-dom"],
  },
  define: { __APP_VERSION__: JSON.stringify("映序 Canvas") },
  build: {
    outDir: "../web/public/canvas-engine",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});
