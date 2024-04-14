# bundle-breaker

TODO npm banner

`bundle-breaker` is a CLI and JS API to make reverse-engineering bundled JavaScript applications easy and accessible. This can comprise of the separation, grouping, naming, pruning, deobfuscation and rebundling of production-built JavaScript applications.

The tool aims to be robust and tolerant to various bundler configurations. If you find a config that doesn't work as you'd expect and the relevant option(s) are not listed in our known limitations please raise an issue.

# Features

## Debundle

The first step to reverse-engineering a production JS application is to undo the bundling process performed by tools like webpack and rollup. `bundle-breaker` calls this process "debundling" and is performed like so:

CLI:

```sh
npx bundle-breaker debundle path/to/bundle ./out
```

JS API:

```javascript
import { debundle } from "bundle-breaker";

const files = { "index.js": "...", "chunk.js": "..." };
const deb = debundle(files);
deb.debug();
// ...
```

Running the command above will create a debundled copy of your original application in the `./out/` directory. This consists of a modified copy of all your original bundle chunks and the individual modules that were contained in the chunks (now separated out into their own files). `bundle-breaker` also supports a variety of advanced options to enrich this data with better naming, module graph visualizations, grouping of modules, pruning and deobfuscation. Examples of these are given in more detail below.

## Visualize

TODO

## Name

TODO

## Group

TODO

## Prune

TODO

## Deobfuscate

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
