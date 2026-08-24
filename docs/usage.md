# Using Atlas

Two situations, one document: running Atlas from this repository before it exists on npm, and using it
after it is published.

They differ only in how the binary gets onto your machine. Every command, flag, and generated file is
identical either way — which is also why local testing is worth trusting. What you see locally is what
your users will see.

---

# Part 1 — Locally, before publishing

## Four ways to run it

| Method                  | Setup cost                 | Best for                                           |
| ----------------------- | -------------------------- | -------------------------------------------------- |
| **`tsx` on the source** | None                       | Changing Atlas itself — no build step at all       |
| **`node bin/atlas.js`** | `npm run build`            | Testing the real bundle, no global state touched   |
| **`npm link`**          | `npm run build` + one link | Typing `atlas` like a user does                    |
| **`npm pack`**          | build + pack + install     | The last check before publishing — closest to real |

Start with the first for development, and use the last once before you publish. The two in the middle
are for everyday manual testing.

### 1. Straight from the source, no build

```bash
cd "d:/Mohd Suhel/Downloads/Atlas-cli"

npx tsx src/cli.ts --version
npx tsx src/cli.ts list --cwd ../playground
npx tsx src/cli.ts crud Product --cwd ../playground
```

`npm run dev` is the same thing (`tsx src/cli.ts`), but pass flags after `--`:

```bash
npm run dev -- list --cwd ../playground
```

No build, so there is no stale-`dist/` failure mode and edits to `src/` take effect immediately. Slightly
slower to start, and it exercises the TypeScript source rather than the esbuild bundle — which is very
nearly but not exactly what ships.

### 2. The built binary

```bash
npm run build
node bin/atlas.js list --cwd ../playground
```

This is the real entry point, the real bundle, and the real template files. Nothing is installed and
nothing global changes, which makes it the safest option — the one to reach for by default.

**`dist/` is gitignored, and `bin/atlas.js` imports `../dist/cli.js` directly.** So a fresh clone fails
with `ERR_MODULE_NOT_FOUND` until you build, and — worse, because it is silent — an old `dist/` will
happily run your _previous_ code. When a change seems to have had no effect, build again.

`npm run build:watch` keeps `dist/` current while you work.

### 3. `npm link`

Puts `atlas` on your PATH, pointing at this working tree:

```bash
cd "d:/Mohd Suhel/Downloads/Atlas-cli"
npm run build
npm link
```

Then from anywhere:

```bash
atlas doctor
atlas info
atlas list
atlas auth
```

The link is a symlink to this directory, so a rebuild is picked up without re-linking — but it is
still a _build_, so `npm run build` after every source change. Undo it with:

```bash
npm unlink -g @suhel/atlas
```

On Windows, `npm link` needs either Developer Mode enabled or an elevated terminal to create the
symlink. If it fails with `EPERM`, use method 2 instead; nothing is lost but the shorter command.

### 4. Pack the tarball

The only method that proves what will actually be published: it goes through `files` in `package.json`,
so a template left out of the tarball fails here and nowhere else.

```bash
cd "d:/Mohd Suhel/Downloads/Atlas-cli"
npm run build
npm pack                     # writes suhel-atlas-0.1.0.tgz

cd ../playground
npm install -D "d:/Mohd Suhel/Downloads/Atlas-cli/suhel-atlas-0.1.0.tgz"
npx atlas list
```

`npm pack` does **not** run `prepublishOnly`, so it will package a stale `dist/`. Build first, every
time. Use `npm pack --dry-run` to read the file list without producing a tarball.

Re-installing an updated tarball with the same version sometimes serves the cached copy. Force it:

```bash
npm install -D "…/suhel-atlas-0.1.0.tgz" --no-cache
```

## Setting up a project to generate into

Atlas refuses to write into a project it does not understand, so a bare directory will be rejected —
by design. The smallest thing that satisfies every generator:

```bash
mkdir ../playground && cd ../playground
npm init -y
npm pkg set type=module
npm install express
npm install -D typescript @types/node @types/express tsx
npx tsc --init
mkdir src
```

`type: module` gives you ESM, which makes generated relative imports carry a `.js` suffix. Leave it out
and Atlas detects CommonJS and drops the suffix instead. Both paths are supported and both are worth
testing at least once — that suffix is the single most likely thing to break.

There are also four ready-made fixtures in [tests/fixtures/](../tests/fixtures/) —
`express-esm`, `express-cjs`, `js-only`, and `monorepo`. They are checked in without `node_modules`, so
generated code cannot be compiled there, but they are ideal for `--dry-run` and for `atlas info`.

## Confirm Atlas sees the project correctly

Always start here. Every generator's behaviour follows from detection, so a wrong answer here explains
any surprise later:

```bash
atlas doctor    # is this environment able to run Atlas at all
atlas info      # what Atlas thinks your project is
atlas list      # which generators apply, and why the others do not
```

