# Atlas — Architecture

## The one constraint that drives everything

Atlas is a code generator. Running `atlas auth` writes real TypeScript source files into an existing
project, and once written, that project has **zero** dependency on Atlas. Delete Atlas from the machine
and nothing about the application changes.

Three consequences follow, and they explain the entire repository:

1. **Templates cannot be abstractions.** There is no Atlas runtime to import, no base class to extend, no
   helper package to depend on. Every generated file must be complete and of handwritten quality on its
   own. A template is not a configuration of behaviour — it _is_ the behaviour.
2. **The engineering value lives in the engine.** If templates are just files, the difficulty moves
   entirely to everything around them: detecting what kind of project this is, deciding what the file
   should contain for _this_ project, writing it atomically, resolving conflicts with code the user
   already owns, and reconciling dependency ranges. That is where the code is, and that is where the
   tests are.
3. **The CLI's only job is: detect → materialise → wire → get out of the way.** Anything that looks like
   a framework, a runtime, or a long-lived process in Atlas is a design error.

Everything below is downstream of those three sentences.

## Repository layout

```
atlas/
├── bin/atlas.js
├── src/
│   ├── index.ts, cli.ts
│   ├── commands/            new, add, generate, list, info, doctor, shortcuts, register-commands
│   ├── generators/          project, auth, crud, redis, socket, prisma, logger, upload (each a folder with
│   │                        <name>.generator.ts, <name>.prompts.ts, <name>.schema.ts, <name>.plan.ts)
│   ├── plugins/             plugin-loader, plugin-resolver, plugin-validator, plugin-context
│   ├── registry/            generator-registry, discovery, capability-index
│   ├── engine/              generation-engine, generation-plan, plan-builder
│   │   ├── template/        template-loader, template-manifest, token-replacer, token-table, template-cache
│   │   ├── vfs/             virtual-file-system, commit, rollback
│   │   ├── conflict/        conflict-detector, conflict-resolver, diff-renderer, backup-strategy
│   │   ├── deps/            dependency-planner, dependency-resolver, dependency-installer
│   │   ├── format/          formatter, prettier-config-resolver
│   │   ├── inject/          anchor-injector, json-merger, env-merger
│   │   └── hooks/           hook-runner, lifecycle
│   ├── detection/           project-scanner, project-context, detectors/{framework,language,module-system,
│   │                        package-manager,database,src-layout,monorepo}
│   ├── prompts/             prompt-runner, confirm, select, entity-name, conflict
│   ├── services/            filesystem, package-manager, process, git, reporter, clock
│   ├── config/              config-loader, config-schema, defaults, resolved-config, package-meta
│   ├── errors/              atlas-error, error-catalog, error-presenter
│   ├── types/               generator, plugin, project-context, generation-plan, template-manifest
│   ├── constants/           tokens, paths, exit-codes, markers, branding
│   └── utils/               casing, path, object, semver, guards, result
├── templates/               auth, crud, redis, socket, prisma, logger, upload, project, @types
├── tests/                   unit, integration, e2e, fixtures, snapshots, helpers
├── docs/                    + adr/, commands/
├── examples/                express-auth, custom-plugin
├── scripts/                 build, copy-templates, validate-templates, check-generated-output
└── .github/                 workflows, ISSUE_TEMPLATE, CODEOWNERS
```

## Why each folder exists

### `bin/`

[bin/atlas.js](../bin/atlas.js) is plain JavaScript and is **never compiled**. Three reasons, all of them
practical:

- It must keep a stable shebang (`#!/usr/bin/env node`) at byte zero of the file. Build tools rewrite,
  reorder, or drop shebangs; a compiled entry point is a shebang waiting to break.
- It is the file npm symlinks into `node_modules/.bin`. That path must never move between versions,
  which means it cannot be an artefact of a build configuration.
- It runs the Node-version guard **before any modern syntax is parsed**. A syntax error is thrown at
  parse time, not run time, so a version check that lives inside `dist/cli.js` is useless — the user
  would see a `SyntaxError` instead of "Atlas requires Node >= 22.13.0". The guard therefore lives in
  conservative JavaScript, and the real CLI is reached only afterwards, via dynamic `import()`.

### `commands/`

Deliberately thin. Commander is a _parsing library_; treating it as an application layer is the single
most common CLI design failure — business logic accumulates in action handlers, becomes reachable only
through `process.argv`, and stops being testable. In Atlas, a command owns exactly three things: its
flags, its arity, and its help text. It then hands off to the registry and the engine.

