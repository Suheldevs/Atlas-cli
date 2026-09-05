# Templates

A template is the source Atlas writes into somebody's project. It is not a runtime: once a
template has been generated, the project it landed in has no dependency on Atlas, and nothing
generated may import from `@mohdsuhel/atlas` — ever. Whatever is here is what a user reads, reviews
and maintains, so it is held to the standard of code a senior engineer wrote by hand.

## Directory contract

Each template is one directory under `templates/`:

```
templates/
  logger/
    template.json      # metadata, and the only place dependencies are declared
    files/             # the real source, mirrored into the project
      logger/
        index.ts
        logger.ts
        ...
  @types/              # not a template: CI-only type shims, never shipped
    ambient.d.ts
```

`template.json` matches `TemplateManifest` in `src/types/template-manifest.ts`. An empty `files`
array means the loader mirrors `files/` recursively, which is the normal case — adding a file to a
template should not also mean remembering to register it. A non-empty array is an explicit list of
`{ source, destination, format }` entries, for when a destination differs from the source path.

Destinations are relative to the project's source directory (`src/` in most projects, the root in
a flat one), so `files/logger/index.ts` becomes `src/logger/index.ts`.

Dependencies are declared in `template.json` and nowhere else. No generator hardcodes a package
name or a version: bumping one stays a data change, and the dependency surface of a template is
auditable in a single file.

## Templates are real TypeScript

A template file is a genuine `.ts` file. Open it in an editor and syntax highlighting, go-to-
definition and the compiler all work — before substitution, not just after. That is possible
because every placeholder is a token shaped like a valid TypeScript identifier, so
`class __ENTITY_NAME__Service` parses.

There is no template engine, and adding one is a deliberate non-goal. Substitution is plain string
replacement over a closed vocabulary, which is what makes `scripts/validate-templates.ts` able to
say that a token is misspelled.

## Token vocabulary

Defined in `src/constants/tokens.ts`. Anything outside this table fails validation.

| Token                        | Replaced with                                             |
| ---------------------------- | --------------------------------------------------------- |
| `__PROJECT_NAME__`           | `name` from the project's `package.json`, or its directory |
| `__SOURCE_DIR__`             | Detected source directory, usually `src`                  |
| `__IMPORT_SUFFIX__`          | `.js` under ESM, empty under CommonJS                     |
| `__MODULE_SYSTEM__`          | `esm` or `cjs`                                            |
| `__PACKAGE_MANAGER__`        | `npm`, `pnpm`, `yarn` or `bun`                             |
| `__DATABASE__`               | `mongoose`, `prisma`, `typeorm`, `drizzle` or `none`       |
| `__FRAMEWORK__`              | `express`, `nest`, `fastify`, `next`, `react`, `unknown`   |
| `__ENTITY_NAME__`            | PascalCase entity, e.g. `UserProfile`                      |
| `__ENTITY_CAMEL__`           | `userProfile`                                             |
| `__ENTITY_KEBAB__`           | `user-profile`                                            |
| `__ENTITY_SNAKE__`           | `user_profile`                                            |
| `__ENTITY_CONSTANT__`        | `USER_PROFILE`                                            |
| `__ENTITY_TITLE__`           | `User Profile`                                            |
| `__ENTITY_PLURAL__`          | `UserProfiles`                                            |
| `__ENTITY_PLURAL_CAMEL__`    | `userProfiles`                                            |
| `__ENTITY_PLURAL_KEBAB__`    | `user-profiles`                                           |
| `__ENTITY_PLURAL_CONSTANT__` | `USER_PROFILES`                                           |
| `__JWT_SECRET__`             | A freshly generated secret, never a literal default       |

Tokens work in file contents and in `destination` paths, so a template can name a file after the
entity it generates.

`__IMPORT_SUFFIX__` goes on the end of **every** relative import specifier:

```ts
import { buildLogFormat } from './formats__IMPORT_SUFFIX__';
```

An ESM project needs `./formats.js` and a CommonJS project needs `./formats`. Getting this wrong
means nothing compiles, which is why the suffix is detected rather than assumed.

## Why templates are excluded from tsc, ESLint and Prettier

`templates` is in the repository's `tsconfig.json` `exclude`, `eslint.config.js` `ignores` and
`.prettierignore`. All three are deliberate:

- **tsc** — templates import `winston` and `express`, which are dependencies of the *user's*
  project. Atlas does not install them, so compiling templates in the main project would fail by
  design.
- **ESLint** — the type-aware rules need a program, and the program above does not exist. The
  repo's own rules are also wrong here: `no-console` is about Atlas's output discipline, and has
  nothing to say about code that ships to someone else.
- **Prettier** — generated code is formatted with the *target* project's Prettier config, not
  this one. Formatting it here would produce a diff on the way in and another on the way out.

Nothing checks templates by accident, then. That is what makes the gate below load-bearing rather
than decorative — and it is why template files are formatted by hand to match the repo's style:
100 columns, single quotes, semicolons, trailing commas, two-space indent.

## Running the gate

```bash
npx tsx scripts/validate-templates.ts
```

It discovers every directory holding a `template.json`, validates the manifest against the schema
independently of the loader, fails on any token outside the vocabulary, checks that every file a
non-empty `files` array names exists, and then compiles everything:

```bash
npx tsx scripts/check-generated-output.ts
```

That compile succeeds **with tokens still in place**, which is the point of the whole arrangement.
Relative specifiers ending in `__IMPORT_SUFFIX__` cannot resolve on disk, so `templates/@types/
ambient.d.ts` maps them onto the real files through pattern ambient modules, and stubs the small
slice of `winston` and `express` the templates actually use. Those shims are CI-only and are never
shipped; read the header of that file before touching them, because widening one to `any` silently
turns the gate off.

`scripts/copy-templates.ts` stages this directory into a build output verbatim. Templates are
assets: never bundled, never transpiled, never reformatted.

## Adding a template

1. Create `templates/<name>/template.json` and `templates/<name>/files/`.
2. Write real code. No TODOs, no stubs, no placeholder logic — a template that has to be finished
   by hand after generation is worse than no template.
3. Suffix every relative import with `__IMPORT_SUFFIX__`.
4. Add a pattern ambient module in `templates/@types/ambient.d.ts` for each internal module the
   template imports, and declare any new third-party surface honestly.
5. Run the gate.

## Current templates

| Template | Generates                                                                   |
| -------- | --------------------------------------------------------------------------- |
| `logger` | Winston logging: config, formats, redaction, error serialisation, HTTP middleware |

`logger/files/logger/http-logger.ts` is the one file that needs Express; a project that is not an
Express application uses the rest and never imports it.
