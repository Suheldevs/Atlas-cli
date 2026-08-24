// Build configuration for the shipped bundle.
//
// tsup externalises everything listed in package.json `dependencies` by default, so only Atlas's
// own source under `src/` is bundled. Runtime dependencies (commander, chalk, prettier, ...) stay
// as plain imports resolved from node_modules at run time — prettier in particular must never be
// inlined into `dist/`, since it is a large dependency that consumers resolve themselves.
//
// Declarations are generated against `tsconfig.build.json`, which narrows `include` to `src` so
// tests and scripts never leak into the published type surface.
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  tsconfig: 'tsconfig.build.json',
  // Declarations are NOT generated here. tsup's dts step synthesises its own tsconfig and
  // injects a `baseUrl`, which TypeScript 6 rejects as deprecated (TS5101). Rather than
  // silence a real deprecation with `ignoreDeprecations`, the build runs `tsc
  // --emitDeclarationOnly` as a second step — the actual compiler, no synthesised config,
  // and one less fragile code path between us and a correct `.d.ts`.
  dts: false,
  sourcemap: true,
  clean: true,
  splitting: true,
  treeshake: true,
  shims: false,
});
