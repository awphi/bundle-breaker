import path from "path";
import fs from "fs/promises";
import { generate } from "escodegen";
import type {
  Bundle,
  ModuleFnMap,
  WebpackModuleMapExpression,
} from "./types.js";
import {
  parse,
  type BlockStatement,
  type CallExpression,
  type FunctionExpression,
  type Identifier,
  type Program,
} from "acorn";
// TODO maybe use recast for ast parsing/generation to make codemods easier
import * as walk from "acorn-walk";
import {
  astNodeContains,
  iifefyWebpackModuleFn,
  isIIFE,
  isSingleExpressionProgram,
  isWebpackModuleMap,
} from "./codemods.js";

/**
 * Format bytes as human-readable text.
 * https://stackoverflow.com/questions/10420352/converting-file-size-in-bytes-to-human-readable-string
 *
 * @param bytes Number of bytes.
 * @param si True to use metric (SI) units, aka powers of 1000. False to use
 *           binary (IEC), aka powers of 1024.
 * @param dp Number of decimal places to display.
 *
 * @return Formatted string.
 */
export function formatBytes(bytes: number, si = false, dp = 1): string {
  const thresh = si ? 1000 : 1024;

  if (Math.abs(bytes) < thresh) {
    return bytes + " B";
  }

  const units = si
    ? ["kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]
    : ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];
  let u = -1;
  const r = 10 ** dp;

  do {
    bytes /= thresh;
    ++u;
  } while (
    Math.round(Math.abs(bytes) * r) / r >= thresh &&
    u < units.length - 1
  );

  return bytes.toFixed(dp) + " " + units[u];
}

// auto-detection of entry file given a set of chunks via process of eliminiation
function findEntry(files: Bundle["files"]): string {
  const fileNames = Object.keys(files);
  const maybeEntry = new Set(fileNames);
  for (const file of fileNames) {
    const { ast } = files[file];

    try {
      const body = getEntryBody(file, ast);
      if (isSingleExpressionProgram(body)) {
        maybeEntry.delete(file);
      }
    } catch (e) {
      maybeEntry.delete(file);
    }
  }

  if (maybeEntry.size === 1) {
    return [...maybeEntry][0];
  }

  throw new Error(
    "Failed to auto-detect entry file. Try specying one manually with --entry <file>"
  );
}

// ensure a directory exists, is a directory and optionall is empty
export async function ensureDirectory(
  pthIn: string,
  clear: boolean = false
): Promise<void> {
  const pth = path.resolve(pthIn);
  let exists = false;
  try {
    const stat = await fs.lstat(pth);
    if (!stat.isDirectory()) {
      await fs.rm(pth, { recursive: true });
    } else {
      exists = true;
    }
  } catch (e) {
    if (e.errno !== -4058) {
      throw e;
    }
  }

  if (!exists) {
    await fs.mkdir(pth, { recursive: true });
  }

  if (clear) {
    const contents = await fs.readdir(pth);
    await Promise.all(
      contents.map((name) => fs.rm(path.join(pth, name), { recursive: true }))
    );
  }
}

// create a bundle object to store ASTs, file paths and sizes
export async function makeBundle(
  dirIn: string,
  entryIn?: string
): Promise<Bundle> {
  const dir = path.resolve(dirIn);
  const stat = await fs.lstat(dirIn);

  if (!stat.isDirectory()) {
    throw new Error(`Could not read directory ${dir}.`);
  }

  const fileNames = await fs.readdir(dir);

  if (fileNames.length === 0) {
    throw new Error(`Directory '${dir}' is empty.`);
  }

  const files: Bundle["files"] = {};
  let size: number = 0;

  await Promise.all(
    fileNames.map((name) =>
      fs.readFile(path.join(dir, name)).then((content) => {
        const code = content.toString();
        files[name] = {
          code,
          ast: parse(code, {
            ecmaVersion: "latest",
          }),
        };
        size += content.byteLength;
      })
    )
  );

  const entry = entryIn ?? findEntry(files);

  if (!(entry in files)) {
    throw new Error(
      `Entry file '${entry}' does not exist in directory '${dir}'.`
    );
  }

  return {
    dir,
    files,
    size,
    entry,
  };
}

// unwraps the entry body from an IIFE if present
export function getEntryBody(
  fileName: string,
  ast: Program
): Program | BlockStatement {
  if (ast.body.length === 1) {
    const iife = ast.body[0];
    if (isIIFE(iife)) {
      const fn = iife.expression as CallExpression;
      return (fn.callee as FunctionExpression).body;
    } else {
      throw new Error(`Failed to parse entry file '${fileName}'.`);
    }
  } else {
    return ast;
  }
}

// walks a program looking for objects that look like webpack module maps (objects that map numerical keys to functions)
// internal module maps shouldn't break it as we only take distinct top-level maps
export function getWebpackModuleMaps(
  program: Program
): WebpackModuleMapExpression[] {
  const result = new Set<WebpackModuleMapExpression>();
  walk.simple(program, {
    ObjectExpression: (node) => {
      if (isWebpackModuleMap(node)) {
        for (const existing of result) {
          // check if we've already got this one covered
          if (astNodeContains(existing, node)) {
            return;
          }

          // check if this one covers any ones we've already got
          if (astNodeContains(node, existing)) {
            result.delete(existing);
          }
        }

        result.add(node);
      }
    },
  });

  return [...result];
}

function makeModuleFileName(moduleMap: ModuleFnMap, id: string): string {
  // TODO something more advanced
  return `${id}.js`;
}

// codemod the webpack module functions and write to disk
export async function writeModulesDirectory(
  moduleMap: ModuleFnMap,
  outDir: string
): Promise<void> {
  const moduleIds = Object.keys(moduleMap);
  const promises: Promise<void>[] = [];
  for (const moduleId of moduleIds) {
    const moduleFn = structuredClone(moduleMap[moduleId]);
    if (moduleFn.params.length >= 3) {
      const requireFnName = (moduleFn.params[2] as Identifier).name;
      // TODO rename arguments in usage of the import function to their new file names instead of raw numbers
    }

    const fileName = makeModuleFileName(moduleMap, moduleId);
    const outputCode = generate(iifefyWebpackModuleFn(moduleFn));
    promises.push(fs.writeFile(path.join(outDir, fileName), outputCode));
  }
}

export async function writeEntry(
  bundle: Bundle,
  outDir: string
): Promise<void> {
  await fs.writeFile(
    path.join(outDir, "index.js"),
    "// TODO entry codemodding"
  );
}
