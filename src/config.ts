import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { type AppConfig, AppConfigSchema, type PodcastConfig } from "./schemas/config.js";

const configPath = resolve(process.cwd(), "podcasts.json");
const raw: unknown = JSON.parse(readFileSync(configPath, "utf-8"));
const appConfig: AppConfig = AppConfigSchema.parse(raw);

export function getAllConfigs(): AppConfig {
  return appConfig;
}

export function getAllSlugs(): string[] {
  return Object.keys(appConfig);
}

export function getConfigBySlug(slug: string): PodcastConfig | undefined {
  return appConfig[slug];
}
