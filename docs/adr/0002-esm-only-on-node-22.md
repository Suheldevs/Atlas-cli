# 0002 — ESM-only on Node 22.13

**Status:** Accepted

**Date:** 2026-07-27

## Context

Atlas is a binary. Nobody imports it, nobody bundles it into an application, and nobody consumes its
types at runtime. The usual argument for dual CJS/ESM publishing — _don't break consumers on either side_
— has no consumer here to protect. What dual publishing does cost is real: two build outputs, two module
resolution behaviours to reason about, conditional-exports edge cases, and the dual-package hazard, all in
exchange for compatibility nobody uses.

Cold-start latency, by contrast, is a UX cost users feel on every invocation. Most people will reach Atlas
through `npx`, where the time between pressing enter and seeing a prompt is the first impression the tool
makes. Fewer, larger files with pre-resolved imports start measurably faster than a wide unbundled module
graph.

The floor is Node 22.13.0, and the reasons are external to the language. Node 20 reached end of life in
April 2026, so claiming support for it would mean shipping a newly released tool on a runtime that receives
no security patches. And the pinned dependencies already require Node 22 regardless: `@inquirer/prompts@8`
declares `engines.node >= 23.5.0 || ^22.13.0 || ^20.17.0`, `commander@15` declares `>= 22.12.0`, `chalk@6`
declares `>= 22`, `execa@10` declares `>= 22`, and `ora@9` declares `>= 20`. `@inquirer/prompts` is the
binding constraint, which is where the exact 22.13.0 comes from: its 22.x branch starts at 22.13.0, so Node
22.12.0 — enough for Commander — does not satisfy it. The floor is the strictest thing the dependency tree
already demands, not a number chosen independently of it.

`import.meta.dirname` is used directly for path resolution, which is not incidental in a tool whose whole
job is locating templates and writing files. It arrived in Node 20.11 and is simply available at this
floor; it is no longer the thing that sets the floor.

## Decision

ESM-only. `"type": "module"`, `engines.node >= 22.13.0`, and a single bundled ESM output produced by tsup
(esbuild).

tsup externalises `dependencies` by default, so only Atlas's own source is bundled. Prettier, Commander,
and the prompt libraries stay as normal installed dependencies rather than being inlined — which keeps the
published package small, keeps their licences intact, and lets Prettier resolve the target project's plugins
at run time.

## Alternatives considered

| Alternative                                                                                | Why rejected                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dual-format output (`format: ['esm','cjs']`)                                               | Doubles the build matrix and the bug surface — conditional exports, the dual-package hazard, two sets of resolution semantics — for zero benefit to a binary nobody imports.                                                    |
| Plain `tsc`, no bundling                                                                   | Simpler and one fewer tool, but measurably slower cold start: hundreds of small modules each resolved and read on every run. For an `npx`-first CLI that is the wrong trade.                                                    |
| CJS-only                                                                                   | A dead end. chalk 5+, ora 8+, execa 6+, and `@inquirer/prompts` are already ESM-only. Staying on CJS means pinning to unmaintained major versions today and having no upgrade path tomorrow.                                    |
| Keep the floor at Node 20 and pin older dependency majors (commander 12, chalk 5, execa 9) | Rejected: it means shipping a tool built on a runtime that receives no security patches, in exchange for supporting an audience that should be upgrading anyway.                                                                |
| Support Node 18                                                                            | Out of maintenance since April 2025, and incompatible with every pinned dependency, so it would force the same downgrade as the option above only further back. Modern Node is a reasonable ask of a TypeScript developer tool. |

## Consequences

**Good**

- One build output, one resolution model, one thing to test.
- Faster cold start on `npx`, which is where first impressions are formed.
- Direct access to the current, maintained versions of the CLI ecosystem, all of which are ESM-only.
- The declared floor is derived from the dependency tree rather than chosen beside it, so `engines.node`
  cannot quietly drift below what the pinned packages require.
- `import.meta.dirname` is available unconditionally, so path code reads as intended rather than as
  `fileURLToPath(new URL('.', import.meta.url))` ceremony.

**Accepted costs**

- Users on Node 20 or earlier cannot run Atlas at all. There is no degraded mode and no fallback build.
  The guard in `bin/atlas.js` rejects them with [ATLAS_1001](../troubleshooting.md#atlas_1001) and an
  explicit upgrade instruction rather than a `SyntaxError`.
- `require('@mohdsuhel/atlas')` is impossible. Acceptable: the programmatic surface in `src/index.ts` exists for
  tests and future editor integrations, both of which are ESM.
- A bundler in the toolchain, so stack traces need source maps to be readable.
- Externalised dependencies mean the install is not a single file; `node_modules` size is a function of
  Commander, Prettier, and the prompt libraries rather than of Atlas.
