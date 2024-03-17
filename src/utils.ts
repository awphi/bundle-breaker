import path from "path";
import fs from "fs/promises";
import type {
  AnyFunctionExpression,
  Bundle,
  ModuleFnMap,
  WebpackModuleMapExpression,
} from "./types.js";
import * as recast from "recast";

import r = recast.types.namedTypes;
const n = recast.types.namedTypes;
const b = recast.types.builders;

export function isAnyFunctionExpression(
  node: r.ASTNode
): node is AnyFunctionExpression {
  return (
    n.FunctionExpression.check(node) || n.ArrowFunctionExpression.check(node)
  );
}

export function isIIFE(node: r.ASTNode): node is r.ExpressionStatement {
  if (n.ExpressionStatement.check(node)) {
    if (n.UnaryExpression.check(node.expression)) {
      return isIIFE(node.expression.argument);
    } else if (n.CallExpression.check(node.expression)) {
      return isIIFE(node.expression);
    } else {
      return false;
    }
  }

  return (
    n.CallExpression.check(node) &&
    isAnyFunctionExpression(node.callee) &&
    node.callee.id == null
  );
}

export function isSingleExpressionProgram(body: r.Statement[]): boolean {
  if (body.length === 1) {
    return true;
  }

  if (body.length === 2) {
    const first = body[0];
    if ("directive" in first) {
      return (
        typeof first.directive === "string" && first.directive === "use strict"
      );
    }
  }

  return false;
}

export function isWebpackModuleMap(
  node: r.ObjectExpression
): node is WebpackModuleMapExpression {
  return (
    node.properties.length > 0 &&
    node.properties.every((prop) => {
      return (
        n.Property.check(prop) &&
        n.Literal.check(prop.key) &&
        typeof prop.key.value === "number" &&
        isAnyFunctionExpression(prop.value) &&
        prop.value.params.length <= 3
      );
    })
  );
}

// walks a program looking for objects that look like webpack module maps (objects that map numerical keys to functions)
// internal module maps shouldn't break it as we only take distinct top-level maps
export function getWebpackModuleMaps(
  program: any
): WebpackModuleMapExpression[] {
  const result: WebpackModuleMapExpression[] = [];
  recast.visit(program, {
    visitObjectExpression(path) {
      const node = path.node;
      if (isWebpackModuleMap(node)) {
        result.push(node);
        return false;
      }

      this.traverse(path);
    },
  });

  return [...result];
}

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
      const body = getEntryBody(file, ast.program);
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
          ast: recast.parse(code),
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
export function getEntryBody(fileName: string, ast: r.Program): r.Statement[] {
  if (ast.body.length === 1) {
    const iife = ast.body[0];
    if (isIIFE(iife)) {
      const fn = iife.expression as r.CallExpression;
      const { body } = fn.callee as AnyFunctionExpression;
      return n.BlockStatement.check(body) ? body.body : [body];
    } else {
      throw new Error(`Failed to parse entry file '${fileName}'.`);
    }
  } else {
    return ast.body;
  }
}

// codemod the webpack module functions and write to disk
export async function writeModulesDirectory(
  moduleMap: ModuleFnMap,
  outDir: string
): Promise<void> {
  const moduleIds = Object.keys(moduleMap);
  const promises: Promise<void>[] = [];

  for (const moduleId of moduleIds) {
    const { fn, name } = moduleMap[moduleId];
    const moduleFn = structuredClone(fn);
    // TODO codemods:
    // 1. Wrap in IIFE as we did before and invoke with the same parameters webpack usually would
    // 2. Rewrite parameters of the require function in the if block below to use the name given in the moduleMap

    if (moduleFn.params.length >= 3) {
      const requireFnName = (moduleFn.params[2] as r.Identifier).name;
    }

    const outputCode = recast.prettyPrint(moduleFn, {
      reuseWhitespace: false,
    }).code;
    promises.push(fs.writeFile(path.join(outDir, `${name}.js`), outputCode));
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
