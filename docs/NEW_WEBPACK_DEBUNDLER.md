# New webpack debundler — implementation plan

## Goal

Replace the current webpack debundler (`src/webpack/*`, plus the `module_mapping.js`
indirection and runtime-chunk patching it relies on) with a much dumber, narrower
tool: **turn a webpack bundle into a plain, executable CJS bundle**, and stop there.
Once this produces `index.js` + `modules/<id>.js`, that output is just a normal
(if messy) CJS program — any further processing (deobfuscation, ESM conversion,
renaming, etc.) is somebody else's problem, in or out of bundle-breaker.

**"No webpack residue" precisely means no bundler *machinery* survives** — the
module registry/cache, the chunk loader, JSONP push arrays, script-tag injection,
the `__webpack_require__.s`/`.m`/`.c` bookkeeping. All of that is genuinely
webpack-specific and has no reason to exist in a plain CJS file, so all of it is
deleted.

It does **not** mean zero references to anything shaped like `__webpack_require__.X`.
A handful of those (`.n`, `.d`, `.r`, `.o`, `.t`) are pure ESM↔CJS interop helpers —
"how do I fake `__esModule`/default-export/named-export getters on a plain
object." That logic exists because *the original source used `import`/`export`
syntax*, not because webpack built it — Babel (`_interopRequireDefault`,
`_interopRequireWildcard`) and TypeScript's `tslib` (`__importDefault`,
`__importStar`) ship near-identical helpers for the same reason.

**Critically, none of this detection or replacement logic may key off comments,
specific property names, or "which webpack version is this."** Comments are not
load-bearing (any build step can strip them) and property names/exact helper
semantics are not something we get to assume are stable across webpack
versions/configs — hand-reimplementing `.n`/`.d`/`.r`/`.t` from what today's
fixtures happen to contain would silently produce wrong output the moment a
different version changes one of them. So instead of reimplementing these
helpers ourselves, we **relocate the actual code webpack generated for them,
verbatim** (Step 5) — we don't need to know their names, arity, or semantics,
just that *some* static properties are hung off the require-function identifier
we already located structurally in Step 1, and that they should move with it.
Where full inlining genuinely can't be done compatibly (dynamic/computed
require ids, and whatever those relocated helper properties need to keep
working), a small, generic, bundler-shaped indirection (an id→path lookup plus
a live require-like function) is kept on purpose — prioritizing "always
correct" over "zero webpack-shaped code," per your call.

This is a ground-up rewrite. Existing unit tests for the old webpack debundler and
the e2e example fixtures are expected to break/be replaced — not a concern for this
work.

## Output shape

```
out/
  index.js          # the true entry module, CJS
  modules/
    <id>.js          # every other module, CJS
```

- `index.js` is always the entry module, regardless of its original numeric/hashed
  webpack module id.
- Every other module is written to `modules/<id>.js` where `<id>` is its original
  webpack module id (numeric or string/hashed), sanitized for filesystem safety.
- No `module_mapping.js`, no webpack bootstrap/chunk-loader of any kind is
  emitted. The one exception is a small shared `modules/__webpack_runtime.js`
  (see Step 5) carrying whatever interop helper properties the original
  require-function had, relocated verbatim, plus the minimal id→path require
  shim they (and any dynamic requires) route through — kept deliberately, not
  reimplemented, per the "Goal" section above.
- `Bundle`/`FileNode` types are unchanged. The entry is identified purely by the
  `index.js` filename convention — no new field on `Bundle`.

## Pipeline (functional core, imperative shell)

Same overall shell as today (`index.ts`: `read` → `parse` → `split` → `save`,
all IO). Inside `split`, everything is pure functions over Babel ASTs; the only
"shell" bit is assembling the returned `Map` of files.

