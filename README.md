# Atlas

Generate production-grade TypeScript modules directly into your project.

<!-- The repository URLs below (https://github.com/suhel/atlas) are placeholders and must be updated before publishing. -->

## What it does

Atlas is a code generator. You run one command, and it writes real TypeScript source files into your
existing project.

```
npx @suhel/atlas auth
```

Before:

```
src/
  app.ts
  server.ts
```

After:

```
src/
  app.ts
  server.ts
  auth/
    auth.controller.ts
    auth.routes.ts
    auth.service.ts
    jwt.ts
    password.ts
    middleware/
      require-auth.ts
```

Those are ordinary files that you own, read, review, and edit. Nothing in them imports Atlas. Once
the command finishes, your project has zero dependency on Atlas — you can uninstall it and the
generated code keeps working exactly as it did.

## Why it works this way

The core rule is simple: **generated code must keep working after Atlas is uninstalled.**

That single constraint drives everything else, and it has three consequences:

1. **Templates are complete files, not abstractions.** Each template is a handwritten-quality
   implementation of the thing it claims to be. There is no Atlas base class to extend, no Atlas
   runtime to configure, and no indirection you have to learn in order to read your own code.
2. **The engineering lives in the engine.** The hard parts are project detection, atomic writes,
   conflict resolution, and dependency reconciliation — knowing what kind of project it is, writing
   files without corrupting a half-finished run, asking before touching anything that already
   exists, and reconciling the dependencies the new code needs against the ones you already have.
3. **Atlas's only job is: detect, materialise, wire, get out of the way.** It is not a framework and
   it does not stay in the loop.

This puts Atlas in the same family as shadcn/ui, `create-next-app`, the Nest CLI, Angular
Schematics, and `prisma init`. It is **not a runtime library**.

## Requirements

- Node.js >= 22.13
- One of npm, pnpm, yarn, or bun

## Installation

No install is needed. The recommended way to run Atlas is on demand:

```
npx @suhel/atlas <command>
```

If you would rather have it on your PATH:

```
npm install -g @suhel/atlas
```

Or pin it per project as a dev dependency, so everyone on the team generates with the same version:

```
npm install -D @suhel/atlas
```

The binary is `atlas`. `atlas-cli` is installed as an alias for it.

## Status

Atlas is pre-1.0 but complete: seven generators ship, and the generated output is verified by compiling
it against real packages under `strict`, not by asserting on strings. **Not yet published to npm** — see
[docs/usage.md](docs/usage.md) for running it locally in the meantime.

| Command                            | Requires             |
| ---------------------------------- | -------------------- |
| `doctor`, `info`, `list`           | Nothing              |
| `auth`, `crud`, `socket`, `upload` | Express + TypeScript |
| `logger`, `prisma`, `redis`        | TypeScript           |

Run `atlas list` inside a project and it names any unmet requirement rather than failing later.

## Usage

```
npx @suhel/atlas list           # what applies to this project, and why the rest does not
npx @suhel/atlas auth           # or: atlas add auth
npx @suhel/atlas crud Product
```

Every generator takes `--dir <path>`; `auth` also takes `--hashing` and `--database`, and `prisma`
takes `--provider`. `atlas <generator> --help` is the reference for each.

[docs/usage.md](docs/usage.md) covers all seven in detail, along with what to do after each one writes.

### `atlas doctor`

Reports whether the current environment can run Atlas. It checks:

- the Node.js version against the minimum Atlas supports
- which package managers are available (npm, pnpm, yarn, bun)
- whether `git` is installed
- whether the working directory is writable

```
$ npx @suhel/atlas doctor

Atlas 0.1.0

  ok    Node.js            v22.14.0 (requires >= 22.13.0)
  ok    Package manager    npm 10.9.2 (also found: pnpm 9.15.4)
  ok    git                git version 2.47.1
  ok    Working directory  /home/you/projects/api is writable

  4 checks passed, 0 warnings, 0 failed.
```

### Global flags

These apply to every command.

| Flag            | Effect                                                |
| --------------- | ----------------------------------------------------- |
| `--cwd <path>`  | Run against `<path>` instead of the current directory |
| `-y, --yes`     | Accept all defaults; never prompt                     |
| `--dry-run`     | Report every change that would be made, write nothing |
| `-v, --verbose` | Include diagnostic detail in the output               |
| `--no-color`    | Disable coloured output                               |
| `-V, --version` | Print the Atlas version                               |
| `-h, --help`    | Print help for Atlas or for a command                 |

## Safe by default

Atlas never overwrites a file silently. When a target file already exists, it stops and asks, and
the choices are always the same five:

- **overwrite** — replace the file
- **skip** — leave the existing file alone
- **backup and replace** — keep a copy of the original, then write the new file
- **show diff** — see exactly what would change, then decide
- **abort** — stop the whole run, leaving the project untouched

`--dry-run` shows every change without writing anything, so you can inspect a generator's full
effect before letting it near your working tree.

Writes are buffered and committed once, with an undo journal, so a run that fails partway through — or
that you abort — leaves no half-generated module behind. Under `--yes` or in a non-interactive shell
there is nobody to ask, so Atlas picks **backup and replace**: the only choice that cannot lose work.

## Documentation

| Document                                           | What it covers                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| [docs/README.md](docs/README.md)                   | Documentation index and reading order                                     |
| [docs/usage.md](docs/usage.md)                     | Running Atlas locally, and using it once published                        |
| [docs/publishing.md](docs/publishing.md)           | Connecting GitHub, and releasing to npm                                   |
| [docs/project-plan.md](docs/project-plan.md)       | The 4-phase build plan and confirmed technical decisions                  |
| [docs/architecture.md](docs/architecture.md)       | Repository layout and why each folder exists                              |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Every `ATLAS_nnnn` error code, its cause, and its fix                     |
| [docs/adr/](docs/adr/)                             | Architecture Decision Records — the reasoning behind irreversible choices |

## Development

```
git clone https://github.com/suhel/atlas.git
cd atlas
npm install
```

| Script               | What it does                                                                |
| -------------------- | --------------------------------------------------------------------------- |
| `npm run dev`        | Run the CLI straight from source with tsx, no build step                    |
| `npm run build`      | Bundle the CLI and the programmatic entry into the dist directory with tsup |
| `npm run typecheck`  | Type-check everything with `tsc --noEmit`                                   |
| `npm run lint`       | Lint with ESLint                                                            |
| `npm run format`     | Format with Prettier                                                        |
| `npm test`           | Run the test suite once with Vitest                                         |
| `npm run test:watch` | Run Vitest in watch mode                                                    |
| `npm run verify`     | The full gate: typecheck, lint, format check, tests, then build             |

`npm run verify` is what CI runs and what `prepublishOnly` runs, so a clean `verify` means the
change is publishable.

To exercise the CLI exactly as an installed user would, build first and then invoke the real binary
entry point:

```
npm run build
node bin/atlas.js --help
```

[docs/usage.md](docs/usage.md) covers the four ways to run an unpublished Atlas — `tsx`, the built
binary, `npm link`, and a packed tarball — and what each one does and does not prove.

## Contributing

Issues and pull requests are welcome. Please run `npm run verify` before opening a PR. Changes that
affect the architecture need an accompanying ADR in [docs/adr/](docs/adr/) explaining the decision
and the alternatives considered.

## License

MIT — see [LICENSE](LICENSE).
