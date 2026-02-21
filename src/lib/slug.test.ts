import { slugify } from "./slug.js";

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("replaces non-alphanumeric characters with hyphens", () => {
    expect(slugify("OMSB Podcast #193")).toBe("omsb-podcast-193");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("--leading--trailing--")).toBe("leading-trailing");
  });

  it("replaces accented characters with hyphens", () => {
    expect(slugify("café résumé")).toBe("caf-r-sum");
  });
});
