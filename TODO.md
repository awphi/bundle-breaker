# Core

- [ ] Change the codescanning to work with webpack 4 style bundles. A big int->fn map is not a valid assumption in webpack 4 at all or 5 with hashed module IDs. More advanced idea to avoid relying on this invalid assumption:
  - [ ] Locate the require fn by look for a function idenitifier that gets all the single letter props placed on it
  - [ ] Scan the require fn for the identifier that is indexed and .call()ed on - deem this as the modules identifier.
  - [ ] Find the declaration for the modules identifier in the scope.
  - [ ] If it's an empty object then we know it's an iife-style webpack4 bundle - we'll need a new codemod to replace the array or object arg as needed.
  - [ ] If it's not empty then we're good to go with replacing like we did before in webpack 5 style bundles.
- [ ] Should be able to re-use the the first part of the logic above (i.e. finding the require fn) to auto-detect the entry file.
- [ ] Delete the getModuleMaps (or w/e) codescan and instead use the method above for the entry or for additional chunks we should be able to scan the args of the call to .push()

# Test case ideas

Example usage from `/examples/webpack4`: `export NODE_OPTIONS=--openssl-legacy-provider && pnpm webpack -c splitchunks/webpack.config.js`

- [ ] Hashed module IDs plugin
- [ ] Terser plugin
- [ ] Chunk splitting
- [ ] Different values of output.chunkFormat - check if exists in WP4

# Enhancements

- [ ] Make some full examples - include their webpack versions and configs. Use pnpm workspaces.
- [ ] Use node:test (or vitest?) to test the examples
- [ ] Experiment with code purpose inference for file naming
- [ ] Write a readme with some example usage
- [ ] Add an extension for module isolation. Maybe have different operations for the script - unbundle, filter (uses eval to prune the module graph)
- [ ] Add pretty logging when parsing chunks with loading spinners
- [ ] Add colors for logs?
