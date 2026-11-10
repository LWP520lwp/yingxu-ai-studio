import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwind(), {
    name: "canvas-build-transition",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        // The canvas build replaces public assets. Never let a briefly missing
        // iframe entry fall through to the platform SPA and recursively mount it.
        if (request.url?.split("?")[0] !== "/canvas-engine/index.html" ||
            existsSync(resolve(server.config.publicDir, "canvas-engine/index.html"))) return next();
        response.statusCode = 503;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="refresh" content="1"><title>正在更新画布</title><body style="margin:0;background:#191817;color:#ccc;font:14px system-ui;padding:32px">画布正在更新，请稍候…</body></html>');
      });
    },
  }],
  server: {
    proxy: {
      "^/api/projects/[^/]+/science/plan(?:\\?|$)": {
        target: process.env.VITE_API_TARGET || "http://127.0.0.1:8088",
        changeOrigin: false,
        timeout: 110000,
      },
      "^/api/jobs/[^/]+/recover(?:\\?|$)": {
        target: process.env.VITE_API_TARGET || "http://127.0.0.1:8088",
        changeOrigin: false,
        timeout: 110000,
      },
      // Supplier quota checks can take up to 65 seconds. Keep this exception
      // limited to explicit quota refreshes; ordinary API calls stay bounded.
      "^/api/pool/(?:quota/refresh|accounts/[^/]+/quota)(?:\\?|$)": {
        target: process.env.VITE_API_TARGET || "http://127.0.0.1:8088",
        changeOrigin: false,
        timeout: 110000,
      },
      ...Object.fromEntries(
      ["/api", "/oauth2", "/login"].map((prefix) => [
        prefix,
        {
          target: process.env.VITE_API_TARGET || "http://127.0.0.1:8088",
          changeOrigin: false,
          timeout: 30000,
        },
      ]),
      ),
    },
  },
  build: { chunkSizeWarningLimit: 700 },
});
