import { Debundle } from "./debundle/debundle";
import { WebpackDebundle } from "./debundle/webpack-debundle";
import { OpenAIAssistant } from "./openai/client";

export function debundle(
  files: Record<string, string>,
  extension: string,
  knownEntry?: string
): Debundle {
  // TODO once we support multiple bundle types this should automatically select the right Debundle child class
  return new WebpackDebundle(files, extension, knownEntry);
}

export { WebpackDebundle, Debundle, OpenAIAssistant };
