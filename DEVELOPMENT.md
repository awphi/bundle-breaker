# Building the examples

This repo contains a number of sample projects for running e2e tests that must be built before running said tests:

```sh
pnpm examples:build-all
```

_Alternatively_, to re-build individual examples (e.g. `webpack4_47-simple`):

```sh
pnpm examples:build webpack4_47-simple
```
