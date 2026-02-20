import { z } from "zod/v4";

export const BandcampImageSchema = z.object({
  url: z.string().optional(),
});

export const BandcampTrackSchema = z.object({
  duration: z.number().optional(),
  name: z.string().optional(),
  position: z.number().optional(),
  streamUrl: z.string().optional(),
  streamUrlHQ: z.string().optional(),
  url: z.string().optional(),
});

export type BandcampTrack = z.infer<typeof BandcampTrackSchema>;

export const BandcampAlbumSchema = z.object({
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  name: z.string().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
  releaseDate: z.string().optional(),
  tracks: z.array(BandcampTrackSchema).optional(),
  url: z.string().optional(),
});

export type BandcampAlbum = z.infer<typeof BandcampAlbumSchema>;

/**
 * Schema for the ld+json structured data embedded in Bandcamp album pages.
 * We only extract the fields we need (pricing from albumRelease[0].offers).
 */
const BandcampOfferSchema = z.object({
  price: z.number(),
  priceCurrency: z.string(),
});

const BandcampReleaseSchema = z.object({
  offers: BandcampOfferSchema.optional(),
});

export const BandcampLdJsonSchema = z.object({
  albumRelease: z.array(BandcampReleaseSchema).optional(),
});

export type BandcampLdJson = z.infer<typeof BandcampLdJsonSchema>;

/**
 * bandcamp-fetch's type definitions claim basic/extra are strings,
 * but at runtime they're already JSON.parse()'d objects.
 */
export const BandcampRawDataSchema = z.object({
  basic: BandcampLdJsonSchema,
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const BandcampDiscographyItemSchema = z.object({
  imageUrl: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  url: z.string().optional(),
});

export type BandcampDiscographyItem = z.infer<typeof BandcampDiscographyItemSchema>;
