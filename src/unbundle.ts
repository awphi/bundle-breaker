import path from "path";
import fs from "fs/promises";
import type { AnyFunctionExpression, Bundle, ModuleMap } from "./types";
import * as recast from "recast";

import r = recast.types.namedTypes;
import { isIIFE, isSingleExpressionProgram } from "./utils";
const n = recast.types.namedTypes;
const b = recast.types.builders;

// auto-detection of entry file given a set of chunks via process of eliminiation
function findEntry(files: Bundle["files"]): string {
  const maybeEntry = new Set(files.keys());
  for (const file of files.keys()) {
    const { ast } = files.get(file)!;

    try {
      findWebpackRequireFn(ast.program, file);
    } catch (e) {
      console.log(e);
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

// create a bundle object to store ASTs, file paths and sizes
export async function makeBundle(
  dir: string,
  entryIn?: string
): Promise<Bundle> {
  // TODO should use a glob
  const fileNames = await fs.readdir(dir);

  if (fileNames.length === 0) {
    throw new Error(`Directory '${dir}' is empty.`);
  }

  const files: Bundle["files"] = new Map();
  let size: number = 0;

  await Promise.all(
    fileNames.map(async (name) => {
      try {
        await fs.readFile(path.join(dir, name)).then((content) => {
          const code = content.toString();
          files.set(name, {
            code,
            ast: recast.parse(code),
          });
          size += content.byteLength;
        });
      } catch (e) {}
    })
  );

  // TODO always assert the entry contains a require fn - auto-detected or not
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
    modules: getModules(files, entry),
  };
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
  const { functionDec, moduleMapMemberExpr } = findWebpackRequireFn(
    ast,
    bundle.entry
  );

  // replace the `moduleMap[e]` in the require function with `require(moduleMap[e])`
  recast.visit(functionDec, {
    visitMemberExpression(path) {
      if (path.node === moduleMapMemberExpr) {
        path.replace(b.callExpression(b.identifier("require"), [path.node]));
        return false;
      }

      this.traverse(path);
    },
  });

  const { expr: moduleMapExpr } = findEntryModuleMap(ast);

  recast.visit(ast, {
    visitArrayExpression(path) {
      const node = path.node;
      if (node === moduleMapExpr) {
        path.replace(
          b.arrayExpression([...bundle.modules.values()].map((v) => v.fn))
        );
        return false;
      }

      this.traverse(path);
    },
    visitObjectExpression(path) {
      const node = path.node;
      if (node === moduleMapExpr) {
        path.replace(
          b.objectExpression(
            [...bundle.modules.keys()].map((k) => {
              return b.property(
                "init",
                b.literal(k),
                bundle.modules.get(k)!.fn
              );
            })
          )
        );
        return false;
      }

      this.traverse(path);
    },
  });

  await fs.writeFile(
    path.join(outDir, `index.${ext}`),
    recast.prettyPrint(ast.program, { tabWidth: 2 }).code
  );
}

function findWebpackRequireFn(
  ast: any,
  fileName: string
): {
  functionDec: r.FunctionDeclaration;
  moduleMapMemberExpr: r.MemberExpression;
} {
  let functionDec: r.FunctionDeclaration | undefined = undefined;
  let moduleMapMemberExpr: r.MemberExpression | undefined = undefined;

  recast.visit(ast, {
    visitCallExpression(path) {
      const node = path.node;
      // ExpressionStatement > BlockStatement > FunctionDeclaration
      const funcParent = path.parent?.parent?.parent?.node;
      // expect something like function(e) { something[e].call(arg1, arg2, arg3, arg4) }
      // and return a ref to that function and that something[e] member expression
      if (
        funcParent &&
        r.MemberExpression.check(node.callee) &&
        r.MemberExpression.check(node.callee.object) &&
        node.callee.object.computed === true &&
        r.Identifier.check(node.callee.object.property) &&
        r.Identifier.check(node.callee.property) &&
        node.callee.property.name === "call" &&
        node.arguments.length === 4 &&
        r.FunctionDeclaration.check(funcParent) &&
        funcParent.params.length === 1 &&
        r.Identifier.check(funcParent.params[0]) &&
        funcParent.params[0].name === node.callee.object.property.name
      ) {
        functionDec = funcParent;
        moduleMapMemberExpr = node.callee.object;
        return false;
      }
      this.traverse(path);
    },
  });

  if (functionDec === undefined || moduleMapMemberExpr === undefined) {
    throw new Error(`Unable to find webpack require function in '${fileName}'`);
  }

  return {
    functionDec,
    moduleMapMemberExpr,
  };
}

function findEntryModuleMap(ast: any): ModuleMap {
  const modules: Record<string, AnyFunctionExpression> = {};
  let expr: r.ObjectExpression | r.ArrayExpression;

  if (isSingleExpressionProgram(ast.program)) {
    const iife = ast.program.body[ast.body.length - 1];
    if (isIIFE(iife)) {
      // it's webpack 4 (or 5 with an iife)
      // TODO check if webpack 5 (by looking for a lack of args to the iife - otherwise we can re-use the logic below for webpack 5 without an iife)
    }
  } else {
    // it's webpack 5 (without an iife)
    // TODO extract modules out
  }

  return {
    modules,
    expr,
  };
}

function findAdditionalChunkModuleMap(ast: any): ModuleMap {
  const modules: Record<string, AnyFunctionExpression> = {};
  let expr: r.ObjectExpression | r.ArrayExpression;

  // look for a single expression program with a .push(arg) - could tighten this up but seems to get the job done for now
  if (isSingleExpressionProgram(ast)) {
    const call = ast.program.body[ast.program.body.length - 1];
    if (
      n.ExpressionStatement.check(call) &&
      n.CallExpression.check(call.expression) &&
      call.expression.arguments.length === 1 &&
      n.MemberExpression.check(call.expression.callee) &&
      n.Identifier.check(call.expression.callee.property) &&
      call.expression.callee.property.name === "push"
    ) {
      const param = call.expression.arguments[0];
      // TODO finish this up - check exact structure of the params of a webpack5 .push() call
    }
  }

  return { modules, expr };
}

function getModules(files: Bundle["files"], entry: string): Bundle["modules"] {
  const modules: Bundle["modules"] = new Map();
  for (const file of files.keys()) {
    const { ast } = files.get(file)!;
    const findModuleMapFn =
      file === entry ? findEntryModuleMap : findAdditionalChunkModuleMap;
    const newModules = Object.entries(findModuleMapFn(ast).modules);

    for (const [key, value] of newModules) {
      modules.set(key, {
        name: key.toString(),
        fn: value,
      });
    }
  }

  return modules;
}
