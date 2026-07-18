import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: false,
  build: {
    target: "es2022",
    outDir: "dist/server",
    emptyOutDir: false,
    copyPublicDir: false,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL("./worker/index.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "index.js"
    },
    rollupOptions: {
      output: {
        entryFileNames: "index.js"
      }
    }
  }
});
