# Atlas — Generator Contract

Every feature Atlas can generate is a `Generator`. Built-ins and third-party plugins implement the same
interface and reach the registry through the same door, so a generator installed from npm is
indistinguishable downstream from one that ships in the box.

The interface lives in [src/types/generator.ts](../src/types/generator.ts) and the plan it produces in
[src/types/generation-plan.ts](../src/types/generation-plan.ts). Those two files are the normative source;
this document explains what each part is for and what it must not do.

## The one rule

**`generate` returns a plan and never writes.** A generator describes everything it wants to change — files,
dependencies, scripts, injections, environment variables, closing notes — and hands that description to the
engine, which owns the filesystem.

Three things fall out of that split, and they are the entire reason for it:

- **`--dry-run` is truthful.** It is the same code path with the commit omitted, not a second walk that
  prints an approximation. There is no way for the two to drift, because there is only one.
- **Conflicts are settled before any work happens.** The engine knows every destination up front, so it can
  ask the user about all of them and only then start writing. Answering _abort_ costs nothing, because
  nothing has happened yet.
- **Failure rolls back completely.** Every staged change goes through one journalled commit, so a write that
  fails part-way leaves the project byte-identical to how it started.

A generator that writes to disk directly breaks all three at once. The rationale is recorded in full in
[adr/0004](./adr/0004-plan-then-apply-generation.md).

## The lifecycle

The methods run in declaration order. Each one assumes the previous ones have already happened.

| Step                  | Required | Purpose                                                | Must not                                              |
| --------------------- | -------- | ------------------------------------------------------ | ----------------------------------------------------- |
| `detect`              | yes      | Decide whether this project is a candidate at all      | Prompt, or write                                      |
| `prompt`              | yes      | Turn raw invocation into validated, typed options      | Write, or assume a terminal exists                    |
| `validate`            | yes      | Reject impossible option combinations                  | Do any I/O, or prompt                                 |
| `generate`            | yes      | Build and return the `GenerationPlan`                  | Touch the filesystem in any way                       |
| `installDependencies` | no       | Add dependencies only knowable after options are fixed | Run a package manager itself                          |
| `postGenerate`        | no       | Report next steps once the run has succeeded           | Assume it runs on failure, or modify what was written |

