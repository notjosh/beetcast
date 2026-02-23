import pino from "pino";

import { getAllConfigs } from "../config.js";
import { parseDuration } from "../lib/duration.js";
import { discoverEpisodes, syncUnsyncedEpisodes } from "./bandcamp.js";
import { operationQueue } from "./operation-queue.js";

const log = pino({ name: "scheduler" });
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function resetScheduler(slug: string): void {
  scheduleRefresh(slug);
}

export function startScheduler(): void {
  for (const slug of Object.keys(getAllConfigs())) {
    runRefresh(slug);
    scheduleRefresh(slug);
  }
}

export function stopScheduler(): void {
  for (const timer of timers.values()) {
    clearTimeout(timer);
  }
  timers.clear();
}

function runRefresh(slug: string): void {
  const config = getAllConfigs()[slug];
  if (!config) {
    return;
  }

  log.info({ slug }, "Scheduled refresh starting");
  operationQueue.submit("discover", { podcastSlug: slug, podcastTitle: config.title }, async () => {
    await discoverEpisodes(slug, config);

    // Sync after discovery so newly discovered episodes get metadata fetched
    operationQueue.submit(
      "sync",
      { podcastSlug: slug, podcastTitle: config.title },
      async (onProgress) => {
        await syncUnsyncedEpisodes(slug, (progress) => {
          onProgress(Object.fromEntries(Object.entries(progress)));
        });
      },
    );
  });
}

function scheduleRefresh(slug: string): void {
  const config = getAllConfigs()[slug];
  if (!config) {
    return;
  }

  const intervalMs = parseDuration(config.refreshInterval);

  // Clear any existing timer for this slug
  const existing = timers.get(slug);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    runRefresh(slug);
    scheduleRefresh(slug);
  }, intervalMs);

  timers.set(slug, timer);
}
