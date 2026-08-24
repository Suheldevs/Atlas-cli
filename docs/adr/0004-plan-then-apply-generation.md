# 0004 — Plan-then-apply generation

**Status:** Accepted

**Date:** 2026-07-27

## Context

The naive design for a generator writes files as it walks templates. It is the obvious implementation and it
fails in three specific ways:

- **`--dry-run` cannot be added honestly.** Either you duplicate the walk in a no-write mode, and the two
  paths diverge, or you print an approximation of what would happen. Both are lies with different half-lives.
- **Conflict prompts interrupt mid-write.** The user is asked "overwrite `src/app.ts`?" after four files
  have already landed. Answering _abort_ at that point leaves the project in a state nobody chose.
- **Partial output survives failure.** A dependency install that fails after files are written leaves orphan
  files behind. A half-generated project is worse than no generation, because the user must now work out
  which files are theirs.

All three share a root cause: the decision about what to do is entangled with the act of doing it.

## Decision

Split generation into an immutable plan and a separate atomic apply.

Generators return a `GenerationPlan` — file operations, dependencies, scripts, hooks — and never touch disk.
The engine then validates the plan as a whole, resolves every conflict up front, and commits through the VFS
in `engine/vfs/`, which journals each applied operation so any failure rolls back completely.

`--dry-run` is the same code path with the commit omitted, which is what makes it trustworthy. Plan
construction lives in each generator's pure `<name>.plan.ts`, testable with zero mocks.

## Alternatives considered

| Alternative                                               | Why rejected                                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Write-as-you-go                                           | Cannot be atomic and cannot dry-run honestly. Every failure mode above is structural, not a matter of care.                                                                                                                                                      |
| Write to a temp directory, then move                      | Better, but still cannot ask conflict questions before doing the work — the user is interrupted after generation, and a _skip_ answer means work was wasted. Cross-device moves are not atomic, and on Windows a locked destination file fails the move mid-way. |
| Transactional filesystem wrapper, no explicit plan object | Gets atomicity but loses the two things the plan is actually for: showing the user what will happen before it happens, and testing planning logic in isolation from I/O. Correctness without inspectability.                                                     |
| Two-pass walk — collect, then write                       | Effectively the plan without the type. The plan object is what makes the intermediate state validatable, printable, snapshot-testable, and passable to hooks.                                                                                                    |

## Consequences

**Good**

- `--dry-run` is exact, because it is the real path minus the commit.
- Every conflict is answered before anything is written; the user commits once, with full information.
- Any failure — install, formatter, permissions, Ctrl-C — rolls back to the pre-run state.
- Plan logic is pure, so the most bug-prone part of a generator is unit-tested with no filesystem.
- Plans are data, so they can be snapshotted, diffed in review, and inspected by `atlas info`.

**Accepted costs**

- More machinery than writing files directly: a plan type, a builder, a validator, a VFS, and a journal.
- Whole-file contents are buffered in memory before commit, which bounds the practical size of a single
  generation. Acceptable for source files; it would not be for binary assets.
- Generator authors must express intent as a plan rather than imperatively, which is a real learning cost
  and the reason `<name>.plan.ts` is a separate file with its own examples.
- Rollback is best-effort against the world outside the VFS: a `node_modules` tree that a package manager
  already mutated is not something Atlas can undo. It restores the files it owns.
