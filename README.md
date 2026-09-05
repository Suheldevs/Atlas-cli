# Atlas

[![npm](https://img.shields.io/npm/v/@mohdsuhel/atlas)](https://www.npmjs.com/package/@mohdsuhel/atlas)

Start a full-stack project, or generate production-grade modules into one you already have.

```
npm install -g @mohdsuhel/atlas
```

The package is [`@mohdsuhel/atlas`](https://www.npmjs.com/package/@mohdsuhel/atlas). The command it
installs is `atlas`. You can also run it without installing anything:

```
npx @mohdsuhel/atlas start my-app
```

## What it does

Atlas does two things.

**Start a new project.** From an empty directory, `atlas start` writes a working Express + Mongoose
API and a Vite + React client, in JavaScript or TypeScript, with authentication already wired
between them:

```
$ atlas start my-app

my-app/
  server/     Express 5 + Mongoose — auth, CRUD, uploads, logging
  client/     Vite + React — login, signup, protected routes
```

```
cd my-app/server && npm install && npm run dev
cd my-app/client && npm install && npm run dev
```

Open the client, sign up, and you are logged into your own API. See [`atlas start`](#atlas-start) for
what it generates and why.

**Add a module to a project you already have.** `atlas add` writes real source files into an existing
codebase:

```
$ atlas add auth
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

Either way, those are ordinary files that you own, read, review, and edit. Nothing in them imports
Atlas. Once the command finishes, your project has zero dependency on Atlas — you can uninstall it
and the generated code keeps working exactly as it did.

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
npx @mohdsuhel/atlas <command>
```

If you would rather have it on your PATH:

```
npm install -g @mohdsuhel/atlas
```

Or pin it per project as a dev dependency, so everyone on the team generates with the same version:

```
npm install -D @mohdsuhel/atlas
```

The binary is `atlas`. `atlas-cli` is installed as an alias for it.

## Status

Atlas is pre-1.0 but complete: seven generators and `atlas start` ship, across fifteen templates whose
generated output is verified by compiling it against real packages under `strict`, not by asserting on
strings. Published to npm as [`@mohdsuhel/atlas`](https://www.npmjs.com/package/@mohdsuhel/atlas).

| Command                            | Requires             |
| ---------------------------------- | -------------------- |
| `start`, `doctor`, `info`, `list`  | Nothing              |
| `auth`, `crud`, `socket`, `upload` | Express + TypeScript |
| `logger`, `prisma`, `redis`        | TypeScript           |

Run `atlas list` inside a project and it names any unmet requirement rather than failing later.

## Usage

```
atlas start my-app          # create a new full-stack project
atlas list                  # what applies to this project, and why the rest does not
atlas add auth              # or the shortcut: atlas auth
atlas crud Product          # a CRUD resource for one entity
atlas doctor                # check this machine can run Atlas
```

Every generator takes `--dir <path>`; `auth` also takes `--hashing` and `--database`, and `prisma`
takes `--provider`. `atlas <command> --help` is the reference for each.

[docs/usage.md](docs/usage.md) covers all seven generators in detail, along with what to do after each
one writes.

### `atlas start`

Every other command generates _into_ a project that already exists. `start` is the one that creates
one, for when you have nothing but an empty directory.

```
npx @mohdsuhel/atlas start my-app
```

It asks whether you want JavaScript or TypeScript — or takes `--language <js|ts>` — and writes two
independent packages:

```
my-app/
  server/                Express 5 + Mongoose
    src/
      auth/              signup, login, me, refresh rotation, logout
      item/              a CRUD resource to copy
      upload/            multer with a size limit and MIME allowlist
      logger/            winston, JSON in production
      config/            env validation, database connection
      middleware/        error handler, 404
      utils/             ApiError, ApiResponse, asyncHandler
    .env.example
    package.json
  client/                Vite + React
    src/
      pages/             Login, Signup, Dashboard
      context/           auth provider
      routes/            protected and public-only routes
      lib/               axios client
    package.json
```

There is no root `package.json` on purpose: the two halves are separate packages, so either can move
to its own repository later without unpicking a workspace.

```
cd my-app/server && npm install && npm run dev
cd my-app/client && npm install && npm run dev
```

Auth works on the first run — the login page talks to your own API, with the access token held in a
module variable and the refresh token in an httpOnly cookie.

Every endpoint answers through one envelope, so the client never special-cases a route:

```js
res.api(200, 'Fetched', items, { page, limit, total });
// -> { statusCode, success, message, data, meta, timestamp }

throw new ApiError(404, 'Item not found');
// -> { success: false, statusCode, message, errors, timestamp }
```

The error handler translates Mongoose `CastError`, `ValidationError` and duplicate-key `11000` into
real status codes rather than letting them surface as a 500, and never returns an internal message
to the client.

Configuration is validated before the server binds a port: every missing or malformed variable is
reported at once rather than one restart at a time, and a `JWT_ACCESS_SECRET` still set to the
`.env.example` placeholder is rejected outright.

The TypeScript path reuses the same `auth`, `crud`, `upload` and `logger` templates the `add`
commands use, so both languages are held to the compile gate.

| Flag                  | Effect                                            |
| --------------------- | ------------------------------------------------- |
| `--language <js\|ts>` | Skip the prompt                                   |
| `--skip-install`      | Write the project without installing dependencies |
| `--skip-git`          | Do not initialise a repository                    |

`new` and `create` are aliases. `--dry-run` reports the whole tree without writing anything, and a
run that fails or is interrupted rolls the directory back rather than leaving half a project.

### `atlas doctor`

Reports whether the current environment can run Atlas. It checks:

- the Node.js version against the minimum Atlas supports
- which package managers are available (npm, pnpm, yarn, bun)
- whether `git` is installed
- whether the working directory is writable

```
$ npx @mohdsuhel/atlas doctor

ℹ Inspecting environment
Environment
✔ Node.js           v22.14.0
✔ Package managers  npm 10.9.2
✔ Git               git version 2.47.1
✔ Workspace         /home/you/projects/api (writable)

✔ Everything looks good.
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
git clone https://github.com/Suheldevs/Atlas-cli.git
cd Atlas-cli
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