`atlas list` marks each generator. A `⚠` is not a failure — it is Atlas telling you a requirement is
unmet, and naming it:

```
⚠ logger  Structured Winston logging …  (needs typescript, found javascript)
⚠ auth    JWT auth with refresh rotation …  (needs express, found unknown)
```

What each generator requires:

| Generator | Needs                |
| --------- | -------------------- |
| `auth`    | Express + TypeScript |
| `crud`    | Express + TypeScript |
| `socket`  | Express + TypeScript |
| `upload`  | Express + TypeScript |
| `logger`  | TypeScript           |
| `prisma`  | TypeScript           |
| `redis`   | TypeScript           |

## Preview before you write

`--dry-run` runs the entire pipeline — detection, prompts, plan building, conflict detection,
dependency resolution — and stops before the commit. It is the cheapest way to see what a generator
does:

```bash
atlas logger --cwd ../playground --dry-run --yes
```

```
ℹ Detecting project
✔ Detected express · TypeScript · ESM

⚠ Dry run — nothing will be written.
ℹ Would install 1 package with pnpm:
  • winston@^3.19.0

Would write 7 files
✔ created     …/src/logger/errors.ts
✔ created     …/src/logger/formats.ts
✔ created     …/src/logger/http-logger.ts
✔ created     …/src/logger/index.ts
✔ created     …/src/logger/logger-config.ts
✔ created     …/src/logger/logger.ts
✔ created     …/src/logger/redact.ts

Next steps
  • Import the logger with `import { logger } from "./logger/index.js"` …
  • Mount the request logger early in your middleware chain, before your routes.
  …

✔ Dry run complete. Nothing was written.
```

## The generators

Each writes into your source directory and prints its own next steps. Both spellings work —
`atlas auth` is a shortcut for `atlas add auth`.

```bash
atlas auth --hashing scrypt --database prisma
atlas crud Product
atlas logger
atlas prisma --provider sqlite
atlas redis
atlas socket
atlas upload
```

| Command         | Writes                                                | Then you                                                                                     |
| --------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `auth`          | 24 files under `src/auth/`                            | Set `JWT_SECRET` (32+ chars), mount the router, run the Prisma migration if you chose Prisma |
| `crud <entity>` | 4 files — model, schemas, service, controller, router | Mount the router, then replace the in-memory store with your database                        |
| `logger`        | 7 files under `src/logger/`                           | Mount the HTTP logger before your routes. `LOG_LEVEL` controls verbosity                     |
| `prisma`        | `prisma/schema.prisma` + a shared client              | Set `DATABASE_URL`, then `npx prisma migrate dev`                                            |
| `redis`         | 3 files — client, cache helpers, config               | Set `REDIS_URL` (defaults to `redis://127.0.0.1:6379`)                                       |
| `socket`        | 4 files — server, auth handshake, `/chat` namespace   | Attach it to your HTTP server. Uses `JWT_SECRET` and `SOCKET_CORS_ORIGIN`                    |
| `upload`        | 4 files — middleware, config, error mapping           | `UPLOAD_DIR` (default `uploads`), `UPLOAD_MAX_FILE_SIZE_BYTES` (default 5 MB)                |

Flags worth knowing:

- `--dir <path>` — every generator takes it. Writes somewhere other than the detected source directory.
- `auth --hashing argon2|scrypt` — `argon2` is stronger but compiles a native module; `scrypt` uses
  `node:crypto` and needs nothing installed.
- `auth --database mongoose|prisma` — the token store. Defaults to what your project already uses.
- `prisma --provider postgresql|mysql|sqlite` — `sqlite` is easiest for local testing; it needs no
  server and `DATABASE_URL` is just `file:./dev.db`.
- `crud <entity>` takes the entity name as an argument, and derives every casing from it. `atlas crud "user profile"`
  produces `UserProfile`, `userProfiles`, `user-profile.model.ts`, `USER_PROFILE`.

## Global flags

| Flag            | Effect                                                                       |
| --------------- | ---------------------------------------------------------------------------- |
| `--cwd <path>`  | Operate on another directory. Essential for testing without leaving the repo |
| `--dry-run`     | Full pipeline, no writes                                                     |
| `-y, --yes`     | Accept every prompt's default. Required for scripts and CI                   |
| `-v, --verbose` | Diagnostics and full stack traces                                            |
| `--no-color`    | Plain output. `NO_COLOR` in the environment does the same                    |

## Testing what matters: that generated code stands alone

The claim Atlas makes is that generated code has no dependency on Atlas. Everything above only proves
files appeared. This proves the claim:

