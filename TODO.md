# Additional test case ideas

- [ ] Different values of output.chunkFormat in WP5 (doesn't exist in WP4) - will likely need dev work

# Features

- [ ] Group: Graph clustering on the module graph + group modules into directories
- [ ] Prune: Add module graph pruning to cherrypick certain module(s) and their transitive deps
- [ ] Rename: LLM-based file naming
- [ ] Deobfuscate: Standard deobsfucation with [restringer](https://github.com/PerimeterX/restringer) and LLM-based token renaming (similar to [humanify](https://github.com/jehna/humanify))

# Enhancements

- [ ] Expose typedefs for index.ts - maybe api-extractor?
- [ ] Use node:test (or vitest?) to test the examples
- [ ] Add pretty logging when parsing chunks with loading spinners
- [ ] Add colors for logs?
- [ ] Add support for library mode bundles (via output.library/output.libraryTarget + their various module formats)
- [ ] Support for other bundlers - rollup first (to capture Vite usages), then maybe parcel and esbuild
