# bundle-breaker

TODO npm banner

`bundle-breaker` is a CLI and JS API to make reverse-engineering bundled JavaScript applications easy and accessible. This can comprise of the separation, grouping, naming, pruning, deobfuscation and rebundling of production-built JavaScript applications.

The tool aims to be robust and tolerant to various bundler configurations. If you find a config that doesn't work as you'd expect and the relevant option(s) are not listed in our known limitations please raise an issue.

# Features

## Debundle

The first step to reverse-engineering a production JS application is to undo the bundling process performed by tools like webpack and rollup. `bundle-breaker` calls this process "debundling" and is performed like so:

```sh
npx bundle-breaker debundle path/to/bundle out
```

Running the command above will create what is referred to as **a debundle**. This consists of a modified copy of all your original bundle chunks, the individual modules that were contained in the chunks (now separated out into their own files) and some metadata. We can perform further operations on this **debundle** to extract even more useful information from it.

## Visualize

TODO

## Name

TODO

## Group

TODO

## Prune

TODO

## Rebundle

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

5. Test everything is working with a quick debundle operation by running:

   ```sh
   node . debundle examples/webpack4/simple/out out
   ```
