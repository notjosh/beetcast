import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

/** Rewrite /admin routes to /admin.html so Vite serves the SPA in dev mode. */
function adminSpaFallback(): Plugin {
  return {
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === "/") {
          res.writeHead(302, { Location: "/admin" });
          res.end();
          return;
        }
        if (req.url && (req.url === "/admin" || req.url.startsWith("/admin/"))) {
          req.url = "/admin.html";
        }
        next();
      });
    },
    name: "admin-spa-fallback",
  };
}

function getGitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return process.env["GIT_HASH"] ?? "dev";
  }
}

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: "../dist/frontend",
    rollupOptions: {
      input: path.resolve(import.meta.dirname, "frontend/admin.html"),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env["npm_package_version"] ?? "0.0.0"),
    __GIT_HASH__: JSON.stringify(getGitHash()),
  },
  plugins: [adminSpaFallback(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "frontend/src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  root: "frontend",
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/health": "http://localhost:3000",
      "^/[^/]+/(feed\\.xml|artwork\\.jpg|episode/)": "http://localhost:3000",
    },
  },
});
