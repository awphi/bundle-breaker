import { buildAllExamples } from "./example";

export default async function setup(): Promise<void> {
  await buildAllExamples();
}