```
split(bundle: RawBundle): Bundle
  1. find the runtime chunk (the file containing __webpack_require__ + its module map)
  2. for every chunk (runtime + additional), pull out:
       - its local module map (id -> function)
       - possibly the entry module id, if this chunk exposes one
  3. merge all module maps into one id -> function table; assert no id collisions
  4. resolve exactly one entry id across the whole bundle
  5. for every (id, fn) pair, build a module FileNode:
       - id === entryId            -> path "index.js"
       - otherwise                 -> path "modules/<sanitized id>.js"
       - function body: positional param rename + require-call rewrite (below)
  6. return { adapter: "webpack", files: <all module FileNodes> }
```

Steps 1–2 reuse/refactor existing logic in `runtime-chunk.ts`, `additional-chunks.ts`
and `module-map.ts`. Steps 3–5 are new.

## Step-by-step detail

### 1. Runtime chunk + module map extraction (mostly existing code)

Keep `findRuntimeChunk` / `findWebpackRequireFn` roughly as-is — we still need to
locate the `__webpack_require__` function declaration to know what identifier
module bodies call, and to find the runtime's own module map (WP4: IIFE array arg;
WP5: `__webpack_modules__` object initializer). This is already implemented in
`runtime-chunk.ts` and works for both shapes.

What changes: we **no longer patch/mutate the runtime chunk** into an output file
(no `require(__webpack_modules__[id] || ...)` patching, no `module_mapping.js`).
We only use the runtime chunk to *read* its module map (if any — see WP4
split-chunks case below, where it's empty) and to look for an entry invocation.

### 2. Additional chunk module maps (existing code, extended)

`additional-chunks.ts` already extracts module maps from the
`(jsonpArray).push([chunkIds, modules, ...])` shape (WP4 and WP5 default/jsonp
`chunkFormat`). This needs one more shape added:

- **`chunkFormat: "commonjs"`** (see `examples/webpack5_109-splitchunks-cjs`):
  chunk file is just `exports.id = N; exports.ids = [...]; exports.modules = {...}`.
  No `.push(...)` call at all — just pull the module map straight off the
  `exports.modules` object.

- **`chunkFormat: "module"`** (ESM chunks, `examples/webpack5_109-splitchunks-mjs` —
  confirmed by inspection, not `webpack5_109-complex-dom`, which turns out not to set
  `chunkFormat` and defaults to jsonp): the additional chunk is real ESM,
  `export const <name> = <id>|[<ids>]|{<module map>}` — three `export const`
  declarations, the module map living in whichever one initializes to an
  object literal. Matched the same way as the other two shapes: by content
  (function-valued properties keyed by literal ids), not by the variable name
  webpack happens to use for it (`__webpack_esm_modules__` today).

This format has one further consequence: the *runtime/entry* chunk is itself
ESM here, and contains a chunk-registration pair —
```js
import * as __webpack_chunk_1__ from "./293.xxxx.js";
__webpack_require__.C(__webpack_chunk_1__);
```
— pulling in the additional chunk's exports and merging them into the module
registry. This is not a reusable helper property (nothing in a module body
calls `.C`), it's a one-time call site, and it's moot once chunk 293 has been
dissolved into individual module files reachable through the merged id→path
table. It gets **dropped** entirely when building `index.js` — the same
treatment Step 7 gives `<requireFn>.e(...)`, and the same bucket as the
module-map declaration itself (recognized boilerplate to strip, not something
relocated into the runtime shim). Everything downstream of it (`.O(...)`
entry-gating) is unchanged, confirming Shape C detection already generalizes
across all three chunk formats without format-specific branching.

### 3. Entry id resolution — the tricky part

This is the one place where "the structure we need to exploit" is genuinely not
uniform across configs — there are (at least) four distinct *structural*
shapes in the example fixtures. These are real differences in program shape
(sync call vs. deferred callback vs. a side-table), not naming differences, so
some enumeration is unavoidable — but each is matched **by structure alone**
against any chunk, tried in the order below, regardless of which webpack
version or config is presumed to have produced it. Nothing here checks "is
this webpack 4 or 5" as a precondition; a match is a match wherever it's found.
(The "seen in" column below is just where each shape happens to occur in the
fixtures, for orientation — not a detection precondition.)

| Shape | Seen in | Entry id is... |
|---|---|---|
| A. Sync require of the start module | `examples/webpack4_47-simple` | A direct call to the identified require-function with a literal id argument, at the top level of the runtime chunk, not nested inside the require function's own definition (e.g. `__webpack_require__(__webpack_require__.s = N)`) |
| B. No wrapper at all | `examples/webpack5_109-simple-iife` | No such call exists anywhere — there is no numbered entry module; webpack inlined the entry's statements directly as trailing top-level code in the runtime chunk, after the modules object |
| C. Deferred/priority chunk-gated require | `examples/webpack5_109-splitchunks*` | A call to *some* member function hung off the identified require-function (whatever it's named — matched structurally, not as a specific `.O`), one of whose arguments is a zero-arg function/arrow whose body is (or returns) a direct call to the require-function with a literal id |
| D. Deferred-modules side table | `examples/webpack4_47-splitchunks` | Runtime chunk's own module map is empty; the entry module *and* its id live in an **additional** chunk, whose "add these modules" call has a trailing array-of-arrays argument — the first element of its first entry is the entry id |

Proposed resolution algorithm — try each in order, first match wins:

1. Scan the runtime chunk's `__webpack_require__` invocations for shape A.
2. Scan the runtime chunk for shape C.
3. Scan **every additional chunk** for shape D.
4. If none of the above match anywhere, fall back to shape B: there is no entry
   module id. The "entry" instead becomes whatever top-level statements in the
   runtime chunk are *not* part of the module-map declaration/require-function
   boilerplate (i.e., `maybeUnwrapTopLevelIife(...)` body minus the recognized
   boilerplate nodes). These statements are written directly into `index.js`
   as-is (after the same require-call rewriting as any other module, but with
   no `module`/`exports` param renaming since there's no wrapping function).

Exactly one entry must be found across the whole bundle; finding more than one
match (e.g. shape A and shape C both matching) or none at all (and shape B not
applicable) is an error.

### 4. Module file generation

For each `(id, fn)`:

- `fn.params` are positional, not name-based (minifiers/webpack rename them
  freely — e.g. `__unused_webpack_exports`, `__unused_webpack_module`). Rename by
  **position**, ignoring original names:
  - param 0 → `module`
  - param 1 → `exports`
  - param 2 → `require`
  (Only rename params that exist — some modules omit trailing unused params
  entirely, e.g. `function(module) {...}`.)
- Renaming param 1 to `exports` (rather than dropping it) is deliberate and free:
  our output files are themselves loaded as real CJS modules by Node, which
  already provides a real, correctly-initialized `exports` binding
  (`exports === module.exports`) via its own module wrapper. So leaving
  references to it renamed-to-`exports` "just works" with zero extra
  declarations, matching webpack's own semantics for that parameter.
- Body may be a `BlockStatement` (function expression / non-arrow) or a bare
  `Expression` (concise arrow body) — normalize both into the file's `Program`
  body (wrap a bare expression in an `ExpressionStatement`).
- Rewrite every `<requireFn>(<id>)` call (where `<id>` is a string/numeric
  literal) to `require("<relative path to that id's module file>")`:
  - from `modules/x.js`, another module → `require("./y.js")` or, if `y` is the
    entry, `require("../index.js")`
  - from `index.js`, a dependency → `require("./modules/y.js")`
- `<requireFn>(<computed, non-literal expression>)` (a genuinely dynamic
  require) can't be resolved to a literal path at rewrite time — route it
  through the require-shim from Step 5 instead (`__wp(x)` in place of
  `<requireFn>(x)`), rather than erroring or leaving a dangling reference to a
  deleted identifier. This isn't just defensive: it's the normal compiled
  shape of `require.context(...)` (e.g. dynamic locale/asset loading), which
  produces a synthetic module like
  `function webpackContextResolve(req) { var map = {"./en": 123, "./fr": 456}; return map[req]; }`
  followed by `__webpack_require__(webpackContextResolve(req))` — note `map`
  itself is already a plain literal object webpack emitted (no rewriting
  needed there), the *only* non-literal part is that one require call, and the
  ids it can ever produce are already real entries in the shim's id→path
  table. No separate module-map structure needs inventing for this — it reuses
  the exact table Step 5 already builds.

### 5. Runtime helper properties — relocated verbatim, not reimplemented

Module bodies don't only call `<requireFn>(id)`. They routinely call whatever
static properties webpack hung off the require function directly, e.g.
`__webpack_require__.n(is_even__WEBPACK_IMPORTED_MODULE_0__)` (default-export
interop) appears **inside an actual entry module body** in
`examples/webpack5_109-splitchunks-cjs/out/index.dab82a43.js:9`, not just inside
the runtime. Since the runtime chunk is deleted entirely, a left-over
`__webpack_require__.X(...)` reference would crash — rewriting the require
*call* alone (Step 4) isn't sufficient by itself.

We deliberately do **not** hand-reimplement these (no hardcoded `.n`/`.d`/`.r`/`.o`
list, no assumptions about arity or exact semantics) — that would silently
break the moment a different webpack version or custom runtime template
changes one of them. Instead:

1. **Find, don't assume.** Once Step 1 has located the require-function
   identifier, structurally collect every assignment of the shape
   `<requireFn>.<anyProperty> = <value>` inside the runtime chunk — whatever
   properties exist, however many, whatever they're named or how they're
   implemented. No property-name list is hardcoded anywhere.
2. **Relocate, don't rewrite.** Move those assignment statements, bodies
   untouched, into one small shared file (e.g. `modules/__webpack_runtime.js`),
   consistently renaming only the base identifier they're hung off (not the
   property names). We are shipping webpack's own generated code for these,
   verbatim — correct by construction for whatever version produced it,
   because it's *literally that version's own implementation*, not our guess
   at it.
3. **Keep the require-function identity real, backed by a lookup table.** Some
   relocated properties (e.g. `.t`'s `value = this(value)` branch) call back
   into "the require function" itself. So the shared file also exports a real,
   callable require-shim: a small id→relative-module-path table (built from
   every module file we're emitting) plus a function that looks up an id and
   `require()`s the corresponding file. This is the one place genuinely
   bundler-shaped indirection survives on purpose — it's what both the
   relocated helper properties and Step 4's dynamic/computed require calls
   route through.
4. Every module file that references any of these properties gets
   `const __wp = require("./__webpack_runtime.js")` (or `"../..."` from
   `index.js`) injected, and `<requireFn>.X(...)` rewrites to `__wp.X(...)`
   (member access preserved as-is, since we don't need to know what it does —
   just that it's still there under the same name).

This also resolves `.t` (fake namespace object, used for `import * as ns from
"..."` and for dynamic `import()` unwrapping — see Step 7) without any special
case: it's just another relocated property, and its callback into the require
function is satisfied by the shim's real, callable require-function identity
from point 3 above.

### 6. Filename sanitization

Module ids can be plain numbers (`293`), or short hashed strings (`"9wtr"`,
`"fO6f"`) when `optimization.moduleIds: "hashed"`/deterministic is set. Sanitize
before using as a filename (reject/escape path separators, `..`, etc.) — mostly
theoretical given webpack's own id formats, but cheap to guard.

### 7. Dynamic `import()` call sites, generalized

The entry-resolution shapes C and D (Step 3) already require recognizing and
rewriting one specific instance of webpack's async-chunk-loading pattern — the
one gating the entry's own startup. There's nothing entry-specific about that
rewrite, though, and no reason to special-case it: **any** `import(...)` in the
original source compiles to the same handful of shapes wherever it appears in
the bundle, and they reduce to plain synchronous code the same way, because
once debundling has happened every chunk already exists as a file on disk —
there's no network fetch left for "lazy" to mean anything relative to.

Given the Step 5 shim, this rewrite doesn't even need per-call-site path
resolution: the shim's id→path table already covers every module in the whole
bundle, so `<requireFn>.e(...)` ("ensure this chunk's code is loaded") has
nothing left to do — the code is already sitting on disk, requirable, whatever
chunk it originally shipped in. It becomes an unconditional `Promise.resolve()`,
and any subsequent `.t(...)`/`.O(...)` call in the chain is handled exactly
like Step 5 already handles them elsewhere: swap the base identifier to the
shim, leave arguments as-is.

```js
// original
__webpack_require__.e(293).then(__webpack_require__.t.bind(__webpack_require__, 293, 23))
  .then(({ default: isEven }) => { ... });

// rewritten
Promise.resolve().then(__wp.t.bind(__wp, 293, 23))
  .then(({ default: isEven }) => { ... });
```

This preserves both timing (still only runs when that line is reached, same as
the original `import()`) and the async `.then()`-based API shape callers
already depend on, and it's not a special case at all — `.e` just becomes
"trivially resolved," and everything after it is ordinary Step-5 identifier
substitution. Multiple chunk ids passed to `.e`, or several `.e()` calls joined
via `Promise.all([...])`, need no special handling either, for the same reason.

This supersedes the old "lazy loading is a non-goal" framing — it isn't a
different problem from the entry rewrite, just the same rewrite applied more
broadly. What's still explicitly out of scope, narrower than before: webpack
"magic comment" hints (`webpackChunkName`, `webpackPrefetch`, `webpackPreload`)
are just dropped, since they have no meaning once everything is eagerly
required from disk — there's no prefetch/preload semantics left to preserve.

## Non-goals (explicitly out of scope for this pass)

- Library/UMD output targets (`output.library`/`libraryTarget`).
- Non-webpack bundlers (Parcel/Rollup) — separate TODO items already tracked.
- Preserving webpack's module cache/singleton semantics beyond what Node's own
  `require` cache gives us for free (it's the same shape: id → single
  execution, memoized exports).

## File layout changes in `src/webpack/`

- `module-map.ts` — keep, extend to parse the `exports.modules = {...}` shape.
- `runtime-chunk.ts` — trim to pure "find the runtime chunk + its module map +
  maybe an entry id"; delete all the patch/mutate-into-an-output-file logic
  (`patchRuntimeChunk`, the `require(x || y)` fallback rewriting,
  `module_mapping.js` generation).
- `additional-chunks.ts` — trim similarly; extend for the commonjs chunk shape;
  add shape-D deferred-modules-table detection for entry id.
- `entry.ts` (new) — the shape A/B/C/D entry-id resolution described above, as
  pure functions over a chunk's AST.
- `module.ts` — replace `createFileForModule`/`createModuleFilesFromMaps` with
  the new param-rename + require-rewrite + helper-rewrite logic; delete
  `createModuleMappingChunk`; implement `updateRequireCalls` for real (currently
  a TODO stub).
- `runtime-shim.ts` (new) — builds the `__webpack_runtime.js` `FileNode`: the
  relocated `<requireFn>.X = ...` assignments (verbatim, whatever `X` turns out
  to be) plus the callable id→path require-shim they close over. Does not
  hardcode which properties exist.
- `index.ts` — new `split()` orchestration matching the pipeline above; a real
  `detect()` heuristic (current one is a `return 1` stub) that reuses Step 1's
  own structural success/failure — i.e. "can we find a require-function
  declaration whose body indexes a module map by its first parameter and
  invokes it with the expected 3-arg module signature" — never a comment or a
  specific identifier name.
- `types.ts` — `WebpackModuleMap` stays; drop `PatchedRuntimeChunk` /
  `StrippedAdditionalChunk` in favour of simpler return shapes for the new
  functions (module map + optional entry id).

## Open questions — resolved

1. ~~Shape B fallback~~ — confirmed: dump the trailing runtime statements
   straight into `index.js` when no entry id is found anywhere.
2. ~~`chunkFormat: "module"`~~ — confirmed by inspection above: `export const`
   shape for the module map, plus an `import ... ; <requireFn>.C(...)`
   registration pair in the runtime chunk that gets dropped as boilerplate.
3. Anything left in "Non-goals" you actually want pulled into scope now?
