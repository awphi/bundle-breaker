# Core

- [ ] Change the codescanning to work with webpack 4 and 5 bundles:
  - [x] Locate the require fn by looking for the something[e].call(a,b,c,d) in a function def. Could tighten this later.
  - [x] Re-use the above logic for determining runtime chunk
  - [ ] Find additional module maps via a chunk with a single .push() call in it (only works for chunkFormat: 'array-push' in WP5)
  - [ ] Find runtime chunk module map by checking if IIFE and is IIFE args are full - if true then we've got a WP4 style chunk, else WP5

# Test case ideas

Example usage from `/examples/webpack4`: `export NODE_OPTIONS=--openssl-legacy-provider && pnpm webpack -c splitchunks/webpack.config.js`

- [ ] Hashed module IDs plugin
- [ ] Terser plugin
- [ ] Chunk splitting
- [ ] Different values of output.chunkFormat in WP5 (doesn't exist in WP4) - will likely need dev work

# Enhancements

- [x] Make some full examples - include their webpack versions and configs. Use pnpm workspaces.
- [ ] Use node:test (or vitest?) to test the examples
- [ ] Write a readme with some example usage
- [ ] Add metadata file to load in previously unpacked bundles for further operation
- [ ] Add module graph visualization
- [ ] Add module graph pruning to cherrypick certain module(s) and their transitive deps
- [ ] Add simple module graph clustering - can be via kCores, forests etc.
- [ ] Experiment with inference based naming for individual modules and module groups (perhaps via LLM?)
- [ ] Add pretty logging when parsing chunks with loading spinners
- [ ] Add colors for logs?
- [ ] Add support for library mode bundles (via output.library/output.libraryTarget + their various module formats)
- [ ] Clean-up and expose a JS API with type defs - class-based API perhaps?
- [ ] Support for other bundlers - rollup first (to capture Vite usages), then maybe parcel and esbuild