`shortcuts.ts` is the payoff. It generates `atlas auth` as an alias of `atlas add auth` by reading the
registry, so adding a generator produces a top-level alias with **no new command file**. The set of
commands stops growing with the set of features.

### `generators/`

Each generator is a folder, not a file, because a generator has four separable concerns:

| File                  | Concern                                                   |
| --------------------- | --------------------------------------------------------- |
| `<name>.generator.ts` | The `Generator` contract implementation and orchestration |
| `<name>.prompts.ts`   | Interactive question definitions                          |
| `<name>.schema.ts`    | Option validation and defaults                            |
| `<name>.plan.ts`      | Pure `(options, context) => FilePlan[]`                   |

Splitting out `<name>.plan.ts` is the one that matters. It is a pure function: no I/O, no prompts, no
services. That makes the most bug-prone part of any generator — _which files, at which paths, from which
templates, with which tokens_ — testable with zero mocks and zero filesystem access.

### `plugins/`, `registry/`, `generators/`

These three look redundant. They are not; they are data, machinery, and catalogue.

| Folder        | Role                                                                                  |
| ------------- | ------------------------------------------------------------------------------------- |
| `generators/` | The features themselves — data                                                        |
| `plugins/`    | The loading machinery — resolution, import, contract validation, capability injection |
| `registry/`   | The catalogue — lookup, aliasing, collision detection                                 |

Keeping them apart is what makes third-party plugins first-class rather than bolted on. A built-in
generator and an `atlas-plugin-stripe` pulled from npm reach the registry **through the same door**: both
are validated by `plugin-validator`, both are registered by `generator-registry`, both appear in
`atlas list`, both get a shortcut alias. There is no privileged internal path, which means the plugin API
cannot silently rot — Atlas's own generators are its heaviest consumer.

`capability-index.ts` answers the inverse question: not "what does `auth` provide?" but "which generators
can serve a project with Prisma and ESM?".

### `registry/discovery.ts`

Built-in generators are discovered from a **static manifest**, not a runtime filesystem glob. Globbing
`src/generators/*/index.ts` at startup costs 20–40 ms on every invocation, breaks under bundling (the
files no longer exist as separate modules in `dist/`), and defeats tree-shaking because the bundler
cannot see the imports. A static manifest is a plain module with explicit imports: fast, bundler-visible,
and type-checked.

Only **external** plugins are resolved dynamically, because there is no alternative there — their names
are not known at build time.

### `engine/` — plan-then-apply

Generators never write to disk. They build an immutable `GenerationPlan` describing file operations,
dependencies, scripts, and hooks. The engine validates the plan _as a whole_, then applies it.

Two things fall out of this for free:

- `--dry-run` is honest, not approximated. It is the same code path minus the commit.
- Conflict resolution becomes a **pre-flight question** rather than a mid-write interruption. The user
  answers everything before anything happens.

This is the same model as Terraform (`plan` / `apply`) and Angular Schematics (a `Tree` recorded, then
committed). It is a well-worn design, chosen for well-worn reasons.

### `engine/template/`

Loads a template directory and its `template.json` manifest, replaces the `__TOKEN__` vocabulary via
`token-replacer`, and derives every casing variant of the user's input in `token-table`. `template-cache`
exists because a single generation may read the same partial many times, and disk reads inside a spinner
are the easiest latency to remove.

### `engine/vfs/`

Staged writes plus an undo journal. Writes are buffered in memory, committed in one ordered pass, and
every applied operation is journalled so `rollback` can reverse it.

The motivating failure is concrete: a dependency install fails halfway (registry timeout, lockfile
conflict, disk full) after files have already been written. Without a VFS, the user is left with orphan
files in their `src/` that they did not write and Atlas will not clean up. **A half-generated project is
worse than no generation at all**, and this is exactly the bug class that destroys trust in a codegen
tool permanently — one bad experience and the tool is uninstalled.

### `engine/conflict/`

Detects whether a target path is absent, present-and-identical, or present-and-modified, and resolves the
outcome (overwrite, skip, backup, diff, abort). `diff-renderer` prints a coloured unified diff so the
answer is informed. `backup-strategy` decides backup filenames — which is why `clock.service.ts` exists;
see `services/` below.

### `engine/deps/`

