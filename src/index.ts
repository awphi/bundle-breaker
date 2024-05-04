import { Debundle } from "./debundle/debundle";
import { WebpackDebundle } from "./debundle/webpack-debundle";

export function debundle(
  files: Record<string, string>,
  extension: string,
  knownEntry?: string
): Debundle {
  // TODO once we support multiple bundle types this should automatically select the right Debundle child class
  return new WebpackDebundle(files, extension, knownEntry);
}

export { WebpackDebundle };
