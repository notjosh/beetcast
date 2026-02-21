import { parseEpisodeTitle } from "./parse-episode-number.js";

describe("parseEpisodeTitle", () => {
  it("parses standard episode title with #", () => {
    expect(parseEpisodeTitle("OMSB Podcast #193 Mercy Necromancy")).toEqual({
      cleanTitle: "Mercy Necromancy",
      episodeNumber: 193,
      episodePart: undefined,
    });
  });

  it("parses multi-part episode with zero-width spaces", () => {
    // Zero-width spaces (\u200B) around the dash
    expect(parseEpisodeTitle("Something Podcast #78\u200B-\u200BA Some Title")).toEqual({
      cleanTitle: "Some Title",
      episodeNumber: 78,
      episodePart: "A",
    });
  });

  it("parses simple numbered episode", () => {
    expect(parseEpisodeTitle("Podcast #42 Some Title")).toEqual({
      cleanTitle: "Some Title",
      episodeNumber: 42,
      episodePart: undefined,
    });
  });

  it("returns no match for title without podcast keyword", () => {
    expect(parseEpisodeTitle("No Number Here")).toEqual({
      cleanTitle: "No Number Here",
      episodeNumber: undefined,
      episodePart: undefined,
    });
  });

  it("matches without # since hash is optional in the regex", () => {
    // The regex uses #? so hash is optional
    expect(parseEpisodeTitle("OMSB podcast 5 Title")).toEqual({
      cleanTitle: "Title",
      episodeNumber: 5,
      episodePart: undefined,
    });
  });
});