```bash
cd ../playground

atlas logger
atlas crud Product

npm install                       # the generator declares deps; this installs them
npx tsc --noEmit                  # generated code compiles under your tsconfig

npm uninstall -D @suhel/atlas     # or: npm unlink @suhel/atlas
npx tsc --noEmit                  # still compiles — nothing imported Atlas
```

That last step is the whole point. If the second `tsc` fails, something leaked.

Worth testing under both module systems, because the import suffix differs:

```bash
atlas logger --cwd ../playground-esm   # imports end in .js
atlas logger --cwd ../playground-cjs   # imports have no extension
```

## Conflicts

Generate the same thing twice and Atlas will not overwrite silently. It asks, per file:

| Choice                 | What it does                                               |
| ---------------------- | ---------------------------------------------------------- |
| **Skip**               | Leaves your file alone                                     |
| **Backup and replace** | Writes `<file>.bak` and then the new version               |
| **Diff**               | Shows a coloured unified diff, then asks again             |
| **Overwrite**          | Replaces the file                                          |
| **Abort**              | Stops everything. Nothing already written this run is kept |

Under `--yes` or in a non-interactive shell there is nobody to ask, so Atlas chooses **backup and
replace** — the option that cannot lose work.

Abort really does mean nothing is kept. Writes are buffered and committed once, with an undo journal,
so a failure halfway through does not leave a half-generated module behind.

---

# Part 2 — After publishing

Nothing about the commands changes. Only how the binary arrives.

## Run it without installing

The recommended way, and what the README tells users:

```bash
npx @suhel/atlas auth
npx @suhel/atlas list
```

Always the latest published version, nothing left on the machine. `npx` caches, so if a fresh release
does not appear, pin it: `npx @suhel/atlas@0.2.0 auth`.

## Install it globally

```bash
npm install -g @suhel/atlas

atlas --version
atlas doctor
```

The binary is `atlas`; `atlas-cli` is installed as an alias for the same file.

## Pin it per project (recommended for teams)

```bash
npm install -D @suhel/atlas
npx atlas auth
```

This is the version worth preferring on a team. A code generator that changes between machines produces
_different files_ for the same command, and that difference lands in review as unexplained diff noise.
Pinning it in `devDependencies` makes the generator version a reviewable line in `package.json`.

Add a script if you like:

```json
"scripts": { "atlas": "atlas" }
```

```bash
npm run atlas -- crud Invoice
```

## Upgrading

```bash
npm view @suhel/atlas versions --json      # what exists
npm install -D @suhel/atlas@latest         # per project
npm update -g @suhel/atlas                 # global
```

Read `CHANGELOG.md` before upgrading across a minor. A new Atlas version can generate different files
for the same command; that is expected, and it is exactly why regenerating over existing files asks
before it writes.

## Removing it

```bash
npm uninstall -D @suhel/atlas
npm uninstall -g @suhel/atlas
```

Your generated code is unaffected. That is the design, and the check at the end of Part 1 is how you
verify it rather than trust it.

---

## Troubleshooting local testing

| Symptom                                           | Cause and fix                                                                                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ERR_MODULE_NOT_FOUND: ../dist/cli.js`            | Not built. `npm run build`                                                                                        |
| Your change has no effect                         | Stale `dist/`. Rebuild, or use `npx tsx src/cli.ts`                                                               |
| `atlas: command not found` after `npm link`       | Global npm bin not on PATH. Check `npm bin -g`, or use `node bin/atlas.js`                                        |
| `npm link` fails with `EPERM` on Windows          | Symlinks need Developer Mode or an elevated shell. Use `node bin/atlas.js`                                        |
| Every generator shows `⚠` in `atlas list`         | Run `atlas info`. Usually a missing `tsconfig.json` or Express not installed                                      |
| "needs express, found unknown"                    | `express` is not in the project's `package.json` dependencies                                                     |
| Generated imports have the wrong extension        | Module system mismatch. `atlas info` reports what was detected; `type` in `package.json` decides it               |
| Generated code does not compile                   | Dependencies not installed yet. Run `npm install` in the target project                                           |
| `atlas requires Node.js 22.13 or newer`           | The version guard in `bin/atlas.js`. Upgrade Node, or switch with nvm/fnm/volta                                   |
| Tarball install serves an old build               | npm cache. Re-install with `--no-cache`, or bump the version                                                      |
| Prisma errors about `url` in the datasource block | Prisma 7 moved connection URLs out of the schema. Atlas templates pin Prisma 6.19.x — check the installed version |

For anything reported as `ATLAS_nnnn`, [troubleshooting.md](./troubleshooting.md) lists every code with
its cause and fix.

---

## See also

- [publishing.md](./publishing.md) — getting this onto GitHub and npm
- [generator-contract.md](./generator-contract.md) — what a generator is allowed to do
- [template-authoring.md](./template-authoring.md) — writing your own template
- [plugin-development.md](./plugin-development.md) — shipping a third-party generator
