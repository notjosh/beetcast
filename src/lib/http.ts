import type { z } from "zod/v4";

import got, { type Got } from "got";
import { createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const http: Got = got.extend({
  headers: {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": USER_AGENT,
  },
  retry: { limit: 2 },
  timeout: { request: 30_000 },
});

export async function downloadToFile(url: string, destPath: string): Promise<void> {
  const tmpPath = destPath + ".tmp";
  try {
    const readStream = http.stream(url);
    const writeStream = createWriteStream(tmpPath);
    await pipeline(readStream, writeStream);
    await rename(tmpPath, destPath);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}

export async function downloadToFileWithProgress(
  url: string,
  destPath: string,
  onProgress?: (transferred: number, total: number | undefined) => void,
): Promise<void> {
  const tmpPath = destPath + ".tmp";
  try {
    const readStream = http.stream(url);
    if (onProgress) {
      readStream.on("downloadProgress", (p) => {
        onProgress(p.transferred, p.total || undefined);
      });
    }
    const writeStream = createWriteStream(tmpPath);
    await pipeline(readStream, writeStream);
    await rename(tmpPath, destPath);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}

export async function zodGet<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  const response = await http(url, { responseType: "json" });
  return schema.parse(response.body);
}
