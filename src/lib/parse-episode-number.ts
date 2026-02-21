export interface ParsedTitle {
  cleanTitle: string;
  episodeNumber: number | undefined;
  episodePart: string | undefined;
}

export function parseEpisodeTitle(title: string): ParsedTitle {
  // Match patterns like:
  //   "PODCAST #193 Mercy Necromancy"
  //   "Podcast #42 Some Title"
  //   "Something Podcast #7 - Some Title"
  //   "Podcast #78​-​A"  (two-parter with optional zero-width spaces around dash)
  //   "Podcast #78​-​B"
  const match =
    /^(?:\S+\s+)?podcast\s*#?(\d+)[\s\u200B]*(?:-[\s\u200B]*([A-Za-z])\b)?[\s\u200B:-]*(.*)$/i.exec(
      title,
    );
  if (match) {
    const numStr = match[1];
    if (numStr !== undefined) {
      const partStr = match[2]?.toUpperCase();
      const titleStr = match[3]?.trim();
      return {
        cleanTitle: titleStr ?? title,
        episodeNumber: parseInt(numStr, 10),
        episodePart: partStr,
      };
    }
  }
  return { cleanTitle: title, episodeNumber: undefined, episodePart: undefined };
}
