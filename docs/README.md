# Atlas Documentation

Atlas is a code **generator**, not a runtime library. It writes real TypeScript source files into your
project and then gets out of the way. Nothing it generates imports Atlas, so uninstalling Atlas changes
nothing about how your application behaves.

## Start here

| Document                                         | What it covers                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| [roadmap.md](./roadmap.md)                       | **v1.0 plan** — the wizard, auto-wiring, and what ships next            |
| [usage.md](./usage.md)                           | Running Atlas — locally from this repository, and after it is published |
| [publishing.md](./publishing.md)                 | Connecting GitHub, and releasing to npm                                 |
| [project-plan.md](./project-plan.md)             | The completed 4-phase build plan that produced today's seven generators |
| [architecture.md](./architecture.md)             | Repository layout and why every folder exists                           |
| [generator-contract.md](./generator-contract.md) | The `Generator` interface, the plan it returns, and the rules it obeys  |
| [template-authoring.md](./template-authoring.md) | Writing a template: the manifest, the `__TOKEN__` vocabulary, the gate  |
| [plugin-development.md](./plugin-development.md) | Building and shipping an `atlas-plugin-*` package                       |
| [troubleshooting.md](./troubleshooting.md)       | Every `ATLAS_nnnn` error code, what causes it, how to fix it            |
| [adr/](./adr/)                                   | Architecture Decision Records — the _why_ behind irreversible choices   |

## Not written yet

Absent rather than stubbed, so nothing here describes behaviour that does not exist.

| Document           | What it will cover                                |
| ------------------ | ------------------------------------------------- |
| `configuration.md` | `atlas.config.ts` and the option precedence chain |
| `commands/`        | Per-generator reference pages, one per generator  |

Until `commands/` exists, `atlas <generator> --help` and the "Next steps" each generator prints are the
reference.

## Current status

All four phases are complete, and seven generators ship: `auth`, `crud`, `logger`, `prisma`, `redis`,
`socket`, and `upload`. Each one generates into a real project, and the generated output is checked by
compiling it against real packages under `strict` — not by asserting on strings.

The engine underneath is what the phases were mostly spent on: one cached filesystem pass to an
immutable `ProjectContext`, plan-then-apply generation so `--dry-run` is free and conflicts are a
pre-flight question, an atomic commit with a proven rollback journal, dependency reconciliation, and
formatting that uses the _target_ project's Prettier config rather than Atlas's.

Nothing is published to npm yet. See [publishing.md](./publishing.md) for what that takes, and
[usage.md](./usage.md) for testing it locally in the meantime.
