import { createHash } from "node:crypto";
import { Podcast } from "podcast";

import type { PodcastConfig } from "../schemas/config.js";
import type { EpisodeMeta } from "../schemas/episode.js";

import { getEpisodeFileSize } from "./audio.js";

export async function generateFeed(
  podcastSlug: string,
  config: PodcastConfig,
  episodes: EpisodeMeta[],
  baseUrl: string,
): Promise<string> {
  const feedUrl = `${baseUrl}/${podcastSlug}/feed.xml`;
  const siteUrl = config.bandcampUrl;
  const imageUrl = `${baseUrl}/${podcastSlug}/artwork.jpg`;

  const feed = new Podcast({
    author: config.author,
    customElements: [
      { "podcast:locked": "no" },
      { "podcast:guid": uuidv5(feedUrl) },
      {
        "podcast:funding": {
          _attr: { url: config.bandcampUrl },
          _cdata: `Support ${config.title}`,
        },
      },
    ],
    description: config.description ?? config.title,
    feedUrl,
    imageUrl,
    itunesAuthor: config.author,
    itunesCategory: config.category
      ? [
          {
            subcats: config.subcategory ? [{ text: config.subcategory }] : [],
            text: config.category,
          },
        ]
      : [],
    itunesExplicit: config.explicit,
    itunesImage: imageUrl,
    itunesType: "episodic",
    language: config.language,
    siteUrl,
    title: config.title,
    ttl: 60,
  });

  // Only include episodes that have an episode number and aren't skipped
  const feedEpisodes = episodes
    .filter((ep) => !ep.skipped && ep.episodeNumber !== undefined)
    .sort((a, b) => {
      const dateA = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
      const dateB = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
      return dateB - dateA;
    });

  for (const ep of feedEpisodes) {
    const totalDurationMs = ep.tracks.reduce((sum, t) => sum + t.durationMs, 0);
    const durationSeconds = Math.round(totalDurationMs / 1000);
    const episodeSlug = ep.id;
    const enclosureUrl = `${baseUrl}/${podcastSlug}/episode/${episodeSlug}.mp3`;
    const episodeImageUrl = ep.artworkFilename
      ? `${baseUrl}/${podcastSlug}/episode/${episodeSlug}/artwork.jpg`
      : undefined;

    const fileSize = await getEpisodeFileSize(podcastSlug, ep.id);

    feed.addItem({
      author: config.author,
      date: ep.releaseDate ? new Date(ep.releaseDate) : new Date(),
      description: buildDescription(ep),
      enclosure: {
        size: fileSize ?? 0,
        type: "audio/mpeg",
        url: enclosureUrl,
      },
      guid: `${podcastSlug}-${ep.id}`,
      itunesAuthor: config.author,
      itunesDuration: durationSeconds,
      itunesEpisode: ep.episodeNumber,
      itunesEpisodeType: "full",
      itunesExplicit: config.explicit,
      itunesImage: episodeImageUrl,
      itunesTitle: ep.cleanTitle,
      title: ep.title,
      url: ep.bandcampUrl,
    });
  }

  return feed.buildXml({ indent: "  " });
}

/** Generate a deterministic UUIDv5 from a name using the URL namespace. */
export function uuidv5(name: string): string {
  // RFC 4122 URL namespace: 6ba7b811-9dad-11d1-80b4-00c04fd430c8
  const nsBytes = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");
  const hash = createHash("sha1").update(nsBytes).update(name).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8]! & 0x3f) | 0x80; // variant RFC 4122
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function buildDescription(ep: EpisodeMeta): string {
  let body: string;
  if (ep.description) {
    body = textToHtml(ep.description);
  } else {
    // Build a fallback description from available metadata
    const parts: string[] = [ep.cleanTitle];
    if (ep.credits) parts.push(ep.credits);
    if (ep.tracks.length > 0) {
      parts.push("Tracklist:");
      for (const t of ep.tracks) {
        parts.push(`${t.position}. ${t.title}`);
      }
    }
    body = textToHtml(parts.join("\n"));
  }
  return `${body}<br>\n<hr>\nOriginal: <a href="${ep.bandcampUrl}">${ep.bandcampUrl}</a>`;
}

function linkifyUrls(text: string): string {
  return text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
}

function textToHtml(text: string): string {
  return linkifyUrls(text.replace(/\r\n/g, "\n")).replace(/\n/g, "<br>\n");
}
