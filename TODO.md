# Features

- [ ] Group: Graph clustering on the module graph + group modules into directories
- [ ] Prune: Add module graph pruning to cherrypick certain module(s) and their transitive deps
- [ ] Support for parcel - it seems to hoist scope similar to rollup but give export unique source-file-based identifiers which we can exploit to plonk functions, classes, constants etc back in individual module files
- [ ] Think about how we can at least partially support rollup

# Enhancements

- [ ] Different values of output.chunkFormat in WP5 (doesn't exist in WP4) - will likely need dev work
- [ ] Add support for library mode bundles (via output.library/output.libraryTarget + their various module formats)
- [ ] Playground for docs site - will need a server of some kind
- [ ] Improve deobfuscation - LLM-based token renaming or more simple codemods?
- [ ] Put on npm and add banner to README
- [ ] Tests for LLM renaming
- [ ] Create docs site workspace w/ vitepress - deploy to vercel. fully clientside - allow users to insert openai api key + store in localstorage
