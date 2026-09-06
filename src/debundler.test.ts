import { describe, expect, it } from "vitest";
import { findDebundler, type Debundler } from "./debundler";
import type { RawBundle } from "./types";

const bundle: RawBundle = { files: new Map() };

function stubDebundler(name: string, score: number): Debundler {
  return {
    name,
    detect: () => score,
    split: () => {
      throw new Error("not implemented");
    },
  };
}

describe("findDebundler", () => {
  it("returns the debundler with the highest detect score", () => {
    const low = stubDebundler("low", 1);
    const high = stubDebundler("high", 5);

    const result = findDebundler(bundle, [low, high]);

    expect(result).toBe(high);
  });

  it("keeps the earlier debundler when scores tie", () => {
    const first = stubDebundler("first", 3);
    const second = stubDebundler("second", 3);

    const result = findDebundler(bundle, [first, second]);

    expect(result).toBe(first);
  });

  it("throws listing all candidate names when none score above zero", () => {
    const a = stubDebundler("a", 0);
    const b = stubDebundler("b", 0);

    expect(() => findDebundler(bundle, [a, b])).toThrow(/a, b/);
  });
});
