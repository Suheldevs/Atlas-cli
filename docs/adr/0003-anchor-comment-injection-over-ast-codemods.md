# 0003 — Anchor-comment injection over AST codemods

**Status:** Accepted

**Date:** 2026-07-27

## Context

Templates can create `src/modules/auth/**` perfectly. What they cannot do is teach an existing `src/app.ts`
to mount the new router. That last mile — wiring generated code into files the user already owns — is
exactly where code generation tools break, and it is the part users judge them on.

The difficulty is that `src/app.ts` is not a file Atlas authored. It might use `app.use()`, or a router
composition helper, or a factory function; it might be 12 lines or 300; the import block might be sorted by
a plugin. Any automated edit has to be right about all of that, and being wrong means corrupting a file the
user cares about more than anything Atlas generated.

## Decision

Generated modules are self-contained: everything a feature needs lives inside its own directory, so the
external surface area is one import and one registration line.

For that remainder, `engine/inject/anchor-injector` inserts at marker comments when they are present.
Marker strings are pinned in `src/constants/markers.ts` because they end up permanently in users' files and
must never drift.

When no marker exists, Atlas does not guess. It prints the exact lines to paste and the file to paste them
into, then exits successfully. A precise instruction is strictly better than a heuristic edit that is
usually right.

## Alternatives considered

| Alternative                                 | Why rejected                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ts-morph` AST codemods                     | Adds roughly 10 MB to the install; reformats untouched code as a side effect of printing; and fails unpredictably on unconventional file structures — where "unpredictably" means a mangled `app.ts`. Deliberately kept possible later as an opt-in plugin, which requires no engine changes: the injector is already an isolated module behind a stable interface. |
| Regex-based source patching                 | Silently corrupts files. A pattern that matches inside a string literal, a comment, or a similarly-shaped nested block produces broken code with no error. Unacceptable at any level of care.                                                                                                                                                                       |
| Print instructions only, no injector        | Worse UX than an injector that works when the marker is there. Users who scaffolded with Atlas already have the markers, so the common path can be automatic; there is no reason to give that up.                                                                                                                                                                   |
| Own the entry file and rewrite it wholesale | Only works if Atlas generated it, which is false for the main use case — adding a feature to an existing project.                                                                                                                                                                                                                                                   |

## Consequences

**Good**

- Atlas never mangles a file it did not author. The worst outcome is a message asking for two lines of
  manual work.
- No heavy AST dependency, so the install stays small and cold start stays fast.
- Wiring is reviewable: the user sees the exact lines, in their own file, in a diff they understand.
- Injection is one small, heavily tested module rather than a capability spread across generators.
- The AST path stays open as a plugin, so this decision is not a ceiling.

**Accepted costs**

- Two or three lines of manual wiring on first use per module, in projects Atlas did not scaffold.
- Marker comments are visible in users' source files, which some will find untidy.
- Marker strings are effectively permanent public API — changing one orphans every project that already has
  it.
- Complex wiring (conditional middleware ordering, dependency-injected registration) still needs a human.
  Atlas describes it; it does not perform it.
