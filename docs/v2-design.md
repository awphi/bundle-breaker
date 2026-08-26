# v2 design notes

High-level design for the `bundle-breaker` rewrite (`TODO.md`: internals
refactor, API update, testing strategy). v1's pain: a mutable `Debundle`
class with subclassing per bundler (`WebpackDebundle`), protected
template-method hooks, and duplicate AST walks for `graph()` vs
`updateNames()`. v2 fixes this with plain functions over immutable data —
no classes, no inheritance, no runtime registries.

## Goals

- Stateless, functional — no `this`, no objects with methods.
- Every function returns a complete, fully-qualified value. No optional
  "filled in later" fields (that's `hasGraph()`-style state in a new shape).
- Adding a bundler or an operation shouldn't require touching existing code.
- Unit-testable without a full built bundle fixture.
- Not a goal: third-party plugin adapters — bundler support is closed/static.

## Core data model

```ts
interface FileNode {
  readonly id: string;              // stable, content-hash based
  readonly kind: "chunk" | "module";
  readonly path: string;            // output path — what renames change
  readonly ast: t.File;
}

interface RawBundle { readonly files: ReadonlyMap<string, FileNode> }   // parsed, not split

interface Bundle {                                                      // always fully split
  readonly adapter: string;
  readonly entry: string;
  readonly files: ReadonlyMap<string, FileNode>;
}

interface GraphEdge { readonly from: string; readonly to: string }             // plain — nothing else, ever

interface Graph { readonly nodes: ReadonlySet<string>; readonly edges: readonly GraphEdge[] }
```

Each pipeline stage (`RawBundle` → `Bundle` → `Graph`) is its own type, held
as its own variable — never merged into one growing object with optional
fields. `Graph` is read-only output for humans and graph algorithms
(clustering, `.gexf` export) — it is never fed back into a mutation like
`rename`. An earlier version had `GraphEdge` carry a `patch` closure so
`rename` could reuse a previously-built graph; rejected as a footgun (the
closure can go stale if the AST it closes over is ever swapped rather than
mutated in place, and a function-in-data value can't be inspected, diffed,
or snapshotted). It also bought nothing — finding a reference and rewriting
it is one AST walk either way, so there's no performance reason to split
them into separate steps. See "Adapters" below.

## API: plain functions

```ts
let bundle = split(parseBundle(files, { extension: "js" }));
const graph = buildGraph(bundle);

bundle = deobfuscate(bundle, { flipLiterals: false });
bundle = rename(bundle, { "modules/abc.js": "auth/login.js" }); // no graph needed — one self-contained walk

await emit(bundle, outDir);
```

- No `pipe()` — plain reassignment handles conditionals and `await` for
  free; a generic combinator doesn't.
- No currying — every transform is `(input, opts?) => output`, called
  directly.
- No classes/methods — decided, to avoid drifting back into v1's
  subclassing trap.

## Adapters: selected by import, not by parameter

Each bundler is its own module exporting exactly the bundler-specific
surface — `name`, `detect`, `split`, `buildGraph`, `rename`:

```ts
// bundle-breaker/webpack
export const name = "webpack";
export function detect(bundle: RawBundle): number { ... }
export function split(bundle: RawBundle): Bundle { ... }
export function buildGraph(bundle: Bundle): Graph { ... }                                  // read-only walk
export function rename(bundle: Bundle, renames: ReadonlyMap<string, string>): Bundle { ... } // walk + mutate, one pass
```

`buildGraph` and `rename` are independent walks with no relationship at
runtime — one read-only (produces plain `{from,to}` data), one read-and-
write-together (finds a reference and rewrites it in the same pass, so
nothing has to be held onto between "find" and "patch"). They may share a
small private "find require calls" iterator inside the adapter's own files,
but that's an implementation detail, not something exposed publicly.

`cluster(graph)` (future) computes a `Map<nodeId, clusterId>` from the plain
`Graph`; `applyClusters` turns that into a rename map (cluster id becomes a
directory prefix) and calls the same `rename` — no new adapter primitive
needed, clustering is just a different source for a rename map. Pruning
(future) is not the same shape: it removes files and has to neutralize
dangling references rather than redirect them, so it'll need its own
adapter primitive when it's actually designed — not speced here yet.

Everything else (`deobfuscate`, `cluster`, `reachableFrom`, `emit`,
`parseBundle`) is bundler-agnostic and lives only at the root, never
duplicated per adapter.

The root package statically imports every adapter module and routes `split`
to the best `detect()` score, and `buildGraph`/`rename` by the `Bundle`'s
recorded `adapter` field — no runtime registry, no adapter parameter on
public functions:

```ts
import { split, buildGraph, rename, emit } from "bundle-breaker";          // 95% case: auto-detected
import { split, buildGraph, rename } from "bundle-breaker/webpack";         // power users: skip detection
```

Needs a `package.json` `exports` map (`"."`, `"./webpack"`) and a matching
second entry in `tsdown.config.ts`.

## Data flow

```
files ─ parseBundle ─▶ RawBundle ─ split ─▶ Bundle ─┬─ deobfuscate ─▶ Bundle ─┬─ rename ─▶ Bundle ─ emit ─▶ disk
                                                     │                        │
                                                     └─ buildGraph ─▶ Graph ──┘
                                                          (read-only; feeds cluster / reachableFrom,
                                                           whose results become rename inputs — never
                                                           passed into rename itself)
```

`Bundle.files` updates via structural sharing (`new Map` + changed entries
only) — cheap, no deep clones. ASTs stay mutable trees inside a `FileNode`;
the rule is a transform never mutates the `Map` it was handed.

## Layout

```
src/
  core/types.ts     // Bundle, FileNode, Graph, GraphEdge, BundlerAdapter (type only)
  parse.ts
  webpack/index.ts   // -> bundle-breaker/webpack
  transforms/         // deobfuscate, rename, cluster, reachable, apply-*
  emit.ts
  index.ts            // root: static adapter list + routing, re-exports generics
```
