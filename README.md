# bundle-breaker

`bundle-breaker` is a CLI application and JS library that provides an opinionated set of tools to debundle, deobfuscate and generally reverse-engineer a bundled JS application.

Supported bundlers:

- Webpack 4 & 5

# Features

- **Split** - Break your bundled application into meaningful individual module files inferred from the structure of the bundled application.
- **Graph** - Coming soon
- **Rename** - Coming soon
- **Deobfuscate** - Coming soon

# Usage

## CLI

TODO

## JS API

```js
import { load, split } from "bundle-breaker";

const rawBundle = await load("./path/to/bundle/dir");
const bundle = split(rawBundle); // split the bundled application into per-module files

await save("./path/to/output/bundle/dir", bundle);
```
