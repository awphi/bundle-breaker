# Additional test case ideas

- [ ] Different values of output.chunkFormat in WP5 (doesn't exist in WP4) - will likely need dev work

# Features

- [ ] Group: Graph clustering on the module graph + group modules into directories
- [ ] Prune: Add module graph pruning to cherrypick certain module(s) and their transitive deps
- [ ] Rename: LLM-based file naming
- [ ] Deobfuscate: Standard deobsfucation with [restringer](https://github.com/PerimeterX/restringer) and LLM-based token renaming (similar to [humanify](https://github.com/jehna/humanify))
- [ ] Support for parcel - it seems to hoist scope similar to rollup but give export unique source-file-based identifiers which we can exploit to plonk functions, classes, constants etc back in individual module files
- [ ] Think about how we can at least partially support rollup

# Enhancements

- [ ] Add pretty logging when parsing chunks with loading spinners
- [ ] Add colors for logs?
- [ ] Add support for library mode bundles (via output.library/output.libraryTarget + their various module formats)
- [ ] Support for other bundlers - rollup first (to capture Vite usages), then maybe parcel and esbuild
