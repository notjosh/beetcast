import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { logger } from "hono/logger";
import pino from "pino";

import { adminRoutes } from "./routes/admin.js";
import { podcastRoutes } from "./routes/podcast.js";

const log = pino({ name: "server" });

const app = new Hono();

app.use("*", logger());

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Basic auth — protects everything except health and public podcast GET routes
const adminUser = process.env["ADMIN_USERNAME"];
const adminPass = process.env["ADMIN_PASSWORD"];
if (adminUser && adminPass) {
  const auth = basicAuth({ password: adminPass, username: adminUser });
  app.use("*", async (c, next) => {
    if (c.req.path === "/health" || c.req.path === "/") return next();
    // Public podcast routes: feed, artwork, episode content
    if (c.req.method === "GET" && /^\/[^/]+\/(feed\.xml|artwork\.jpg|episode\/)/.test(c.req.path)) {
      return next();
    }
    return auth(c, next);
  });
}

// Admin API (consumed by the frontend on its own port)
const adminEnabled = process.env["ADMIN_ENABLED"] !== "false";
if (adminEnabled) {
  app.route("/api/admin", adminRoutes);

  // Serve frontend static assets in production
  app.use("/assets/*", serveStatic({ root: "dist/frontend" }));
  app.use("/favicon.ico", serveStatic({ path: "favicon.ico", root: "dist/frontend" }));

  // SPA routes — serve admin.html for admin UI paths
  app.get("/admin", serveStatic({ path: "admin.html", root: "dist/frontend" }));
  app.get("/admin/*", serveStatic({ path: "admin.html", root: "dist/frontend" }));
}

// Placeholder landing page
app.get("/", serveStatic({ path: "index.html", root: "dist/frontend" }));

// Podcast routes
app.route("/:podcast", podcastRoutes);

const port = parseInt(process.env["PORT"] ?? "3000", 10);
const baseUrl = process.env["BASE_URL"] ?? `http://localhost:${port}`;

log.info({ adminEnabled, baseUrl, port }, "Starting server");

serve({ fetch: app.fetch, port }, (info) => {
  log.info(`Server listening on http://localhost:${info.port}`);
});
