import type { Bundle, RawBundle } from "./types";

export interface Debundler {
  readonly name: string;
  detect(bundle: RawBundle): number;
  split(bundle: RawBundle): Bundle;
}

// TODO test
export function findDebundler(
  bundle: RawBundle,
  debundlers: Debundler[]
): Debundler {
  let bestMatch: Debundler | null = null;
  let bestScore = 0;
  for (const debundler of debundlers) {
    const score = debundler.detect(bundle);
    if (score > bestScore) {
      bestMatch = debundler;
      bestScore = score;
    }
  }
  if (bestMatch === null) {
    const names = debundlers.map((d) => d.name).join(", ");
    throw new Error(
      `No suitable debundler found for the given bundle. Available debundlers: ${names}`
    );
  }
  return bestMatch;
}
