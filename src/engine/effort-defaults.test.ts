import { describe, expect, it } from "vitest";
import { DEFAULT_LOC_RATES, getLocRate } from "./effort-defaults.js";

describe("effort-defaults", () => {
  it("should have correct compiled-in rates", () => {
    expect(DEFAULT_LOC_RATES.TS).toBe(50);
    expect(DEFAULT_LOC_RATES.Rust).toBe(35);
    expect(DEFAULT_LOC_RATES.Python).toBe(65);
    expect(DEFAULT_LOC_RATES.DE).toBe(25);
  });

  it("should return the correct rate for a profile", () => {
    expect(getLocRate("TS")).toBe(50);
    expect(getLocRate("Rust")).toBe(35);
    expect(getLocRate("DE")).toBe(25);
  });

  it("should fallback to TS rate for unknown profile", () => {
    expect(getLocRate("Unknown")).toBe(50);
  });
});
