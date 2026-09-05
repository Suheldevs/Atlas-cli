# Atlas — Build Plan (4 Phases)

> This document is the approved build plan, kept in the repository so it travels with the code.
> Each phase ends at a hard stop for review. Nothing in a later phase starts before the prior phase's
> exit criteria are met.

## Context

Atlas is a production-quality Node.js + TypeScript code _generator_ CLI — not a runtime library.
Running `atlas auth` writes real TypeScript source files into an existing project, and once written,
that project has **zero** dependency on Atlas. Philosophically it sits with shadcn/ui, Nest CLI, and
Angular Schematics — not with npm runtime packages.

That single constraint — _generated code must survive Atlas being uninstalled_ — drives every decision
below. It means templates cannot be abstractions (they must be complete, handwritten-quality files), and
it means the engineering value lives in the **engine**: project detection, atomic writes, conflict
resolution, and dependency reconciliation.

## Confirmed decisions

| Decision              | Choice                                                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm package           | `@mohdsuhel/atlas` (`atlas-cli` is taken on npm — v1.0.2 exists). Binary: `atlas`                                                                                |
| Module format         | ESM-only, Node ≥ 22.13 (Node 20 is EOL; `@inquirer/prompts@8` sets the floor)                                                                                    |
| Build                 | `tsup` (esbuild) bundle → `dist/`; templates copied verbatim, never bundled                                                                                      |
| Templates location    | Repo **root** `templates/`, not `src/` — they are assets, excluded from `tsconfig.json`                                                                          |
| Wiring existing files | Anchor-comment injector (no `ts-morph`); AST codemods deferred to an opt-in plugin                                                                               |
| Auth target           | Express 5 + TypeScript only. ESM + CJS, Mongoose or Prisma. Other frameworks detected and refused cleanly                                                        |
| Pinned versions       | `commander@15`, `@inquirer/prompts@8`, `chalk@6`, `ora@9`, `execa@10`, `fs-extra@11`, `prettier@3.9`, `typescript@6`, `vitest@4`, `eslint@10`, `tsup@8`, `tsx@4` |

Each of these is recorded with its full rationale as an ADR in [adr/](./adr/).

---

## Phase 1 — Bootstrap

A runnable, publishable, tested CLI shell. No generators, no engine, no templates.

**Files**

- `package.json` — `type: module`, `engines.node >= 22.13`, `bin: { atlas, atlas-cli }`, `exports`, `files`,
  keywords, license, repository/homepage/bugs placeholders
- `tsconfig.json` — `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`,
  `module: nodenext`, excludes `templates/`
- `tsup.config.ts`, `vitest.config.ts`, `eslint.config.js` (flat), `.prettierrc`, `.gitignore`, `LICENSE` (MIT)
- `bin/atlas.js` — shebang, Node-version guard **before** any dynamic import, delegates to `dist/cli.js`
- `src/cli.ts` — Commander root; global flags `--cwd --yes --dry-run --verbose --no-color`;
  `exitOverride()` so Atlas owns exit codes; SIGINT → 130; top-level error boundary
- `src/index.ts` — programmatic surface (for tests + future editor integrations)
- `src/constants/{exit-codes,branding,paths}.ts`
- `src/config/package-meta.ts` — resolves package root by walking up for `package.json`, so `version`
  is correct in both `tsx` dev mode and the bundled `dist/` build
- `src/errors/{atlas-error,error-catalog,error-presenter}.ts` — typed hierarchy, stable `ATLAS_nnnn`
  codes, hint + docs URL, exception → exit code mapping
- `src/services/{reporter,process}.service.ts` — Reporter is the **only** writer to stdout (chalk + ora,
  honours `NO_COLOR`/non-TTY/unicode support); Process wraps execa with cwd, timeout, env scrubbing
- `src/commands/{register-commands,doctor}.command.ts` — `atlas doctor` fully implemented (Node version,
  package managers on PATH, git, cwd writability) so the shell is genuinely exercisable
