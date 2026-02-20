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
    const episodeSlug = ep.episodeNumber ?? ep.id;
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

function buildDescription(ep: EpisodeMeta): string {
  const body = textToHtml(ep.description ?? ep.cleanTitle);
  return `${body}<br>\n<hr>\nOriginal: <a href="${ep.bandcampUrl}">${ep.bandcampUrl}</a>`;
}

function linkifyUrls(text: string): string {
  return text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
}

function textToHtml(text: string): string {
  return linkifyUrls(text.replace(/\r\n/g, "\n")).replace(/\n/g, "<br>\n");
}
