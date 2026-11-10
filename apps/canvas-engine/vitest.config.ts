import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
    resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
    test: { include: ["src/platform/**/*.test.ts"], environment: "node" },
});
