import { parseDuration } from "./duration.js";

describe("parseDuration", () => {
  it("parses minutes", () => {
    expect(parseDuration("30m")).toBe(30 * 60_000);
  });

  it("parses hours", () => {
    expect(parseDuration("12h")).toBe(12 * 3_600_000);
  });

  it("parses days", () => {
    expect(parseDuration("1d")).toBe(86_400_000);
  });

  it("parses fractional values", () => {
    expect(parseDuration("1.5h")).toBe(1.5 * 3_600_000);
  });

  it("throws on invalid input", () => {
    expect(() => parseDuration("abc")).toThrow('Invalid duration: "abc"');
    expect(() => parseDuration("12")).toThrow();
    expect(() => parseDuration("12x")).toThrow();
    expect(() => parseDuration("")).toThrow();
  });
});
