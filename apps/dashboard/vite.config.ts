import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { handleDashboardApi, writeApiResult } from "../../src/dash/api.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function dashboardApi(): Plugin {
  return {
    name: "samaritan-dashboard-api",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        const result = await handleDashboardApi(url.pathname, repoRoot, { method: request.method ?? "GET" });
        if (!result) {
          next();
          return;
        }
        writeApiResult(response, result, request.method === "HEAD");
      });
    }
  };
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: fileURLToPath(new URL("../../public", import.meta.url)),
  plugins: [react(), dashboardApi()],
  build: {
    // Sites binds static assets from the conventional dist/client directory;
    // dist/server/index.js is the Worker entry point packaged alongside it.
    outDir: "dist/client",
    emptyOutDir: true
  },
  server: {
    host: "127.0.0.1",
    port: 4173
  }
});