- `src/types/cli-options.ts`
- `tests/unit/{cli,error-presenter}.test.ts`
- `README.md`, `docs/`, `git init` (no commit — that stays the maintainer's call)

**Exit criteria:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass;
`node bin/atlas.js --version`, `--help`, and `doctor` all behave.

The compiler gate is resolved, in both halves:

- **TypeScript 7 rejected; pinned to 6.0.3.** `typescript-eslint@8.65.0`, the latest release, declares a
  peer dependency of `typescript ">=4.8.4 <6.1.0"`, so TypeScript 7 has no type-aware lint support and
  `npm install` fails outright with `ERESOLVE`. Losing type-aware ESLint is a worse trade than deferring
  the compiler upgrade.
- **tsup's `dts` step dropped.** Under TS 6, tsup's declaration build fails with
  `TS5101: Option 'baseUrl' is deprecated`, because tsup synthesises its own tsconfig and injects
  `baseUrl`. Rather than mask a real deprecation with `ignoreDeprecations`, `dts` is `false` in
  `tsup.config.ts` and declarations come from a second build step,
  `tsc -p tsconfig.build.json --emitDeclarationOnly`. The JS bundle still comes from tsup/esbuild.

---

## Phase 2 — Detection + Generation Engine

The core. Everything that touches disk lives here, behind injectable services.

- `src/detection/` — one cached filesystem pass → immutable `ProjectContext`.
  Detectors: framework, language/strictness, **module-system (ESM vs CJS — decides the `.js` suffix on
  every generated import)**, package manager, database, src-layout, **monorepo (wrong install level
  silently breaks pnpm workspaces)**
- `src/engine/generation-plan.ts` + `plan-builder.ts` + `generation-engine.ts` — **plan-then-apply**.
  Generators build an immutable plan; the engine validates it whole, then applies. Gives `--dry-run`
  free and makes conflicts a pre-flight question rather than a mid-write interruption
- `src/engine/vfs/` — writes buffered in memory, single ordered commit, undo journal → `rollback`.
  A failure during dependency install must never leave orphan files behind
- `src/engine/conflict/` — detector (exists / identical / modified-since-generated) + resolver with the
  five options (overwrite, skip, backup, diff, abort) + coloured unified diff renderer
- `src/engine/deps/` — planner (union of template deps − already installed), version-range reconciler,
  installer delegating to `PackageManagerService`
- `src/engine/format/` — prettier resolving the **target project's** config, not Atlas's
- `src/engine/inject/` — `anchor-injector`, order-preserving `json-merger`, non-clobbering `env-merger`
- `src/engine/hooks/` — ordered lifecycle stages
- `src/services/{filesystem,package-manager,git,clock}.service.ts` — interfaces + real impls;
  npm/pnpm/yarn/bun behind one interface
- `src/types/generator.ts` — the contract:
  `detect / prompt / validate / generate / installDependencies / postGenerate`
- `src/registry/` + `src/plugins/` — static manifest for built-ins (no startup fs glob), dynamic
  resolution for `atlas-plugin-*`; both reach the registry through the same door
- `src/config/` — `atlas.config.ts` loader, precedence chain: flags > project > user > defaults
- `src/prompts/` — primitives with one central `--yes`/CI/non-TTY gate
- `src/commands/{list,info}.command.ts` — now implementable and immediately useful for debugging
- Tests: engine pipeline fully unit-tested against an in-memory `FileSystemService` (no disk);
  `tests/fixtures/` gains express-esm, express-cjs, js-only, monorepo

**Exit criteria:** engine can apply a hand-written plan into a fixture, atomically, with rollback proven
by a fault-injection test. `atlas info` correctly reports all fixtures.

**Delivered.** The exit criteria are met. What actually shipped, for the record:

- **Detection** makes one cached filesystem pass and produces a single immutable `ProjectContext` that every
  consumer in a run shares. Seven detectors, including the two called out above: module-system and monorepo.
- **Plan-then-apply holds.** Generators return an immutable `GenerationPlan` and never touch disk; the engine
  formats, resolves every conflict, stages, and commits. See
  [adr/0004](./adr/0004-plan-then-apply-generation.md).
- **Atomicity is proven, not asserted.** The fault-injection test in
  `tests/integration/generation-engine.test.ts` forces one write to fail mid-commit and then asserts the
  filesystem snapshot is byte-identical to the snapshot taken before the run.
- **Conflict resolution** covers all five options: skip, back up and replace, show diff, overwrite, abort.
  `src/prompts/conflict.prompt.ts` presents the menu and drives the diff-then-re-ask loop through the
  resolver's injected `ask` callback, so the engine still imports no prompt library. `diff` is deliberately
  not part of `ConflictChoice` — it is a request for information, not a decision, which keeps the resolver's
  return type exhaustive. `--yes` resolves to **backup**, never overwrite: non-interactive means nobody is
  watching, so the destructive answer is not Atlas's to pick.
- **Dependency planning** never reinstalls a package the manifest already satisfies, and never silently
  upgrades a range the user pinned. A mismatch is reported, not resolved.
- **Injections** join the same transaction as file writes, so they roll back with everything else, and they
  are idempotent — re-running a generator does not register the same route twice.
- `atlas info` and `atlas list` are available and immediately useful for support.
- All four fixtures — express-esm, express-cjs, js-only, monorepo — are in place and asserted against in
  `tests/integration/detection-fixtures.test.ts`, which is what makes the second exit criterion checkable
  rather than a matter of opinion.
- `npm run verify` — typecheck, lint, format check, tests, build — is green.

**Still open.** `BUILTIN_GENERATORS` is empty. The engine is finished and exercised, but nothing ships that
drives it end to end yet, which is why the exit criteria above are phrased around a hand-written plan rather
than a command. Templates and the first real generator are Phase 3's job.

---

## Phase 3 — Template System

- `templates/` at root; `template.json` schema (`name`, `version`, `description`, `dependencies`,
  `devDependencies`, `scripts`, `files`, `requires`) — dependencies live **only** here, never in code
- `src/engine/template/` — loader, manifest validator, `token-replacer`, `token-table`
  (one input `User` → `User`/`user`/`users`/`user-profile`/`USER_CREATED`; correct pluralisation),
  read-once cache
- `src/constants/tokens.ts` — canonical `__TOKEN__` vocabulary, so a typo'd token fails CI
- `templates/@types/` — ambient shims letting templates typecheck without installing express/jwt
- `tsconfig.templates.json`, `scripts/validate-templates.ts`, `scripts/copy-templates.ts`
- `.github/workflows/ci.yml` — matrix (Node 22/24 × npm/pnpm/yarn), plus the two real gates:
  templates parse + typecheck, and generated output passes `tsc` **and** ESLint
- One thin end-to-end template (`templates/logger`, Winston) to prove the whole path works
- `docs/template-authoring.md`, `docs/generator-contract.md`

**Exit criteria:** `atlas logger` generates into a fixture, output compiles, snapshot committed.

**Delivered.** The exit criteria are met, and verified against a real project rather than a double:

- **The command layer that runs generators**, which Phase 2 left out: `atlas add logger` and the
  `atlas logger` shortcut are both built from `GeneratorMeta` by one factory, so declaring a flag is all a
  generator author does. [generator-runner.ts](../src/commands/generator-runner.ts) is the single place the
  lifecycle ordering is enforced. Registry discovery now precedes command registration, because each
  generator becomes a real subcommand and which ones exist depends on the target project's plugins.
- **Tokens** derive every casing from one input, with pluralisation good enough for real entity names. The
  vocabulary in [tokens.ts](../src/constants/tokens.ts) is the single source of truth, imported by the CI
  gate rather than copied.
- **Substitution is single-pass**, so a replacement value that happens to contain token-like text is never
  rescanned. Strict mode scans the _input_ for leftovers, so the diagnostic can only ever blame the template.
- **`atlas logger` generates 7 files into `src/logger/`**, installs `winston` from `template.json`, and the
  result compiles under `strict` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` against the
  real package. Snapshot committed at `tests/integration/__snapshots__/`.
- **The gate is real, not decorative.** A deliberately misspelled `__ENTITY_NAM__` makes
  `scripts/validate-templates.ts` fail with the file and line, exit 1.
- 616 tests across 23 files; `npm run verify` is green.

**One defect the gate caught, worth recording.** `templates/@types/ambient.d.ts` declared `express`, so
`templates/logger` typechecked in CI while importing Express types its `template.json` never declared — the
generated code failed to compile in any project without Express, and the gate reported PASS. The fix was to
type the middleware boundary structurally (Express's own `Request`/`Response` satisfy it, nothing is
imported) and to delete the `express` shim so the same class of defect cannot hide again. A shim that
supplies a package the template never declared does not make the check stricter; it makes it lie.

---

## Phase 4 — Auth Generator (Express + TypeScript)

The reference implementation every later module copies.

- `src/generators/auth/` — `auth.generator.ts`, `auth.prompts.ts`, `auth.schema.ts`,
  `auth.plan.ts` (pure `(options, context) => FilePlan[]`, testable with zero mocks)
- `templates/auth/` — complete, handwritten-quality: JWT access/refresh with rotation + reuse detection,
  register/login/refresh/logout controllers, auth service, password hashing (argon2id or bcrypt),
  auth + role middleware, routes, DTOs, validators, typed errors, token repository (Mongoose or Prisma),
  env schema validation. No insecure defaults, no TODOs, no placeholder logic
- Tests: unit (plan), integration (generate into all fixtures), e2e (packed tarball → real install →
  real `tsc`), snapshots
- `docs/commands/auth.md`, `examples/express-auth/`
- `.changeset/`, release workflow, CONTRIBUTING / SECURITY / CODE_OF_CONDUCT — publish-ready

**Exit criteria:** a fresh Express + TS app, plus `atlas auth`, plus `npm run dev`, yields a working and
secure auth flow — and removing Atlas from the project changes nothing.

**After Phase 4:** `crud`, `redis`, `socket`, `prisma`, `upload` each repeat Phase 4's pattern with no
engine changes required. That is the real test of whether the architecture held.

---

## Verification (every phase)

1. `npm run verify` — typecheck, lint, format check, tests, build
2. `node bin/atlas.js doctor` / `info` / `list` against `tests/fixtures/*`
3. From Phase 3 on: generate into a fixture, then run `tsc --noEmit` **and** ESLint over the _generated_
   output — the only honest check that "generated code is production-quality"
4. Phase 4: `npm pack`, install the tarball into a scratch Express app, generate, boot, exercise the auth
   endpoints, then confirm the app still builds with Atlas fully uninstalled