`dependency-planner` computes the union of template dependencies minus what is already installed;
`dependency-resolver` reconciles version ranges against the project's existing ones rather than
overwriting them; `dependency-installer` delegates to `PackageManagerService`. Dependencies are declared
in `template.json` and nowhere else, so the answer to "what will this install?" is data, not control flow.

### `engine/format/`

`prettier-config-resolver` resolves the **target project's** Prettier configuration, not Atlas's. This is
not a nicety. Generated code that uses double quotes and semicolons in a codebase that uses neither reads
as foreign the moment it lands, and foreign-looking code gets rewritten or deleted. Matching the
surrounding house style is what makes generated files feel like the user wrote them.

### `engine/inject/`

The **only** sanctioned way for Atlas to touch a file it did not author. `anchor-injector` inserts at
marker comments, `json-merger` merges into `package.json` / `tsconfig.json` while preserving key order,
and `env-merger` appends to `.env` files without clobbering existing values. Everything else in the engine
writes whole files it owns. Centralising modification here means the risky operations are one small,
heavily tested surface rather than a habit spread across generators. See
[ADR 0003](./adr/0003-anchor-comment-injection-over-ast-codemods.md).

### `engine/hooks/`

Ordered lifecycle stages (`beforePlan`, `afterPlan`, `beforeWrite`, `afterWrite`, `afterInstall`) so
plugins can participate in generation without the engine importing them.

### `detection/`

A bounded context, not a util folder — the distinction is that this code does I/O. One cached filesystem
pass produces one immutable `ProjectContext` that every generator reads. The alternative, each generator
re-reading `package.json` and re-guessing, produces inconsistent answers within a single run and
multiplies filesystem work by the number of generators involved.

Two detectors are non-obvious but load-bearing:

- **module-system** — ESM versus CJS decides the `.js` suffix on every relative import in every generated
  file. Get it wrong and nothing compiles. There is no partial credit and no graceful degradation.
- **monorepo** — installing dependencies at the wrong level silently breaks pnpm workspace resolution.
  The failure is silent, which makes it worse than a crash: the user finds out later, somewhere else.

### `prompts/`

The primitives (`confirm`, `select`, `entity-name`, `conflict`) exist mainly to justify one central
`prompt-runner`, which owns the `--yes` / CI / non-TTY gate. Without it, every generator grows its own
`if (options.yes)` branch, each slightly different, and the non-interactive path — the path CI actually
uses — rots untested. One gate means one place to test that Atlas never blocks on stdin when there is no
terminal.

### `services/`

Injectable adapters over the outside world: filesystem, package manager, child processes, git, output,
and time. This is what makes the engine testable — swap `FileSystemService` for an in-memory fake and the
entire pipeline runs in-process, with no temp directories and no cleanup.

Two of them deserve specific defence:

- **`reporter.service.ts` is the sole writer to stdout.** A stray `console.log` interleaves with spinner
  output and corrupts the terminal, and it would make a future `--json` mode impossible to add without
  auditing every file in the repository. One writer means `NO_COLOR`, non-TTY, unicode support, and
  verbosity are handled once.
- **`clock.service.ts`** looks like overkill until you snapshot-test a timestamped backup filename. An
  injectable clock is the difference between a deterministic assertion and a test that fails on the next
  run.

### `errors/`

Holds runtime _classes_, which is precisely why it is not `types/` — these are values that exist at
runtime and are thrown, caught, and mapped to exit codes.

A code generator fails in dozens of _expected_ ways: a dirty git tree, an unsupported framework, an
unwritable path, a conflicting dependency range, a missing package manager. None of those are bugs, and
none of them should ever surface as a stack trace. Stable `ATLAS_nnnn` codes buy three things: an
actionable hint per failure, deterministic exit codes that CI can branch on, and a greppable identifier
that turns a support conversation into a documentation link. See
[troubleshooting.md](./troubleshooting.md).

### `types/`

Enforces dependency direction. `engine` and `generators` both depend on `types`; neither depends on the
other. Without a shared type-only module, the generator contract would have to live in `engine`, which
would make every generator import the engine, which would make the engine's own imports of generators
circular. Type-only modules are the cheapest way to break that cycle at compile time.

### `constants/`

`tokens.ts` is the single source of truth for the placeholder vocabulary. Because every token is a named
constant, CI can enumerate them and fail on a misspelled `__ENTITIY_NAME__` in a template — a class of
bug that is otherwise invisible until a user sees the literal placeholder in their generated file.

