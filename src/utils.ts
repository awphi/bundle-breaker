import path from "path";
import fs from "fs/promises";
import type {
  AnyFunctionExpression,
  Bundle,
  WebpackModuleMapExpression,
} from "./types.js";
import * as recast from "recast";

import r = recast.types.namedTypes;
const n = recast.types.namedTypes;
const b = recast.types.builders;

const requireProgramCode = `var __webpack_module_cache__ = {};
  
function __webpack_require__(e) {
  var t = __webpack_module_cache__[e];
  if (void 0 !== t) return t.exports;
  var r = (__webpack_module_cache__[e] = {
    id: e,
    loaded: !1,
    exports: {},
  });
  return (
    require(__webpack_modules__[e]).call(
      r.exports,
      r,
      r.exports,
      __webpack_require__
    ),
    (r.loaded = !0),
    r.exports
  );
}

module.exports = __webpack_require__;`;

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
function getWebpackModuleMaps(program: any): WebpackModuleMapExpression[] {
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
  const maybeEntry = new Set(files.keys());
  for (const file of files.keys()) {
    const { ast } = files.get(file)!;

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

  const files: Bundle["files"] = new Map();
  let size: number = 0;

  await Promise.all(
    fileNames.map((name) =>
      fs.readFile(path.join(dir, name)).then((content) => {
        const code = content.toString();
        files.set(name, {
          code,
          ast: recast.parse(code),
        });
        size += content.byteLength;
      })
    )
  );

  const entry = entryIn ?? findEntry(files);

  if (!files.has(entry)) {
    throw new Error(
      `Entry file '${entry}' does not exist in directory '${dir}'.`
    );
  }

  return {
    dir,
    files,
    size,
    entry,
    modules: getModules(files),
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
  bundle: Bundle,
  outDir: string,
  ext: string
): Promise<void> {
  const promises: Promise<void>[] = [];

  const moduleExportsExpr = b.memberExpression(
    b.identifier("module"),
    b.identifier("exports")
  );

  for (const moduleId of bundle.modules.keys()) {
    const { fn, name } = bundle.modules.get(moduleId)!;

    const moduleProgram = b.program([
      b.expressionStatement(b.assignmentExpression("=", moduleExportsExpr, fn)),
    ]);

    const outputCode = recast.prettyPrint(moduleProgram, {
      tabWidth: 2,
    }).code;
    promises.push(
      fs.writeFile(path.join(outDir, `${name}.${ext}`), outputCode)
    );
  }
}

export async function writeEntry(
  bundle: Bundle,
  outDir: string,
  ext: string
): Promise<void> {
  const { ast } = bundle.files.get(bundle.entry)!;
  // TODO in the entry AST - find the main __webpack_require__ function (it should be the only thing that indexes into the module map)

  // we should have asserted there is only one module map in the entry file earlier
  const [moduleMap] = getWebpackModuleMaps(ast) as r.ObjectExpression[];

  moduleMap.properties = [...bundle.modules.keys()].map((key) =>
    b.property(
      "init",
      b.literal(key),
      b.literal(`./modules/${bundle.modules.get(key)!.name}.${ext}`)
    )
  );

  let foundWebpackRequireFn = false;

  recast.visit(ast, {
    visitMemberExpression(path) {
      const node = path.node;
      if (n.Identifier.check(node.object) && node.computed) {
        const scope = path.scope.lookup(node.object.name);
        if (scope) {
          const bindings = scope.getBindings()[node.object.name];
          if (
            bindings.length === 1 &&
            bindings[0].parentPath.node.init === moduleMap
          ) {
            if (foundWebpackRequireFn) {
              throw new Error(
                "Found multiple potential __webpack_require__ functions."
              );
            }
            path.replace(b.callExpression(b.identifier("require"), [node]));
            foundWebpackRequireFn = true;
            return false;
          }
        }
      }
      this.traverse(path);
    },
  });

  if (!foundWebpackRequireFn) {
    throw new Error("Failed to locate __webpack_require__ function.");
  }

  await fs.writeFile(
    path.join(outDir, `index.${ext}`),
    recast.prettyPrint(ast.program, { tabWidth: 2 }).code
  );
}

function getModules(files: Bundle["files"]): Bundle["modules"] {
  const modules: Bundle["modules"] = new Map();
  for (const file of files.keys()) {
    const { ast } = files.get(file)!;
    const maps = getWebpackModuleMaps(ast);
    if (maps.length === 0) {
      console.warn(
        `Failed to detect any webpack module maps in file '${file}'. Skipping...`
      );
      continue;
    } else if (maps.length > 1) {
      throw new Error(
        `Detected more than one webpack module map in file '${file}'. This is likely a bug.`
      );
    }

    for (const prop of maps[0].properties) {
      const key = prop.key.value;
      if (key in modules) {
        console.warn(
          `Encountered collision on module ID '${key}'. Skipping...`
        );
        continue;
      }
      modules.set(key, {
        fn: prop.value,
        // TODO something more advanced for naming modules
        name: key.toString(),
      });
    }
  }

  return modules;
}