**`detect(context)`** returns a `DetectionVerdict`: `supported`, plus a `reason` and `hint` shown to the user
verbatim when it is not. This is the authoritative check — `meta.frameworks` is only the cheap synchronous
filter `atlas list` uses to render a menu without running every detector. A verdict of unsupported becomes
[ATLAS_2003](./troubleshooting.md#atlas_2003).

**`prompt(invocation, context)`** receives the raw `argument` and `flags` and returns the generator's own
options type. Ask through `context.prompts`, never by importing a prompt library: that runner is the single
place Atlas decides whether a question is asked at all, so `--yes`, CI, and a piped stdin all behave
identically and are all testable. Every question carries a default, because every question must be
answerable without a human.

**`validate(options, context)`** throws `AtlasError` and returns nothing. It is pure — no I/O, no prompting —
which is what makes it the cheapest place to reject a run and the easiest thing in a generator to test.

**`generate(options, context)`** returns a `GenerationPlan`, built with a `PlanBuilder`. Reading is allowed:
`context.readFile` exists for decisions the `ProjectContext` cannot answer, and `context.resolve` resolves a
path inside the target project. There is deliberately no write counterpart.

**`installDependencies(options, context)`** is optional and exists for one case: a dependency set that cannot
be known until options are resolved, such as a database driver chosen at prompt time. Anything it returns is
merged with the plan's own dependencies and installed by the engine. Everything a template declares statically
belongs in the plan instead.

**`postGenerate(options, context, result)`** is optional and runs only after a successful apply. It receives
the `GenerationResult`, so it is the right place to point out injections that need wiring by hand, or to
suggest a follow-up command. It is not a cleanup hook — failures are already handled by rollback.

`GeneratorContext` carries the detected `ProjectContext`, resolved `GlobalOptions`, the `Reporter`, the
`PromptRunner`, `readFile`, and `resolve`. Take everything from it rather than reading `process` or the
filesystem directly; that is what lets a generator be tested against an in-memory filesystem with no disk
involved.

The engine's own stage sequence — including the stages a generator does not implement, like conflict
resolution and commit — is declared once in [src/engine/hooks/lifecycle.ts](../src/engine/hooks/lifecycle.ts).

## `GeneratorMeta`

| Field        | Type                             | Notes                                                                                           |
| ------------ | -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `name`       | `string`                         | Unique, kebab-case. Also the subcommand: `atlas <name>`                                         |
| `summary`    | `string`                         | One line, shown by `atlas list`                                                                 |
| `aliases`    | `readonly string[]`              | Alternative names. Must not collide with anything already registered                            |
| `version`    | `string`                         | The generator's own version, independent of Atlas's                                             |
| `argument`   | `GeneratorArgument \| undefined` | The positional, e.g. the `User` in `atlas crud User`. Explicitly `undefined` when there is none |
| `flags`      | `readonly GeneratorFlag[]`       | Commander syntax, registered verbatim by the command layer                                      |
| `frameworks` | `readonly Framework[]`           | **Empty means framework-agnostic**, not "supports nothing"                                      |
| `languages`  | `readonly Language[]`            | **Empty means either language.** `['typescript']` for a template written in TypeScript          |

`frameworks: []` is the correct declaration for a generator that applies anywhere — a logger, a linter
config, a CI workflow. `atlas list` treats it as applicable to every project.

`frameworks` and `languages` exist so `atlas list` can be honest about what applies here without running
every generator's detector. They cover the cheap, static conditions; `detect()` remains authoritative for
anything that has to look at the project. Declaring neither, and refusing the project in `detect()` instead,
produces a listing that says a generator applies when it does not.

Options must be declared as `interface MyOptions extends Record<string, unknown>`. The registry stores
generators type-erased as `AnyGenerator`, and `prompt`'s return type is checked covariantly, so a plain
interface will not satisfy it — see the comment on `AnyGenerator` in
[src/types/generator.ts](../src/types/generator.ts).

Names and aliases share one namespace. When a generator claims a name or an alias that is already taken, the
registry **refuses to register it** and raises [ATLAS_6002](./troubleshooting.md#atlas_6002) naming both
sources, rather than silently replacing the incumbent. Shadowing is the failure mode that produces a user
running `atlas auth` and getting somebody else's generator, with nothing in the log to explain it. During
plugin discovery the collision disqualifies the one generator, not the whole plugin: its siblings still load.

## Building a plan

Use [`PlanBuilder`](../src/engine/plan-builder.ts) rather than assembling a plan literal. It is the only
thing that knows a plan is supposed to be immutable and deterministic, and it puts path resolution and
duplicate detection in one place.

```ts
const builder = new PlanBuilder({ generator: 'health', root: project.root });
```

The root must be absolute. Every relative path handed to the builder resolves against it.

| Method                                 | Adds                                                         |
| -------------------------------------- | ------------------------------------------------------------ |
| `addFile(path, contents, options?)`    | A file. `options.format` and `options.label`                 |
| `addDependency(name, range, options?)` | A package. `options.dev` for `devDependencies`               |
| `addScript(name, command)`             | A `package.json` script                                      |
| `addInjection(request)`                | A line to add to a file Atlas did not author                 |
| `addEnv(key, value, options?)`         | An environment variable. `options.comment`, `options.secret` |
| `addNote(note)`                        | A line printed after a successful run                        |
| `build()`                              | Freezes everything into a `GenerationPlan`                   |

Three behaviours are worth knowing before you write a generator:

- **`build()` sorts its output.** Files, dependencies, scripts, and env entries come back in a stable order
  rather than insertion order, because a plan is rendered to the user and captured in snapshot tests, and
  output that reshuffles between runs makes both worthless. Injections keep their declared order, because
  there the sequence is meaningful.
- **A duplicate file destination throws.** Two writes to one path is a generator bug, not a conflict for the
  user to resolve, so it fails at `addFile` where the stack trace still points at the culprit. The same
  applies to asking for one package at two different ranges. Repeat dependency requests that agree are
  collapsed silently, because several templates in one run legitimately want the same library.
- **`format: false` exists for files prettier must not touch** — `.env` files, lockfiles, anything with no
  parser. It defaults to `true`. The formatter also skips unrecognised extensions on its own, so this flag is
  for the cases where a file _would_ be formatted and should not be.

Plan validation runs before anything is staged, and rejects four things:
[ATLAS_3003](./troubleshooting.md#atlas_3003) covers a file outside the project root, an empty file, a
duplicate destination, and one package requested at two versions.

## `GenerationPlan`

```ts
interface GenerationPlan {
  readonly generator: string;
  readonly root: string;
  readonly files: readonly FileOperation[];
  readonly dependencies: readonly DependencyRequest[];
  readonly scripts: readonly ScriptRequest[];
  readonly injections: readonly InjectionRequest[];
  readonly env: readonly EnvRequest[];
  readonly notes: readonly string[];
}
```

Everything is `readonly`, including the arrays. `FileOperation` carries an absolute `path`, `contents`,
`format`, and an optional `label` used in progress output. `DependencyRequest` is `name`, `range`, `dev` —
and the range comes from a template manifest, never invented in code. `EnvRequest` marks `secret: true` for
values the user must replace before deploying; the engine writes to `.env.example` always and to `.env` only
when the project already has one.

## `GenerationResult`

What the engine reports back, and what `postGenerate` receives:

```ts
interface GenerationResult {
  readonly generator: string;
  readonly dryRun: boolean;
  readonly files: readonly AppliedFile[];
  readonly installed: readonly DependencyRequest[];
  readonly injected: readonly InjectionRequest[];
  readonly manual: readonly InjectionRequest[];
  readonly notes: readonly string[];
}
```

Each `AppliedFile` has an `outcome` of `created`, `overwritten`, `skipped`, or `backed-up`, plus the
`backupPath` when one was taken. `installed` is empty on a dry run, because saying otherwise would make
`--dry-run` lie. `manual` holds the injections whose marker was missing — those are the ones to mention in
`postGenerate`.

## Injections

An injection is how generated code meets code the user owns. Atlas does not run AST codemods
([adr/0003](./adr/0003-anchor-comment-injection-over-ast-codemods.md)); it looks for an anchor comment and
splices lines in above it.

```ts
builder.addInjection({
  path: 'src/app.ts',
  marker: '// atlas:routes',
  snippet: 'app.use(healthRouter);',
  manualHint: 'Add app.use(healthRouter) where your routers are registered.',
});
```

Three properties make this safe:

- **A missing marker is never guessed at.** If the anchor comment is not in the file — or the file does not
  exist — the request lands in `result.manual` and the user is shown `manualHint`. Inserting a snippet at a
  plausible-looking location would corrupt a file the user owns, and a wrong guess is worse than no help.
- **Injection is idempotent.** Before looking for the marker, the injector checks whether the snippet's
  significant lines are already present, ignoring indentation and blank lines. Re-running a generator does
  not register the same route twice, and the marker is still there after a previous injection.
- **It is a splice, not a rewrite.** Everything outside the inserted range comes back byte-for-byte
  identical, the snippet is re-indented to match the anchor, and the file's existing line endings are
  preserved — normalising a CRLF file to LF would turn a three-line addition into a whole-file diff.

Injections are staged into the same transaction as file writes, so they roll back with everything else, and
they read through the virtual filesystem, which means an injection can target a file the same run just
created.

The marker vocabulary is deliberately tiny and lives in
[src/constants/markers.ts](../src/constants/markers.ts): `// atlas:routes`, `// atlas:middleware`,
`// atlas:env-schema`. These strings are permanent public contract — once one is in somebody's repository,
every future version of Atlas has to keep finding it there. Add new names freely; never re-spell a shipped
one.

## A minimal generator

Complete and typed against the interfaces above.

```ts
import {
  PlanBuilder,
  UsageError,
  type DetectionVerdict,
  type GenerationPlan,
  type GenerationResult,
  type Generator,
  type GeneratorContext,
  type GeneratorInvocation,
} from '@mohdsuhel/atlas';

// `extends Record<string, unknown>` is required, not stylistic: see the note on GeneratorMeta above.
interface HealthOptions extends Record<string, unknown> {
  readonly route: string;
}

export const healthGenerator: Generator<HealthOptions> = {
  meta: {
    name: 'health',
    summary: 'Add a health-check endpoint.',
    aliases: ['healthcheck'],
    version: '1.0.0',
    argument: undefined,
    flags: [
      {
        flag: '--route <path>',
        description: 'Path the endpoint is mounted at.',
        defaultValue: '/healthz',
      },
    ],
    frameworks: ['express'],
    languages: ['typescript'],
  },

  detect(context: GeneratorContext): DetectionVerdict {
    if (context.project.framework !== 'express') {
      return {
        supported: false,
        reason: `This generator writes Express handlers; detected ${context.project.framework}.`,
        hint: 'Run `atlas info` to see what Atlas detected about this project.',
      };
    }

    return { supported: true, reason: undefined, hint: undefined };
  },

  async prompt(invocation: GeneratorInvocation, context: GeneratorContext): Promise<HealthOptions> {
    const fromFlag = invocation.flags['route'];

    if (typeof fromFlag === 'string') {
      return { route: fromFlag };
    }

    return {
      route: await context.prompts.text({
        message: 'Mount the health check at',
        defaultValue: '/healthz',
        validate: (value) => (value.startsWith('/') ? undefined : 'Must start with "/".'),
      }),
    };
  },

  validate(options: HealthOptions): void {
    if (!options.route.startsWith('/')) {
      throw new UsageError(
        `--route must start with "/", got "${options.route}".`,
        'Try --route /healthz.',
      );
    }
  },

  generate(options: HealthOptions, context: GeneratorContext): GenerationPlan {
    const { project } = context;
    const builder = new PlanBuilder({ generator: 'health', root: project.root });
    const source = project.layout.sourceDir;

    builder.addFile(
      `${source}/routes/health.route.ts`,
      `import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('${options.route}', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});
`,
    );

    builder.addInjection({
      path: `${source}/app.ts`,
      marker: '// atlas:routes',
      snippet: 'app.use(healthRouter);',
      manualHint: `Import healthRouter from './routes/health.route${project.importSuffix}' and call app.use(healthRouter).`,
    });

    builder.addNote(`Health check available at ${options.route}.`);

    return builder.build();
  },

  async postGenerate(
    _options: HealthOptions,
    context: GeneratorContext,
    result: GenerationResult,
  ): Promise<void> {
    if (result.manual.length > 0) {
      context.reporter.warn('No // atlas:routes marker found — wire the router by hand.');
    }
  },
};
```

Note `project.importSuffix` in the hint: it is `.js` under ESM, where TypeScript requires the emitted
extension on relative imports, and empty under CommonJS. Generated code that hardcodes either one fails to
compile in half of all projects, which is why the module system is detected rather than assumed.

## Third-party generators

A plugin is a name, a version, and some generators:

```ts
export default {
  name: 'atlas-plugin-example',
  version: '1.0.0',
  generators: [healthGenerator],
};
```

Nothing above changes for a plugin. The contract is identical, the registry is the same registry, and both
built-ins and plugins arrive through `registry.register` — that equivalence is the whole reason the plugin
system exists, and it is what makes a built-in generator's behaviour a usable specification for a third-party
one.

Two differences are operational rather than contractual. Built-ins come from a static manifest
([src/generators/index.ts](../src/generators/index.ts)) rather than a filesystem scan, because globbing at
startup costs 20–40 ms per invocation and breaks once the CLI is bundled. Plugins are discovered
dynamically from `atlas-plugin-*` entries in the target project's own dependencies, and are validated at the
boundary: a plugin whose export does not satisfy the contract is rejected with a list of exactly which
members were missing or malformed. See [ATLAS_6001](./troubleshooting.md#atlas_6001) and
[ATLAS_6002](./troubleshooting.md#atlas_6002).
