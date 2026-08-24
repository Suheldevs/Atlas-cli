# Atlas — Template Authoring

A template is a directory of real TypeScript files plus a manifest describing them. The loader reads the
manifest, substitutes the `__TOKEN__` vocabulary with values derived from the target project, and returns
rendered files a generator turns into a plan. Nothing in a template is an abstraction: there is no Atlas
runtime to import and no base class to extend, so every file has to be a complete, handwritten-quality
implementation of the thing it claims to be.

The normative sources are [src/types/template-manifest.ts](../src/types/template-manifest.ts) for the shapes,
[src/engine/template/](../src/engine/template/) for the loader, the manifest parser, and the token replacer,
and [src/constants/tokens.ts](../src/constants/tokens.ts) for the vocabulary. This document explains what each
part is for and what it must not do; where the two disagree, the code wins.

## The directory contract

Every template is a directory under [templates/](../templates/) with exactly two things in it:

```
templates/<name>/
├── template.json      the manifest
└── files/             the payload
```

`<name>` is how a generator asks for the template, and it must match the manifest's `name`. Both parts are
required: a template with no `files/` directory fails at render with
[ATLAS_4001](troubleshooting.md#atlas_4001), and one with no manifest fails at load with the same code.

**A path under `files/` is the destination.** When the manifest lists no files, the loader walks `files/`
recursively and each file's path _relative to `files/`_ becomes its destination relative to the project root
— with tokens replaced. So a file that belongs at `src/logging/logger.ts` lives at

```
templates/logger/files/__SOURCE_DIR__/logging/logger.ts
```

and not at `files/src/logging/logger.ts`. `__SOURCE_DIR__` is a real directory name on disk, which works
because tokens are legal in filenames as well as in file contents, and it is the only correct spelling: not
every project has a `src`, and a template that hardcodes one writes into a directory the project does not
use.

Templates live at the repository root rather than under `src/` because they are assets, not compiled code.
They import `express` and `winston`, which Atlas does not depend on, so the main `tsc` build excludes them and
a second configuration typechecks them separately. The full reasoning is in
[adr/0001](adr/0001-templates-live-at-the-repository-root.md).

## `template.json`

| Field             | Type                              | Required | Notes                                                                  |
| ----------------- | --------------------------------- | -------- | ---------------------------------------------------------------------- |
| `name`            | `string`                          | yes      | Non-empty, and matches the directory name                              |
| `version`         | `string`                          | yes      | The template's own version, independent of Atlas's                     |
| `description`     | `string`                          | yes      | One line                                                               |
| `dependencies`    | `Record<string, string>`          | no       | Runtime packages, name to range. Installed into the target project     |
| `devDependencies` | `Record<string, string>`          | no       | The same, for `devDependencies`                                        |
| `scripts`         | `Record<string, string>`          | no       | `package.json` scripts to add                                          |
| `files`           | `(string \| TemplateFileEntry)[]` | no       | Explicit file list. **Empty or absent means mirror `files/`**          |
| `requires`        | `TemplateRequirements`            | no       | Conditions the project must meet, checked before anything is generated |

Only `name`, `version`, and `description` are required. Everything else defaults to empty, which is why the
normal template has a three-line manifest.

**Unknown keys are rejected, not ignored** — at the top level, inside `requires`, and inside a file entry. A
misspelled `devDependencies` would otherwise parse cleanly and ship a template whose dependencies are never
installed, and the symptom would surface much later as a broken build in someone else's project. Every problem
in a manifest is collected and reported together, because fixing one error per run is a miserable loop.

`requires` has three members of its own:

| Field          | Type                     | Notes                                                              |
| -------------- | ------------------------ | ------------------------------------------------------------------ |
| `frameworks`   | `Framework[]`            | **Empty means framework-agnostic**, not "supports nothing"         |
| `language`     | `Language \| undefined`  | `typescript` or `javascript`. Omit when either will do             |
| `dependencies` | `Record<string, string>` | Packages that must _already_ be present, keyed to the range needed |

The distinction between `dependencies` and `requires.dependencies` is worth getting right. `dependencies` are
packages Atlas will install; `requires.dependencies` are packages whose absence means the template does not
apply at all. A template that writes Prisma models declares `@prisma/client` under `requires` — installing
Prisma for somebody who never asked for it is not a decision a code generator gets to make. The requirement
check tests **presence**, in `dependencies`, `devDependencies`, or `peerDependencies`; the range is
documentation for the reader rather than a constraint Atlas enforces.

Minimal, and the common case:

```json
{
  "name": "health",
  "version": "1.0.0",
  "description": "A health-check endpoint."
}
```

Fully populated, showing every field:

```json
{
  "name": "logger",
  "version": "1.0.0",
  "description": "A configured Winston logger with request-scoped child loggers.",
  "dependencies": {
    "winston": "^3.17.0"
  },
  "devDependencies": {
    "@types/triple-beam": "^1.3.5"
  },
  "scripts": {
    "logs:tail": "tail -f logs/app.log"
  },
  "files": [
    "__SOURCE_DIR__/logging/logger.ts",
    {
      "source": "logger.env",
      "destination": ".env.logging",
      "format": false
    },
    {
      "source": "service.ts",
      "destination": "__SOURCE_DIR__/__ENTITY_KEBAB__/__ENTITY_KEBAB__.service.ts"
    }
  ],
  "requires": {
    "frameworks": ["express"],
    "language": "typescript",
    "dependencies": {
      "express": ">=5.0.0"
    }
  }
}
```

A `files` entry is either a **path string** — shorthand for "destination mirrors source, formatted" — or an
object:

| Key           | Required | Default  | Notes                                                           |
| ------------- | -------- | -------- | --------------------------------------------------------------- |
| `source`      | yes      | —        | Path relative to `files/`. Never token-replaced                 |
| `destination` | no       | `source` | Path relative to the project root. **Is** token-replaced        |
| `format`      | no       | `true`   | `false` for files the target project's formatter must not touch |

## When to list files explicitly

An empty `files` array means the loader mirrors `files/` recursively, sorted, and that is the default for a
reason: a template whose files are registered by hand grows a second place to remember, and the failure mode
is a file that exists in the repository, passes review, ships in the tarball, and never gets written. Adding a
file to `files/` should be the whole change.

There are exactly three reasons to write entries out:

- **The destination differs from the source layout.** A file that lives at `files/logger.env` but belongs at
  `.env.logging` cannot be expressed by mirroring, because mirroring means the two are the same path.
- **One source becomes several destinations.** Mirroring visits each file once. A manifest can list the same
  `source` twice with different tokenised destinations.
- **`format: false`.** For `.env` files, lockfiles, and anything with no parser. Mirrored entries are always
  formatted.

Note that a **tokenised filename** is not on that list. Because mirrored destinations are token-replaced too,
`files/__SOURCE_DIR__/__ENTITY_KEBAB__/__ENTITY_KEBAB__.service.ts` works with no manifest entry at all.
Write entries when the mapping is genuinely not one-to-one.

## The token vocabulary

Values come from the immutable `ProjectContext` produced by [src/detection/](../src/detection/) and from the
entity name the user typed. The examples below are what `atlas crud UserProfile` produces in an ESM Express
project managed by pnpm.

[src/constants/tokens.ts](../src/constants/tokens.ts) is the authoritative list. It is a module of named
constants rather than string literals scattered through the engine, which is what lets
[scripts/validate-templates.ts](../scripts/validate-templates.ts) enumerate every token and fail CI on a
misspelled `__ENTITIY_NAME__`.

| Token                        | Source                              | Example         |
| ---------------------------- | ----------------------------------- | --------------- |
| `__PROJECT_NAME__`           | Target `package.json#name`          | `billing-api`   |
| `__SOURCE_DIR__`             | Detected source layout              | `src`           |
| `__IMPORT_SUFFIX__`          | Detected module system              | `.js`           |
| `__MODULE_SYSTEM__`          | Detected module system              | `esm`           |
| `__PACKAGE_MANAGER__`        | Detected from the lockfile          | `pnpm`          |
| `__DATABASE__`               | Detected data layer                 | `prisma`        |
| `__FRAMEWORK__`              | Detected framework                  | `express`       |
| `__ENTITY_NAME__`            | The entity name, PascalCase         | `UserProfile`   |
| `__ENTITY_CAMEL__`           | camelCase                           | `userProfile`   |
| `__ENTITY_KEBAB__`           | kebab-case                          | `user-profile`  |
| `__ENTITY_SNAKE__`           | snake_case                          | `user_profile`  |
| `__ENTITY_CONSTANT__`        | SCREAMING_SNAKE_CASE                | `USER_PROFILE`  |
| `__ENTITY_TITLE__`           | Words, capitalised                  | `User Profile`  |
| `__ENTITY_PLURAL__`          | Pluralised, PascalCase              | `UserProfiles`  |
| `__ENTITY_PLURAL_CAMEL__`    | Pluralised, camelCase               | `userProfiles`  |
| `__ENTITY_PLURAL_KEBAB__`    | Pluralised, kebab-case              | `user-profiles` |
| `__ENTITY_PLURAL_CONSTANT__` | Pluralised, SCREAMING_SNAKE_CASE    | `USER_PROFILES` |
| `__JWT_SECRET__`             | 48 random bytes, base64url, per run | `b7f1…c204`     |

Four behaviours of the substitution are worth knowing before you write a template.

**Substitution is strict.** A token in a file that has no value fails the whole run rather than being left in
place or blanked. An unresolved `__ENTITY_NAM__` welded into somebody's source file is a bug that compiles,
which makes it the expensive kind; a failed generation costs nothing, because plan-then-apply means nothing
has been written yet.

**Entity tokens are absent, not empty, when there is no entity.** A template invoked without an entity name
has no `__ENTITY_*__` values at all, so using one is a strict failure by the same route. There is no
accidental `class Service` with the name silently removed.

**Destination paths are not strict.** A path is not the place to discover a typo, and the file's contents are
checked in the same render anyway.

**Replacement is single-pass and never rescans.** A value that happens to contain `__` — a generated secret,
an env value — is emitted verbatim rather than substituted again. Every token in the input is replaced exactly
once, and no output depends on the order the tokens were declared in.

`__PROJECT_NAME__` falls back to the project directory's name when `package.json` has no `name`.

Entity names are validated before anything is derived: a name that cannot become a TypeScript identifier, or
that is a reserved word, is refused as a usage error. Pluralisation goes through
[src/utils/casing.ts](../src/utils/casing.ts) rather than through `+ 's'`, so `Category` becomes `Categories`
and `Person` becomes `People`. `Categorys`, `Persons`, and `Datas` are the number-one giveaway of amateur
codegen: they appear in identifiers the user has to live with, so they are the first thing noticed and the
last thing forgiven.

## Why the tokens look like that

`__ENTITY_NAME__` is a valid TypeScript identifier. That is the entire design.

Because it is, `class __ENTITY_NAME__Service implements __ENTITY_NAME__Repository` parses, resolves, and
typechecks as ordinary code — _before_ substitution. A template is therefore a real `.ts` file with real
editor support: syntax highlighting, type errors under the cursor, go-to-definition, rename. CI can prove
every template compiles without generating anything.

Handlebars, EJS, and Mustache all fail that test. `class {{entityName}}Service` is not TypeScript, so the
file cannot be parsed, cannot be typechecked, and cannot be refactored; the editor sees text. Template code
without tooling rots, silently, in files that ship straight into users' projects — and the visible symptom is
generated output that _looks_ generated, which is the specific failure Atlas exists to avoid. The full
argument, including the alternatives considered, is in
[adr/0001](adr/0001-templates-live-at-the-repository-root.md).

The cost of the choice is that tokens are shouty and there is no conditional logic, no loops, and no
expressions. Both are accepted deliberately. The vocabulary is a closed set of names rather than a language,
which is what makes "is this token real?" a question CI can answer. A template that wants a branch is a
template that needs testing separately from the code it generates — and at that point the branch belongs in
the generator, which is ordinary tested TypeScript.

## `__IMPORT_SUFFIX__` on every relative import

Every relative import in a template ends with `__IMPORT_SUFFIX__`:

```ts
import { logger } from './logger__IMPORT_SUFFIX__';
import type { __ENTITY_NAME__ } from './__ENTITY_KEBAB__.types__IMPORT_SUFFIX__';
```

The token resolves to `.js` under ESM, where TypeScript requires the emitted extension on relative
specifiers, and to nothing under CommonJS, where writing it is wrong. There is no value that works for both
and no graceful degradation between them: get it wrong and the generated project does not compile at all, for
every file, immediately.

Bare package specifiers never take the suffix — `import express from 'express'` is the same in both module
systems. Only relative paths.

This is why module-system detection exists rather than an assumption or a flag, and why `__IMPORT_SUFFIX__` is
the token most worth checking in review.

## `__JWT_SECRET__`

Generated fresh from `randomBytes(48)` on every run. It must never be given a fixed default — not in the
manifest, not in a template, not in an `.env` file, not in an example. A shipped default secret is a shipped
authentication bypass, and defaults get deployed; the point of generating it is that the value a forgetful
user leaves in place is already safe. Anything a template writes it into should be marked `secret: true` in
the plan, which is what puts it in `.env.example` as a value to replace.

## Dependencies belong in the manifest

`template.json` is the only place a package name or version range appears. Not in a generator, not inlined in
a template, not in a script.

That constraint buys three things. "What will this install?" becomes a data question answerable by reading one
file per template. Bumping a range is a data change rather than a code change, which means a Dependabot diff a
reviewer can read. And the dependency planner can compute the union of what every template in a run wants,
subtract what the project already has, and reconcile the remainder against existing ranges — none of which is
possible if part of the answer is buried in control flow.

## Rules for generated code

These are not style preferences. Every one of them is a thing that has made generated output unusable in some
other tool.

- **Complete implementations.** No `TODO`, no `throw new Error('not implemented')`, no commented-out
  alternative. A generated file is judged as handwritten code, because that is what it becomes the moment it
  lands.
- **Never import Atlas.** Not the package, not a type from it, not a helper. The one constraint the whole
  project is built around is that deleting Atlas changes nothing about the generated application. A single
  `import type { … } from '@suhel/atlas'` breaks it.
- **`strict`-clean, including `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.** Assume the
  strictest reasonable configuration, because the projects most likely to adopt a code generator already have
  it. `noUncheckedIndexedAccess` in particular makes every array index and every record lookup
  `T | undefined`, needing narrowing — the most common reason a template that compiles in a lax project fails
  in a strict one.
- **Production-safe defaults.** Secure by default, not convenient by default: no permissive CORS, no disabled
  TLS verification, no credentials in logs, no `any` at a trust boundary. A default that is only safe in
  development is a default that reaches production.
- **No dead configuration.** Every option a generated file exposes has to do something. Configuration nobody
  reads is the residue of a template that was copied rather than written.
- **Errors are typed and handled.** A generated route that swallows an exception, or lets one escape as a 500
  with a stack trace, is not production quality however well it reads.

## The ambient shims in `templates/@types/`

Templates import packages Atlas does not depend on, and Atlas has no reason to install `express`, `winston`,
or `jsonwebtoken` just so its own CI can read them. `templates/@types/` holds hand-written ambient module
declarations that give those imports a shape, so `tsc -p tsconfig.templates.json` resolves them and
typechecks the template against them.

They assert **shape, not correctness**. A shim declares that `express` exports a `Router` returning something
with `get` and `post`; it does not encode Express's real types. That is a real limitation and the accepted
cost of not installing every package every template touches.

It is also the thing most easily defeated. Widening a declaration to `any` to make an error go away turns the
gate off for every template that touches that package, permanently and invisibly — the CI job stays green
while checking nothing, which is worse than a red one. When a shim is wrong, fix the shim to match the real
package. When a template is wrong, fix the template. If neither is wrong and the shim genuinely cannot express
the type, say so in a comment beside the widening so the next person knows it was a decision rather than an
oversight.

Adding a new import to a template means adding a shim for it in the same pull request. Without one the
templates typecheck fails, which is the intended behaviour.

## Validating locally

Templates are excluded from [tsconfig.json](../tsconfig.json), from ESLint, and from Prettier, all three
deliberately: they reference packages this repository does not install, and formatting them with Atlas's own
Prettier config would be wrong, since generated code is formatted with the _target_ project's config. So
`npm run verify` does not cover them. They get their own gate:

```
npx tsx scripts/check-generated-output.ts
npx tsx scripts/validate-templates.ts
```

The first proves every template parses and typechecks against the shims. The second checks manifests against
the schema and cross-checks every `__TOKEN__` in every template against
[src/constants/tokens.ts](../src/constants/tokens.ts). Both run in CI on every pull request; running them
locally is faster than finding out from a red check.

Then generate for real. CI runs `tsc` and ESLint over the output of a real generation into a scratch project,
and that is the only check that reflects what a user gets — everything upstream of it is an assertion about
intent.

## Worked example: adding a template

A small template end to end, from nothing to validated.

**1. Create the directory.** The destination path is the path under `files/`, so the source directory token is
part of it.

```
templates/health/
├── template.json
└── files/
    └── __SOURCE_DIR__/
        └── routes/
            └── health.route.ts
```

**2. Write the manifest.** Nothing to install and nothing to rename, so it stays minimal — but it declares
that the project must already have Express, because the file it writes imports `Router`.

```json
{
  "name": "health",
  "version": "1.0.0",
  "description": "A health-check endpoint reporting process uptime.",
  "requires": {
    "frameworks": ["express"],
    "language": "typescript",
    "dependencies": {
      "express": ">=5.0.0"
    }
  }
}
```

There is no `files` array, so the loader mirrors `files/` and the one file lands at
`<sourceDir>/routes/health.route.ts`.

**3. Write the file.** Real TypeScript, complete, with the suffix token on the relative import.

```ts
import { Router } from 'express';

import { HEALTH_STARTED_AT } from './health.constants__IMPORT_SUFFIX__';

export const healthRouter = Router();

healthRouter.get('/healthz', (_request, response) => {
  response.status(200).json({
    status: 'ok',
    uptimeSeconds: Math.round((Date.now() - HEALTH_STARTED_AT) / 1000),
  });
});
```

**4. Add a shim if the import is new.** `express` already has one under `templates/@types/`. If it did not,
this is the pull request that adds it.

**5. Validate.**

```
npx tsx scripts/check-generated-output.ts
npx tsx scripts/validate-templates.ts
```

**6. Wire it to a generator.** A template is inert on its own — something has to ask for it. A generator
receives a `TemplateRenderer` on its context and uses the two methods on it:

```ts
const template = await context.templates.load('health');
const rendered = await context.templates.render(template, tokens);

for (const file of rendered) {
  builder.addFile(file.destination, file.contents, { format: file.format });
}
```

The token table comes from `buildTokenTable`, which derives every casing from the one name the user typed, so
the variants can never disagree with each other. That side of the contract is
[generator-contract.md](generator-contract.md).

**7. Commit the snapshot.** Once a generator uses the template, its rendered output belongs in
`tests/snapshots/`. That is what turns the next edit to this template into a reviewable diff, and it is the
only mechanism that reliably catches an edit that also changed nine other generated files.
