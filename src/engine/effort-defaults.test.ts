import { describe, expect, it } from "vitest";
import { DEFAULT_LOC_RATES, getLocRate } from "./effort-defaults.js";

describe("effort-defaults", () => {
  it("should have correct default rates", () => {
    expect(DEFAULT_LOC_RATES.TS).toBe(50);
    expect(DEFAULT_LOC_RATES.Rust).toBe(35);
    expect(DEFAULT_LOC_RATES.Python).toBe(65);
    expect(DEFAULT_LOC_RATES.DE).toBe(25);
  });

  describe("getLocRate", () => {
    it("should return correct rate for known profiles", () => {
      expect(getLocRate("TS")).toBe(50);
      expect(getLocRate("Rust")).toBe(35);
      expect(getLocRate("Python")).toBe(65);
      expect(getLocRate("DE")).toBe(25);
    });

    it("should fallback to TS for unknown profiles", () => {
      expect(getLocRate("Unknown")).toBe(50);
    });

    it("should fallback to TS for missing profile", () => {
      expect(getLocRate()).toBe(50);
    });
  });
});
