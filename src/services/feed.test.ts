import type { PodcastConfig } from "../schemas/config.js";
import type { EpisodeMeta } from "../schemas/episode.js";

import { generateFeed, uuidv5 } from "./feed.js";

vi.mock("./audio.js", () => ({
  getEpisodeFileSize: vi.fn().mockResolvedValue(12345),
}));

const config: PodcastConfig = {
  author: "Test Author",
  bandcampUrl: "https://test.bandcamp.com",
  bitrate: 96,
  channels: 1,
  explicit: false,
  language: "en",
  title: "Test Podcast",
};

function makeEpisode(
  overrides: Partial<EpisodeMeta> &
    Pick<EpisodeMeta, "bandcampUrl" | "cleanTitle" | "id" | "title">,
): EpisodeMeta {
  return {
    episodeNumberManual: false,
    merged: false,
    minimumPrice: 0,
    skipped: false,
    skippedManual: false,
    tracks: [{ durationMs: 60_000, filename: "t.mp3", position: 1, slug: "t", title: "T" }],
    ...overrides,
  };
}

const episodes: EpisodeMeta[] = [
  makeEpisode({
    bandcampUrl: "https://test.bandcamp.com/album/first",
    cleanTitle: "First Ep",
    episodeNumber: 1,
    id: "first-episode",
    releaseDate: "2024-01-01",
    title: "Podcast #1 First Ep",
  }),
  makeEpisode({
    bandcampUrl: "https://test.bandcamp.com/album/second",
    cleanTitle: "Second Ep",
    episodeNumber: 2,
    id: "second-episode",
    releaseDate: "2024-06-01",
    title: "Podcast #2 Second Ep",
  }),
  makeEpisode({
    bandcampUrl: "https://test.bandcamp.com/album/skipped",
    cleanTitle: "Skipped",
    episodeNumber: 3,
    id: "skipped-ep",
    releaseDate: "2024-03-01",
    skipped: true,
    title: "Podcast #3 Skipped",
  }),
  makeEpisode({
    bandcampUrl: "https://test.bandcamp.com/album/bonus",
    cleanTitle: "Bonus Content",
    id: "no-num",
    title: "Bonus Content",
    // no episodeNumber
  }),
];

describe("uuidv5", () => {
  it("produces a valid v5 UUID", () => {
    const id = uuidv5("https://example.com/feed.xml");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("is deterministic", () => {
    const a = uuidv5("https://example.com/feed.xml");
    const b = uuidv5("https://example.com/feed.xml");
    expect(a).toBe(b);
  });

  it("produces different UUIDs for different inputs", () => {
    const a = uuidv5("https://example.com/a");
    const b = uuidv5("https://example.com/b");
    expect(a).not.toBe(b);
  });
});

describe("generateFeed", () => {
  it("excludes skipped episodes", async () => {
    const xml = await generateFeed("test-pod", config, episodes, "http://localhost");
    expect(xml).not.toContain("skipped-ep");
    expect(xml).not.toContain("Podcast #3 Skipped");
  });

  it("excludes episodes without episodeNumber", async () => {
    const xml = await generateFeed("test-pod", config, episodes, "http://localhost");
    expect(xml).not.toContain("no-num");
  });

  it("uses ep.id (slug) in enclosure URL", async () => {
    const xml = await generateFeed("test-pod", config, episodes, "http://localhost");
    expect(xml).toContain("test-pod/episode/first-episode.mp3");
    expect(xml).toContain("test-pod/episode/second-episode.mp3");
  });

  it("sorts episodes by releaseDate descending", async () => {
    const xml = await generateFeed("test-pod", config, episodes, "http://localhost");
    const secondPos = xml.indexOf("second-episode");
    const firstPos = xml.indexOf("first-episode");
    expect(secondPos).toBeLessThan(firstPos);
  });

  it("includes expected guid values", async () => {
    const xml = await generateFeed("test-pod", config, episodes, "http://localhost");
    expect(xml).toContain("<guid");
    expect(xml).toContain("test-pod-first-episode");
    expect(xml).toContain("test-pod-second-episode");
  });
});
