# Contributing to Atlas

Atlas is a code generator, and that shapes what contributing to it looks like. The output of this repository
is TypeScript source that lands in somebody else's project and is then read, reviewed, and maintained as
their own code. It has to be right, and it has to look handwritten. There is no runtime we can patch later.

Before changing anything, read [docs/architecture.md](docs/architecture.md). It explains why every folder
exists, and most review comments on a first pull request are answered there.

## Setup

```
git clone https://github.com/suhel/atlas.git
cd atlas
npm install
```

Requirements:

| Requirement | Version                                                              |
| ----------- | -------------------------------------------------------------------- |
| Node.js     | >= 22.13.0 — the `engines` floor, set by `@inquirer/prompts@8`       |
| npm         | Whatever ships with that Node. Only `package-lock.json` is committed |

Atlas is ESM-only. There is no CommonJS build and no plan for one; see
[adr/0002](docs/adr/0002-esm-only-on-node-22.md).

Check the CLI runs:

```
npm run build
node bin/atlas.js --version
node bin/atlas.js doctor
```

`atlas doctor` and `atlas info` are the two commands worth knowing early. `doctor` reports the environment;
`info` reports what Atlas detected about the project it is pointed at, which is the answer to almost every
"why did it generate that?" question — including your own.

## Scripts

| Script                 | Does                                                                      |
| ---------------------- | ------------------------------------------------------------------------- |
| `npm run dev`          | Runs the CLI from source through `tsx`, with no build step                |
| `npm run build`        | Bundles to `dist/` with tsup, then emits declarations                     |
| `npm run build:types`  | Declarations only, via `tsc -p tsconfig.build.json --emitDeclarationOnly` |
| `npm run build:watch`  | tsup in watch mode                                                        |
| `npm run typecheck`    | `tsc --noEmit` over `src`, `tests`, `scripts`, and the config files       |
| `npm run lint`         | ESLint, type-aware                                                        |
| `npm run lint:fix`     | The same, applying fixes                                                  |
| `npm run format`       | Prettier, writing                                                         |
| `npm run format:check` | Prettier, checking. This is what CI runs                                  |
| `npm test`             | Vitest, once                                                              |
| `npm run test:watch`   | Vitest, watching                                                          |
| `npm run clean`        | Removes `dist/`                                                           |
| `npm run verify`       | **The gate.** All of the above that matter, in order                      |

Declarations come from a separate `tsc` step rather than from tsup because tsup's `dts` build fails under
TypeScript 6 — it synthesises a tsconfig and injects the deprecated `baseUrl`. The reasoning is recorded in
[docs/project-plan.md](docs/project-plan.md).

## The verify gate

```
npm run verify
```

That is `typecheck`, `lint`, `format:check`, `test`, `build`, in that order, and it is what CI runs on every
pull request. Run it before pushing; it is faster than a round trip through a red check, and the order is
chosen so the cheapest failure surfaces first.

Two things `verify` deliberately does **not** cover:

**Templates.** [templates/](templates/) is excluded from [tsconfig.json](tsconfig.json), from ESLint, and
from Prettier. Templates reference packages this repository does not install, and they are formatted with the
_target_ project's Prettier config, not Atlas's. They have their own gate:

```
npx tsx scripts/check-generated-output.ts
npx tsx scripts/validate-templates.ts
```

**Generated output.** The only honest check that generated code is production quality is running `tsc` and
ESLint over a real generation. CI does that in the `generated-output` job: it packs the tarball, installs it
into a scratch Express + TypeScript project, generates, then typechecks and lints the result. To do it
locally, generate into one of the [tests/fixtures/](tests/fixtures/) projects and run the target project's
own compiler over the output.

`tests/fixtures/` is likewise excluded from all three tools. The fixtures are miniature projects used as
detection _input_; their deliberately varied formatting and non-strict configs must survive untouched.

## Running a single test file

```
npx vitest run tests/unit/plan-builder.test.ts
```

By name, across the suite:

```
npx vitest run -t 'refuses to shadow a built-in'
```

Watching one file while you work on it:

```
npx vitest tests/unit/vfs.test.ts
```

Tests import `describe`, `it`, and `expect` from `vitest` explicitly — globals are off — so a new test file
starts with an import.

The three tiers have distinct jobs and none of them should duplicate another:

| Tier                 | Job                                                                  |
| -------------------- | -------------------------------------------------------------------- |
| `tests/unit/`        | Engine logic, plan construction, casing, conflict detection. No disk |
| `tests/integration/` | Generate into temp directories against `tests/fixtures/`             |
| `tests/e2e/`         | Pack the tarball, real install, real `tsc` over the generated output |

A bug fix needs a test that fails without the fix. For engine work that usually means a unit test against the
in-memory `FileSystemService` in [tests/helpers/](tests/helpers/) — the whole pipeline runs in-process, with
no temp directories and no cleanup.

## Project layout

[docs/architecture.md](docs/architecture.md) is the full account. The two rules most likely to affect a pull
request:

**Imports flow one way, and it is checked rather than intended.**

