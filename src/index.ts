import { Debundle } from "./debundle";
import { WebpackDebundle } from "./webpack-debundle";

export function debundle(
  files: Record<string, string>,
  knownEntry?: string
): Debundle {
  // TODO once we support multiple bundle types this should automatically select the right Debundle child class
  return new WebpackDebundle(files, knownEntry);
}
