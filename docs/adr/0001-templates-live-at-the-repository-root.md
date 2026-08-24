# 0001 — Templates live at the repository root

**Status:** Accepted

**Date:** 2026-07-27

## Context

Atlas's templates must be **valid TypeScript before generation**, not only after it. Template authors spend
most of their time inside these files, and they need what they would get in any other `.ts` file: syntax
highlighting, type errors, go-to-definition, and refactoring. A template that only becomes valid code after
substitution cannot offer any of that, and code without tooling rots — silently, and in files that ship
directly into users' projects.

The token vocabulary is designed around this constraint. Placeholders like `__ENTITY_NAME__` are chosen
precisely because they are valid TypeScript identifiers, so `class __ENTITY_NAME__Service` parses, resolves,
and typechecks as ordinary code.

The complication is dependencies. Templates import `express`, `jsonwebtoken`, `argon2` — packages Atlas
itself does not depend on and has no reason to install. If templates lived under `src/`, the project's own
`tsc` build and `tsup` bundle would attempt to compile them and fail on unresolved imports.

## Decision

Templates live in a root-level `templates/` directory, excluded from `tsconfig.json` and from the bundle.
They are shipped verbatim through `package.json#files` and copied into the published layout by
`scripts/copy-templates.ts`.

They are still typechecked, just not by the main build: a separate `tsconfig.templates.json` compiles them
against ambient module shims in `templates/@types/`, and `scripts/validate-templates.ts` runs that
typecheck in CI along with a cross-check of every `__TOKEN__` against `src/constants/tokens.ts`.

## Alternatives considered

| Alternative                               | Why rejected                                                                                                                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `.ts.tpl` extension                     | Kills editor tooling entirely — no highlighting, no typechecking, no refactoring. This is exactly the arrangement that makes template code rot, and it is common in tools whose generated output is visibly poor.      |
| Under `src/` with per-file `tsc` excludes | Fragile: every new template needs a config edit, and forgetting one breaks the build. It also puts templates inside `rootDir`, so `dist/` output paths need rewriting to keep the shipped layout stable.               |
| Handlebars / EJS / Mustache               | The templates stop being real code. They cannot be typechecked at all, authoring loses every editor affordance, and generated output starts _looking_ generated — which is the specific failure Atlas exists to avoid. |

## Consequences

**Good**

- Templates are ordinary TypeScript files with full editor support, and CI proves they parse and typecheck.
- The main build never sees them, so Atlas's own dependency list stays honest — `express` is not a
  dependency of a tool that does not import it.
- Shipping is a verbatim copy, so what a user receives is byte-identical to what a reviewer read.
- A misspelled token fails CI rather than appearing literally in someone's generated file.

**Accepted costs**

- Two TypeScript configurations to keep in sync, and a second typecheck step in CI.
- `templates/@types/` shims are hand-maintained and can drift from the real packages' types; they assert
  shape, not correctness.
- An explicit copy step in the build, which means "the templates shipped" is a thing that can be forgotten
  and therefore has to be tested.
- Editors need `tsconfig.templates.json` selected to resolve template imports correctly.