```
commands  →  registry / engine  →  services  →  utils / types / constants

generators  →  types + engine
engine      →  generators        ✗ never
```

**The `Reporter` service is the only permitted writer to stdout.** `no-console` is an error for a reason: a
stray `console.log` interleaves with spinner output and corrupts the terminal, and it would make a future
`--json` mode impossible to add without auditing every file in the repository.

## Architecture decisions need an ADR

Any architectural change comes with a numbered record in [docs/adr/](docs/adr/), in the same pull request.
That covers a new module boundary, a change to the generator or plugin contract, a new runtime dependency, a
new anchor marker, and anything else that would be expensive to reverse.

The purpose is narrow and worth stating plainly: ADRs stop the same debate recurring every six months with
new contributors. "Why not Handlebars?" and "why not `ts-morph`?" are reasonable questions with long answers,
and answering them once in writing is cheaper than answering them repeatedly in review threads. Follow the
shape of the existing records — context, decision, alternatives considered with reasons for rejection, and
consequences including the costs accepted.

If the reasoning behind a change is worth writing in a review comment, it is worth writing where the next
contributor will find it.

## Adding a generator

Read [docs/generator-contract.md](docs/generator-contract.md) first. A generator is a folder, not a file,
because it has four separable concerns:

| File                  | Concern                                                   |
| --------------------- | --------------------------------------------------------- |
| `<name>.generator.ts` | The `Generator` contract implementation and orchestration |
| `<name>.prompts.ts`   | Interactive question definitions                          |
| `<name>.schema.ts`    | Option validation and defaults                            |
| `<name>.plan.ts`      | Pure `(options, context) => FilePlan[]`                   |

`<name>.plan.ts` is the one that matters. It is a pure function — no I/O, no prompts, no services — which
makes the most bug-prone part of any generator (which files, at which paths, from which templates, with which
tokens) testable with zero mocks.

Register it in `BUILTIN_GENERATORS` in [src/generators/index.ts](src/generators/index.ts). That list is a
hand-maintained static manifest rather than a filesystem scan, on purpose: globbing at startup costs 20–40 ms
per invocation and breaks once the CLI is bundled. Adding the import is the registration.

The one rule: **`generate` returns a plan and never writes.** A generator that touches the filesystem breaks
`--dry-run`, breaks pre-flight conflict resolution, and breaks rollback, all at once.

## Adding a template

[docs/template-authoring.md](docs/template-authoring.md) covers the directory contract, every `template.json`
field, the `__TOKEN__` vocabulary, and the rules generated code has to obey. The short version:

- `templates/<name>/template.json` plus `templates/<name>/files/`.
- Dependencies are declared in `template.json` and nowhere else.
- Every relative import ends with `__IMPORT_SUFFIX__`.
- Generated code is complete, `strict`-clean, production-safe by default, and never imports Atlas.
- New token? Register it in `src/constants/tokens.ts`, or CI will not know it is a token.

## Third-party generators

If what you want to add is useful but not something almost every project wants, it may belong in a plugin
rather than in the box. A package named `atlas-plugin-*` in a project's dependencies is discovered
automatically, and its generators are indistinguishable from built-ins: same contract, same registry, same
`atlas list`, same shortcut alias. See [docs/plugin-development.md](docs/plugin-development.md).

That is not a way of saying no. It means you can ship it today without waiting for us, and the plugin API
staying honest is a design goal — Atlas's own generators are its heaviest consumer.

## Commits and pull requests

Commit messages follow Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`,
`ci:`, with an optional scope (`fix(engine): …`). The subject is imperative and lower-case, and it says what
changed rather than which files moved.

For pull requests:

- One concern per pull request. A refactor bundled with a behaviour change is two reviews pretending to be
  one, and it is the shape most likely to hide a regression.
- `npm run verify` passes locally before you push.
- Add a changeset (`npx changeset`) for anything user-facing: a command, a flag, generated output, an error
  message, an error code.
- A new `ATLAS_nnnn` code goes in [src/errors/error-catalog.ts](src/errors/error-catalog.ts) **and** in
  [docs/troubleshooting.md](docs/troubleshooting.md), with a cause and a fix. A code with no documentation
  entry is a support conversation instead of a link.
- Changes to generated output come with an updated snapshot, reviewed as part of the diff. Committed expected
  output is what turns a template edit into a reviewable change, and it is the only mechanism that reliably
  catches "this also altered nine other generated files".
- Never re-spell a shipped anchor marker or error code. Both end up permanently in users' repositories and in
  their search history.

The pull request template lists all of this as a checklist. It is there to be used, not deleted.

## Reporting bugs

Use the issue forms. For a bug, the output of `atlas info` is the single most useful thing you can include:
most reports about wrong output come down to one detector disagreeing with what the reporter expected, and
that output settles it in one round trip.

If Atlas printed an `ATLAS_nnnn` code, check [docs/troubleshooting.md](docs/troubleshooting.md) first — every
code is listed with its cause and its fix, and most of them are configuration rather than bugs.
