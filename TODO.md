# Test case ideas

- [x] Chunk splitting
- [x] output.iife on vs off in WP5
- [ ] Hashed module IDs plugin
- [ ] Terser plugin
- [ ] Different values of output.chunkFormat in WP5 (doesn't exist in WP4) - will likely need dev work

# Features

- [ ] Visualize: Add module graph visualization
- [ ] Group: Graph clustering on the module graph + group modules into directories
- [ ] Prune: Add module graph pruning to cherrypick certain module(s) and their transitive deps
- [ ] Rename: LLM-based file naming
- [ ] Deobfuscate: Standard deobsfucation with [restringer](https://github.com/PerimeterX/restringer) and LLM-based token renaming (similar to [humanify](https://github.com/jehna/humanify))

# Enhancements

- [x] Make some full examples - include their webpack versions and configs. Use pnpm workspaces.
- [x] Add metadata file to load in previously unpacked bundles for further operation
- [ ] Use node:test (or vitest?) to test the examples
- [ ] Write a readme with some example usage
- [ ] Add pretty logging when parsing chunks with loading spinners
- [ ] Add colors for logs?
- [ ] Add support for library mode bundles (via output.library/output.libraryTarget + their various module formats)
- [ ] Clean-up and expose a JS API with type defs - class-based API perhaps?
- [ ] Support for other bundlers - rollup first (to capture Vite usages), then maybe parcel and esbuild
