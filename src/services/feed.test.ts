import type { PodcastConfig } from "../schemas/config.js";
import type { EpisodeMeta, TrackMeta } from "../schemas/episode.js";

import { buildChaptersJson, buildPscChapters, generateFeed, uuidv5 } from "./feed.js";

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

const sampleTracks: TrackMeta[] = [
  { durationMs: 180_000, filename: "01.mp3", position: 1, slug: "intro", title: "Intro" },
  { durationMs: 300_000, filename: "02.mp3", position: 2, slug: "main", title: "Main Segment" },
  { durationMs: 90_500, filename: "03.mp3", position: 3, slug: "outro", title: "Outro" },
];

describe("buildPscChapters", () => {
  it("produces correct NPT start times from cumulative track durations", () => {
    const chapters = buildPscChapters(sampleTracks);
    expect(chapters).toEqual([
      { start: "00:00:00.000", title: "Intro" },
      { start: "00:03:00.000", title: "Main Segment" },
      { start: "00:08:00.000", title: "Outro" },
    ]);
  });

  it("sorts tracks by position regardless of input order", () => {
    const reversed = [...sampleTracks].reverse();
    const chapters = buildPscChapters(reversed);
    assert(chapters[0]);
    assert(chapters[2]);
    expect(chapters[0].title).toBe("Intro");
    expect(chapters[2].title).toBe("Outro");
  });

  it("formats hours correctly for long episodes", () => {
    const longTracks: TrackMeta[] = [
      { durationMs: 3_661_500, filename: "01.mp3", position: 1, slug: "a", title: "A" },
      { durationMs: 1000, filename: "02.mp3", position: 2, slug: "b", title: "B" },
    ];
    const chapters = buildPscChapters(longTracks);
    expect(chapters).toEqual([
      { start: "00:00:00.000", title: "A" },
      { start: "01:01:01.500", title: "B" },
    ]);
  });
});

describe("buildChaptersJson", () => {
  it("produces correct startTime in seconds", () => {
    const result = buildChaptersJson(sampleTracks);
    expect(result.version).toBe("1.2.0");
    expect(result.chapters).toEqual([
      { startTime: 0, title: "Intro" },
      { startTime: 180, title: "Main Segment" },
      { startTime: 480, title: "Outro" },
    ]);
  });

  it("sorts tracks by position regardless of input order", () => {
    const reversed = [...sampleTracks].reverse();
    const result = buildChaptersJson(reversed);
    assert(result.chapters[0]);
    assert(result.chapters[2]);
    expect(result.chapters[0].title).toBe("Intro");
    expect(result.chapters[2].title).toBe("Outro");
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
