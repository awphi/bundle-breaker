# bundle-breaker

`bundle-breaker` is a CLI and JS API to make reverse-engineering bundled JavaScript applications easy and accessible. This can comprise of the separation, grouping, naming, pruning, deobfuscation and rebundling of production-built JavaScript applications.

# Features

- **CLI & JS API** - Exposes a robust JS API as well as a simple, user-friendly CLI for creating and modifying reverse-engineering projects
- **Well-tested** - Every change is tested against a suite of up-to-date generated bundle configs
- **Multi-functional** - Supports a wide range of operations beyond debundling to make your reverse-engineered bundle dramatically easier to understand (see below for details)

## Debundle

The core function of `bundle-breaker` is to debundle, or break up, a bundled JS application into individual files each containing a singular module. This is called debundling and serves as the entry point for all interfaces with `bundle-breaker`.

**CLI:**

```sh
npx bundle-breaker -c path/to/bundle ./out
```

When used via the CLI, `bundle-breaker` will write your debundled application to specified directory. It will have the following structure:

```
out/
├─ modules/
│  ├─ module_1.js
│  ├─ module_2.js
│  ├─ module_3.js
├─ index.js
├─ chunk_1.js
├─ chunk_2.js
├─ ...extra metadata depending on options/input bundle (e.g. graph.gexf, module_mapping.js etc.)...
```

**JS API:**

```javascript
import { debundle } from "bundle-breaker";

const files = { "index.js": "...", "chunk.js": "..." };
const deb = debundle(files);
// use debundle API as needed, for example; logging its unique identifier
console.log(deb.getId());
```

## Deobfuscate

`bundle-breaker` supports a handful of deobfuscation codemods you can apply to reverse common minification strategies and make your debundled code more readable. All of these codemods are safe and should never change the functionality of the code. Examples of the supported processors are; unminifying boolean literals, to flipping literals and identifiers in `if` statements, breaking sequence expressions into individual statements, and many more. [See the full list of support techniques here](https://github.com/awphi/bundle-breaker/blob/main/src/types.ts#L25).

**JS API:**

```javascript
import { debundle } from "bundle-breaker";

const files = { "index.js": "...", "chunk.js": "..." };
const deb = debundle(files);

// opt-out of a given deobfuscator
const deobOpts = { flipLiterals: false };
deb.deobfuscate(deobOpts);
```

**CLI:**

```sh
npx bundle-breaker -cd path/to/bundle ./out
```

Note that the CLI only offers deobfuscation as an all or nothing deal. If you need more fine-grained control over which deobfuscation techniques will be applied you amy opt for the JS API.

## Graph

`bundle-breaker` can traverse the modules produced in the debundling step to build a module graph.

**CLI:**

```sh
npx bundle-breaker -cg path/to/bundle ./out
```

When using the CLI you can simply append the `-g` or `--graph` option to include a [`.gexf`](https://gexf.net/) graph file in your output directory. This can be loaded into a variety of graph-analysis or visualization libraries usually with minimal transformation. However, one way to quickly visualize your module graph without writing any code is to load it into [Gephi Lite](https://gephi.org/gephi-lite/).

**JS API:**

```javascript
import { debundle } from "bundle-breaker";

const files = { "index.js": "...", "chunk.js": "..." };
const deb = debundle(files);
const graph = deb.graph();
console.log(graph.order, graph.size);
```

When using the JavaScript API `deb.graph()` will return a [graphology](https://graphology.github.io/) `Graph` object to interact with. You can use this as you would normally e.g. performing layouts, computing SNA metrics etc.

## Name

`bundle-breaker` supports renaming/remapping your file names to something more legible. If you have a set of known file name mappings to hand you can manually pass them to the application. This will also update any `import`/`require` statements your chosen bundler may use; making your debundled codebase easier to traverse manually.

**CLI:**

```sh
npx bundle-breaker -c -f path/to/file-name-map.json path/to/bundle ./out
```

**JS API:**

```javascript
import { debundle } from "bundle-breaker";

const files = { "index.js": "...", "chunk.js": "..." };
const fileRenames = { "abc123.js": "foo-bar.js", "...": "..." };
const deb = debundle(files);
deb.updateNames(fileRenames);
```

### Automatic Naming

However, since source file names are usually lost in the bundling/minification process, `bundle-breaker` also supports automatic file renaming. This is powered by OpenAI's large language models. This allows us to easily automate the tedious process of inferring the purpose of code - even with minimal deobfuscation. Thanks to the sheer size of these models, this achieves a very solid level of accuracy.

**CLI:**

```sh
OPENAI_API_KEY=foobar npx bundle-breaker -c -f auto path/to/bundle ./out
```

To use automatic file renaming via the CLI you must ensure you have set the `OPENAI_API_KEY` environment variable. You could choose to do this via something like [dotenv](https://www.npmjs.com/package/dotenv) or [.env support in Node v20.6+](https://nodejs.org/en/blog/release/v20.6.0#built-in-env-file-support) if you so wish.

```javascript
import { debundle, OpenAIAssistant } from "bundle-breaker";

const openAiApiKey = "foobar";
const files = { "index.js": "...", "chunk.js": "..." };
const deb = debundle(files);
// create the API client with our key. this will default to process.env.OPENAI_API_KEY if omitted.
const openAiClient = new OpenAIAssistant(openAiApiKey);
// create a vector store containing all our debundle's files
const vs = await openAiClient.getOrCreateVectorStore(deb);
const renames = await openAiClient.computeFileRenames(vs);
// ... we chould choose to save these computed renames to the disk for future use without needing the API again ...
deb.updateNames(renames);
```

The `OpenAIAssistant` utility class is responsible for provisioning and managing all resources on the OpenAI servers via their API. It aims to produce minimal clutter. For example, `bundle-breaker` will only create one [assistant](https://platform.openai.com/docs/api-reference/assistants) per model you choose to use. It will also use the unique identifier of each debundle and its constituent files (which are calculated via hashing their ASTs) to avoid creating duplicate resources under your project.

In general, it would be good practice to create a unique project on the OpenAI dashboard for each reverse-engineering project you work on to keep everything separate and make clean-up easy.

> **Note**: Usage of automatic file renaming requires sending your debundled code to OpenAI's API. This means it should be avoided unless you have express permission of the original application's owner.

## Group

TODO

## Prune

TODO

# Supported bundlers and config options

The tool aims to work with to the majority bundler configurations and versions. Notably this includes:

- Webpack 4 and 5
- All `webpack.ids` plugins
- Bundles split across multiple bundles
- Runtime-only chunks
- ... and (hopefully) everything between!

If you find a config that doesn't work as you'd expect and the relevant option(s)/version(s) are not listed in the known limitations below please raise an issue.

## Known limitations

| Bundler | Date added | Limitation                                                               |
| ------- | ---------- | ------------------------------------------------------------------------ |
| WP5     | 09/05/24   | Multi-chunk bundles with any `output.chunkFormat` besides `'array-push'` |

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