`markers.ts` holds the anchor comment strings that end up **permanently in users' files**. Once shipped,
changing a marker string orphans every project that already has it. They are pinned in one file precisely
so they cannot drift.

### `utils/`

Pure functions only. No I/O, no state, no imports from anything above them.

`casing.ts` matters more than it looks. `atlas crud User` must derive `User`, `user`, `users`,
`user-profile`, and `USER_CREATED` — and bad pluralisation (`Categorys`, `Persons`, `Datas`) is the
number-one giveaway of amateur codegen. It is the first thing a user notices and the thing they least
forgive, because it appears in identifiers they have to live with.

### `templates/`

At the repository root, not under `src/`, because templates are **assets, not compiled code**. They are
real `.ts` files — deliberately, so authors get editor support and so token placeholders like
`__ENTITY_NAME__` remain valid TypeScript identifiers — but they import `express` and `jsonwebtoken`,
which Atlas does not depend on. Under `src/`, the project's own `tsc` build would try to compile them and
fail.

A separate `tsconfig.templates.json` plus ambient shims in `templates/@types/` lets CI typecheck them
anyway, while `package.json#files` ships them verbatim. See
[ADR 0001](./adr/0001-templates-live-at-the-repository-root.md).

### `tests/`

Three tiers with distinct jobs, and no tier duplicates another:

| Tier           | Job                                                                   |
| -------------- | --------------------------------------------------------------------- |
| `unit/`        | Engine logic, plan construction, casing, conflict detection — no disk |
| `integration/` | Generate into temp directories against `fixtures/`                    |
| `e2e/`         | Pack the tarball, real install, real `tsc` over the generated output  |

`fixtures/` covers express-esm, express-cjs, nest, js-only, and monorepo — the shapes where detection is
allowed to be wrong at most zero times.

`snapshots/` is the actual regression net. Committed expected output turns a template edit into a
reviewable diff in a pull request, which is the only mechanism that reliably catches "this change also
altered nine other generated files".

### `scripts/`

- `copy-templates.ts` — exists because templates are assets rather than compiled code, so the bundler
  will not move them; they must be copied verbatim into the published layout.
- `validate-templates.ts` — the CI gate that makes "templates are always valid TypeScript" _enforced_
  rather than aspirational. It parses every template, typechecks against `tsconfig.templates.json`, and
  cross-checks every `__TOKEN__` against `constants/tokens.ts`.
- `check-generated-output.ts` — runs `tsc` **and** ESLint over generated results. This is the only honest
  way to enforce the claim that generated code is production-quality; everything else is an assertion
  about intent.

### `docs/adr/`

Numbered decision records. Their purpose is narrow and worth stating plainly: they stop the same
architectural debate recurring every six months with new contributors. "Why not Handlebars?" and "why not
`ts-morph`?" are reasonable questions with long answers, and answering them once in writing is cheaper
than answering them repeatedly in review threads.

### `examples/`

`express-auth/` is a working reference application. `examples/custom-plugin/` is the proof that the plugin
API is real and not theoretical — a plugin that lives outside the repository, is loaded through the public
contract, and is exercised in CI.

### `.github/`

Workflows (the Node × package-manager matrix, template validation, generated-output checks, release),
issue templates that collect `atlas doctor` output up front, and `CODEOWNERS`.

## Dependency direction

Imports flow one way. This is checked, not merely intended.

```
commands  →  registry / engine  →  services  →  utils / types / constants

generators  →  types + engine
engine      →  generators        ✗ never
```

Concretely:

- `commands/` may import the registry and the engine. Nothing imports `commands/`.
- `engine/` may import `services/`, `types/`, `constants/`, and `utils/`. It must never import a
  generator; it receives plans, it does not know who built them.
- `generators/` may import `types/` and the engine's public surface. Generators never import each other.
- `services/` may import `utils/`, `types/`, `constants/`, and `errors/`. Nothing else.
- `utils/` imports nothing from within `src/`. It is the bottom of the graph.

The one-way rule is what allows a third-party plugin to be indistinguishable from a built-in generator:
both sit at the same layer, both depend only downward, and the engine has no privileged knowledge of
either.

---

Not all of these folders exist yet. They arrive progressively across the four phases — the shell and
error model first, then detection and the engine, then templates, then the reference generator. See
[project-plan.md](./project-plan.md) for what lands when, and for each phase's exit criteria.
