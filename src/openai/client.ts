import generate from "@babel/generator";
import { Debundle } from "../debundle/debundle";
import OpenAI from "openai";
import { type AbstractPage } from "openai/core.mjs";
import * as prompts from "./prompts";

export type ModelType = "gpt-4-turbo" | "gpt-4o";

const apiIdDelimiter = "_";

function formatApiItemId(...parts: string[]): string {
  return `bundle-breaker${apiIdDelimiter}` + parts.join(apiIdDelimiter);
}

/**
 * Helper to iterate over a paginated API result. Can return `true` from the callback to return early.
 */
async function forEachPaginatedResult<R>(
  result: AbstractPage<R>,
  callback: (item: R) => true | void
): Promise<void> {
  let page = result;
  while (page) {
    for (const item of page.getPaginatedItems()) {
      const result = callback(item);
      if (result) {
        return;
      }
    }

    try {
      page = await page.getNextPage();
    } catch (_) {
      page = undefined;
    }
  }
}

/**
 * A client to interface with OpenAI's assistants API. Each client is bound to a single model.
 * We create one assistant per model as requested with ID `bundle_breaker_${MODEL_NAME}`.
 */
export class OpenAIAssistant {
  private openai: OpenAI;
  private assistant: OpenAI.Beta.Assistant | undefined;

  constructor(
    apiKey: string = process.env["OPENAI_API_KEY"],
    readonly model: ModelType = "gpt-4o"
  ) {
    this.openai = new OpenAI({
      apiKey,
    });
  }

  async getOrCreateAssistant(): Promise<OpenAI.Beta.Assistants.Assistant> {
    if (this.assistant === undefined) {
      const assistantName = formatApiItemId(this.model);
      const existingAssistants = await this.openai.beta.assistants.list();
      let found = false;

      await forEachPaginatedResult<OpenAI.Beta.Assistant>(
        existingAssistants,
        (item) => {
          if (item.name === assistantName) {
            this.assistant = item;
            found = true;
            return true;
          }
        }
      );

      if (!found) {
        this.assistant = await this.openai.beta.assistants.create({
          name: assistantName,
          tools: [{ type: "file_search" }],
          model: this.model,
        });
      }
    }

    return this.assistant;
  }

  private async uploadOrGetFiles(
    files: Record<string, File>,
    purpose: "assistants" = "assistants"
  ): Promise<OpenAI.FileObject[]> {
    const result: Record<string, OpenAI.FileObject | undefined> =
      Object.fromEntries(Object.keys(files).map((a) => [a, undefined]));

    const allFiles = await this.openai.files.list({ purpose });

    // first try and retrieve existing files and add them to the result object
    await forEachPaginatedResult<OpenAI.FileObject>(allFiles, (file) => {
      if (file.filename in files) {
        if (result[file.filename] !== undefined) {
          throw new Error(`Duplicate file name detected - '${file.filename}'.`);
        }

        result[file.filename] = file;
      }
    });

    // now any files that couldn't be retrieved (i.e. are still undefined in the results object) need to be uploaded
    await Promise.all(
      Object.keys(result).map(async (fileName) => {
        if (result[fileName] === undefined) {
          const fileResult = await this.openai.files.create({
            file: files[fileName],
            purpose,
          });

          result[fileName] = fileResult;
        }

        return Promise.resolve();
      })
    );

    const filesResult = Object.values(result);
    if (filesResult.some((a) => a === undefined)) {
      throw new Error(`Failed to upload or get files.`);
    }
    return filesResult;
  }

  async getOrCreateVectorStore(
    deb: Debundle
  ): Promise<OpenAI.Beta.VectorStore> {
    deb.commitAstMods();

    const vsId = formatApiItemId(deb.getId());
    const filesToUpload: Record<string, File> = {};

    for (const { ast, name } of deb.allModulesAllChunks()) {
      const fileId = formatApiItemId(deb.getId(), name);
      filesToUpload[fileId] = new File([generate(ast).code], fileId, {
        type: "text/javascript",
      });
    }

    const files = await this.uploadOrGetFiles(filesToUpload);
    const fileIds = files.map((a) => a.id);
    const existingStores = await this.openai.beta.vectorStores.list();

    let vs: OpenAI.Beta.VectorStore;

    await forEachPaginatedResult<OpenAI.Beta.VectorStore>(
      existingStores,
      (currentVs) => {
        if (currentVs.name === vsId) {
          vs = currentVs;
          return true;
        }
      }
    );

    if (vs === undefined) {
      vs = await this.openai.beta.vectorStores.create({
        file_ids: fileIds,
        name: vsId,
      });
    }

    return vs;
  }

  async computeFileRenames(
    vs: OpenAI.Beta.VectorStore
  ): Promise<Record<string, string>> {
    const assistant = await this.getOrCreateAssistant();
    const run = await this.openai.beta.threads.createAndRunPoll({
      assistant_id: assistant.id,
      instructions: prompts.renamePrompt,
      tool_resources: {
        file_search: {
          vector_store_ids: [vs.id],
        },
      },
      // force the model to use the file search to avoid garbage answers
      tool_choice: { type: "file_search" },
    });

    if (run.status !== "completed") {
      throw new Error("Failed to create assistant run for file renames.");
    }

    const messages = await this.openai.beta.threads.messages.list(
      run.thread_id
    );

    if (messages.data.length <= 0) {
      throw new Error(
        "Assistant failed to add messages to thread for file renames."
      );
    }

    if (
      messages.data[0].content.length <= 0 ||
      messages.data[0].content[0].type !== "text"
    ) {
      throw new Error(
        "Assistant failed to respond with text when creating file names."
      );
    }

    const msg = messages.data[0].content[0];
    // strip markdown code block formatting off the message
    const strippedText = msg.text.value.replace(/```(json)?/g, "");

    try {
      const json = JSON.parse(strippedText);
      const result: Record<string, string> = {};

      // drop all the bundle specific prefixing
      for (const fileId in json) {
        const fileIdParts = fileId.split(apiIdDelimiter);
        const fileName = fileIdParts[fileIdParts.length - 1];
        result[fileName] = json[fileId];
      }
      return result;
    } catch (e) {
      throw new Error(
        `Failed to parse assistant response as JSON: "${JSON.stringify(
          strippedText
        )}".`
      );
    }
  }
}
