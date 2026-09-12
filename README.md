# bundle-breaker

`bundle-breaker` is a CLI application and JS library that allows you to break up bundled JS applications (a.k.a. debundling) into meaningful individual modules based on the structure of the bundler output.

# Features

- **Executable output** - Debundled applications aim to remain executable and behave identically to the bundled input.
- **Wide support** - Support for both Webpack 4 and 5 bundled applications is available and tested across a variety of common bundler versions, settings and plugin configurations. Support for other bundlers/wider config support is in-progress and contributions are welcome.

# Usage

## CLI

TODO

## JS API

Automatically determine the bundler that was used:

```js
import { load, save, split } from "bundle-breaker"; // load and save are simple fs read/write utilities

const rawBundle = await load("./path/to/bundle/dir");
const bundle = split(rawBundle); // split the bundled application into per-module files

await save("./path/to/output/bundle/dir", bundle);
```

Force debundling for a supported bundler:

```js
import { load, save } from "bundle-breaker";
import { split } from "bundle-breaker/webpack";

const rawBundle = await load("./path/to/webpack/generated/bundle/dir");
const bundle = split(rawBundle);

await save("./path/to/output/bundle/dir", bundle);
```

# What next?

Debundling is usually just the first step in recovering meaningful surce code from a bundled application. Given `bundle-breaker` aims to produce standard, executable CJS applications, most JS codemodding tools, eslint plugins or anything similar is applicable to generated debundled output.

Some common workflows and recommended tools are listed below:

## Conversion to ESM

TODO

## Deobfuscation

TODO

## Module graph analysis

TODO

## Applying meaningful file names

TODO
