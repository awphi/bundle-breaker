# bundle-breaker

TODO npm banner

`bundle-breaker` is a CLI and JS API to make reverse-engineering bundled JavaScript applications easy and accessible. This can comprise of the separation, grouping, naming, pruning, deobfuscation and rebundling of production-built JavaScript applications.

The tool aims to work with to the majority bundler configurations and versions. Notably this includes:

- Webpack 4 and 5
- All `webpack.ids` plugins
- Bundles split across multiple bundles
- Runtime-only chunks
- ... and everything between!

If you find a config that doesn't work as you'd expect and the relevant option(s)/version(s) are not listed in the known limitations please raise an issue.

# Features

## Debundle

The core function of `bundle-breaker` is to debundle, or break up, a bundled JS application into individual files each containing a singular module. This is called debundling and serves as the entry point for all interfaces with `bundle-breaker`.

JS API:

```javascript
import { debundle } from "bundle-breaker";

const files = { "index.js": "...", "chunk.js": "..." };
const deb = debundle(files);
// use debundle API as needed, for example:
deb.debug();
```

CLI:

```sh
npx bundle-breaker -c path/to/bundle ./out
```

When used via the CLI, `bundle-breaker` will write your debundled application to specified directory. It will have the following structure:

```
out/
├─ modules/
│  ├─ bb_module_1.js
│  ├─ bb_module_2.js
│  ├─ bb_module_3.js
├─ index.js
├─ chunk_1.js
├─ chunk_2.js
├─ ...extra metadata. depending on options (e.g. graph.gexf)..
```

## Graph

`bundle-breaker` can traverse the separates modules produced in the debundling step to look for imports/exports and build a module graph. This can be enabled like so:

```javascript
import { debundle } from "bundle-breaker";

const files = { "index.js": "...", "chunk.js": "..." };
const deb = debundle(files);
const graph = deb.graph();
console.log(graph.order, graph.size);
```

When using the JavaScript API `deb.graph()` will return a [graphology](https://graphology.github.io/) `Graph` object to interact with. You can use this as you would normally e.g. performing layouts, computing SNA metrics etc.

CLI:

```sh
npx bundle-breaker -cg path/to/bundle ./out
```

When using the CLI you can simply append the `-g` or `--graph` option to include a [`.gexf`](https://gexf.net/) graph file in your output directory. This can be loaded into a variety of graph-analysis or visualization libraries usually with minimal transformation. However, one way to quickly visualize your module graph without writing any code is to load it into [Gephi Lite](https://gephi.org/gephi-lite/).

## Name

TODO

## Deobfuscate

TODO

## Group

TODO

## Prune

TODO

# Development Quickstart

1. Clone the repo
2. `pnpm install` (with the `pnpm` version specified in `package.json`)
3. Build all the examples with:

   ```sh
   pnpm examples:build-all
   ```

   _Alternatively_, to re-build individual examples (e.g. `webpack4/simple`):

   ```sh
   pnpm examples:build webpack4/simple
   ```

4. Start the local dev build with:

   ```sh
   pnpm dev
   ```

5. Test everything is working with a simple debundle by running:

   ```sh
   npx . examples/webpack4/simple/out out
   ```
