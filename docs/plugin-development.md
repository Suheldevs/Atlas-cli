# Atlas — Plugin Development

A plugin is an npm package that adds generators to Atlas. Nothing about a plugin generator is second-class:
it implements the same `Generator` interface as a built-in, reaches the registry through the same
`register` call, appears in `atlas list`, and gets a top-level shortcut alias. Atlas's own generators are the
heaviest consumer of that contract, which is what stops it rotting.

The normative sources are [src/types/plugin.ts](../src/types/plugin.ts) for the plugin shape,
[src/types/generator.ts](../src/types/generator.ts) for the generator contract,
[src/plugins/](../src/plugins/) for resolution, loading, and validation, and
[src/registry/](../src/registry/) for the catalogue.

## Naming and discovery

Atlas discovers plugins from **the target project's own dependencies**, by name:

| Pattern                 | Example                       |
| ----------------------- | ----------------------------- |
| `atlas-plugin-*`        | `atlas-plugin-stripe`         |
| `@scope/atlas-plugin-*` | `@acme/atlas-plugin-internal` |

Both `dependencies` and `devDependencies` are read. A matching package is imported, validated, and its
generators registered. Nothing else is needed — no registration call, no config entry, no CLI flag.

Atlas deliberately does **not** scan `node_modules` wholesale. Two reasons, and the second is the one that
matters:

- It is slow. Walking a real dependency tree on every invocation costs more than the generation usually does.
- It would mean a **transitive** dependency could inject a generator nobody asked for. Plugin code runs
  inside Atlas's process, with the user's filesystem in reach. Discovery is therefore limited to packages the
  project chose to depend on, plus paths it named explicitly in configuration — both of which are decisions
  someone made and committed.

The second source is the `plugins` array in `atlas.config.*` or under the `atlas` key in `package.json`. It
takes package names, or relative and absolute paths — a path pointing at a directory resolves to `index.js`
inside it. A configured path that does not exist is dropped rather than fatal: a stale entry in a shared
config file should not stop a teammate from generating anything at all.

## The plugin shape

```ts
export interface AtlasPlugin {
  readonly name: string;
  readonly version: string;
  readonly generators: readonly AnyGenerator[];
}
```

That is the whole surface, and it is intended to stay that way. Everything a generator can do is already
expressed by the `Generator` contract, so the wrapper has no reason to grow capabilities of its own.

The plugin object must be the module's **default export**. A named `plugin` export is also accepted, in that
order of precedence — see `unwrap` in [src/plugins/plugin-loader.ts](../src/plugins/plugin-loader.ts) for the
exact resolution. If the module itself is shaped like a plugin, that is used. Any other export name is not
found, and the plugin is reported as invalid.

The package must be **ESM**. Atlas is ESM-only and loads plugins with `import()`; a CommonJS-only package
without an importable `exports` entry fails at load with
[ATLAS_6001](troubleshooting.md#atlas_6001).

## The generator contract is the same contract

There is nothing plugin-specific to learn. A plugin generator implements `detect`, `prompt`, `validate`, and
`generate`, optionally `installDependencies` and `postGenerate`, and returns a `GenerationPlan` built with a
`PlanBuilder`. It never writes to disk — the engine owns the filesystem, which is what makes `--dry-run`
truthful and a failed run recoverable.

All of that is documented once, in [generator-contract.md](generator-contract.md). Read it before writing a
plugin; this page only covers what is different about shipping one as a package.

Two differences are operational rather than contractual:

- Built-ins come from a static manifest ([src/generators/index.ts](../src/generators/index.ts)) rather than a
  filesystem scan, because globbing at startup costs 20–40 ms per invocation and breaks once the CLI is
  bundled. Plugins are resolved dynamically, because their names are not known at build time.
- Plugins are validated at the boundary. Built-ins are checked by the compiler instead.

Downstream of `register`, nothing can tell the two apart except by reading `source`.

## Validation at the boundary

A plugin is arbitrary third-party code being loaded into Atlas's process, so
[plugin-validator.ts](../src/plugins/plugin-validator.ts) checks it before anything else touches it. The
alternative is a `TypeError` deep inside the engine that looks like an Atlas bug and gets reported as one.

Rejection lists **every** problem at once, not the first:

| Level     | Checked                                                                            |
| --------- | ---------------------------------------------------------------------------------- |
| Plugin    | `name` is a non-empty string; `version` is a string; `generators` is an array      |
| Generator | `meta` is an object; `meta.name` is a non-empty string; `meta.summary` is a string |
| Generator | `meta.aliases` and `meta.frameworks` are arrays                                    |
| Generator | `detect`, `prompt`, `validate`, and `generate` are all functions                   |

The failure names the specifier it was loading and one line per problem, so a plugin author gets the
complete list in one run rather than fixing them one at a time. The code is
[ATLAS_6002](troubleshooting.md#atlas_6002).

The runtime check is narrower than the type. `meta.version`, `meta.argument`, `meta.flags`, and
`meta.languages` are required by `GeneratorMeta` but not asserted here, because the compiler already covers a
plugin written in TypeScript and this validator exists for the case where it was not. Write plugins in
TypeScript; the type is the better error message.

Note what happens next, because it is a deliberate trade: **during discovery, a broken plugin is skipped with
a warning and the run continues.** The user asked to generate something, and refusing to do it because an
unrelated plugin failed to parse would be the wrong answer. The warning names the plugin so the fault is
never ambiguous, and `--verbose` adds the underlying stack. `atlas list` still works and shows exactly what
did load.

The same applies one level down. If a plugin exposes four generators and one of them collides with an
existing name, that one generator is disqualified and its three siblings still register.

## Collisions are refused, not resolved

Names and aliases share one namespace. When a generator claims a name or an alias that is already taken, the
registry **refuses to register it** and names both sources.

Atlas will not let a plugin shadow a built-in, and it will not pick a winner between two plugins. The failure
mode being avoided is concrete: a user runs `atlas auth`, gets somebody else's generator, and there is
nothing in the output to explain why the behaviour does not match any documentation. A refusal with two
package names in it is a five-minute problem; silent shadowing is an afternoon.

The practical consequence for an author: pick a distinctive generator name, and be conservative with
`aliases`. An alias is cheap to add and, once shipped, expensive to change.

## A minimal plugin package

Complete, and typed against the published interfaces.

**`package.json`**

```json
{
  "name": "atlas-plugin-request-id",
  "version": "1.0.0",
  "description": "Adds a request-id middleware generator to Atlas.",
  "license": "MIT",
  "type": "module",
  "engines": {
    "node": ">=22.13.0"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json"
  },
  "peerDependencies": {
    "@mohdsuhel/atlas": "^0.1.0"
  },
  "devDependencies": {
    "@mohdsuhel/atlas": "^0.1.0",
    "typescript": "^6.0.3"
  }
}
```

`@mohdsuhel/atlas` is a **peer** dependency, not a regular one. A plugin that bundled its own copy of Atlas would
end up with a second `PlanBuilder` class and a second set of error types, and the engine would receive plans
built by a stranger.

That has one consequence worth planning for: `PlanBuilder` and `UsageError` are runtime imports, so
`@mohdsuhel/atlas` has to be **resolvable from the plugin's own location**. In a project that only ever runs
`npx @mohdsuhel/atlas`, Atlas lives in the npx cache and the plugin's `import` will not find it — the plugin is
then skipped with an `ATLAS_6001` warning. Tell your users to install Atlas as a devDependency alongside the
plugin:

```
npm install --save-dev @mohdsuhel/atlas atlas-plugin-request-id
```

**`tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

`exactOptionalPropertyTypes` is not decoration. It is what forces `meta.argument` and the `DetectionVerdict`
fields to be spelled out as `undefined` rather than omitted, which is how the contract is declared.

**`src/index.ts`**

```ts
import {
  PlanBuilder,
  UsageError,
  type AtlasPlugin,
  type DetectionVerdict,
  type GenerationPlan,
  type Generator,
  type GeneratorContext,
  type GeneratorInvocation,
} from '@mohdsuhel/atlas';

// `extends Record<string, unknown>` is load-bearing, not decoration. `AtlasPlugin.generators`
// is `readonly AnyGenerator[]`, which is `Generator<Record<string, unknown>>`, and `prompt`
// returns `Promise<TOptions>` — a covariant position. An options interface with no index
// signature is therefore not assignable, and the plugin object fails to compile.
interface RequestIdOptions extends Record<string, unknown> {
  readonly header: string;
}

const requestIdGenerator: Generator<RequestIdOptions> = {
  meta: {
    name: 'request-id',
    summary: 'Add a request-id middleware that echoes a correlation header.',
    aliases: [],
    version: '1.0.0',
    argument: undefined,
    flags: [
      {
        flag: '--header <name>',
        description: 'Header carrying the correlation id.',
        defaultValue: 'x-request-id',
      },
    ],
    frameworks: ['express'],
    languages: ['typescript'],
  },

  detect(context: GeneratorContext): DetectionVerdict {
    if (context.project.framework !== 'express') {
      return {
        supported: false,
        reason: `This generator writes Express middleware; detected ${context.project.framework}.`,
        hint: 'Run `atlas info` to see what Atlas detected about this project.',
      };
    }

    return { supported: true, reason: undefined, hint: undefined };
  },

  async prompt(
    invocation: GeneratorInvocation,
    context: GeneratorContext,
  ): Promise<RequestIdOptions> {
    const fromFlag = invocation.flags['header'];

    if (typeof fromFlag === 'string') {
      return { header: fromFlag };
    }

    return {
      header: await context.prompts.text({
        message: 'Correlation header name',
        defaultValue: 'x-request-id',
        validate: (value) => (value.trim().length > 0 ? undefined : 'Cannot be empty.'),
      }),
    };
  },

  validate(options: RequestIdOptions): void {
    if (!/^[a-z0-9-]+$/u.test(options.header)) {
      throw new UsageError(
        `--header must be lower-case letters, digits, and hyphens, got "${options.header}".`,
        'Try --header x-request-id.',
      );
    }
  },

  generate(options: RequestIdOptions, context: GeneratorContext): GenerationPlan {
    const { project } = context;
    const builder = new PlanBuilder({ generator: 'request-id', root: project.root });
    const source = project.layout.sourceDir;

    builder.addFile(
      `${source}/middleware/request-id.ts`,
      `import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = '${options.header}';

/** Echoes an inbound correlation id, or mints one when the client did not send it. */
export function requestId(request: Request, response: Response, next: NextFunction): void {
  const inbound = request.header(REQUEST_ID_HEADER);
  const id = inbound === undefined || inbound.trim() === '' ? randomUUID() : inbound;

  response.setHeader(REQUEST_ID_HEADER, id);
  next();
}
`,
    );

    builder.addInjection({
      path: `${source}/app.ts`,
      marker: '// atlas:middleware',
      snippet: 'app.use(requestId);',
      manualHint: `Import requestId from './middleware/request-id${project.importSuffix}' and call app.use(requestId) before your routes.`,
    });

    builder.addNote(`Requests now carry a ${options.header} header.`);

    return builder.build();
  },
};

const plugin: AtlasPlugin = {
  name: 'atlas-plugin-request-id',
  version: '1.0.0',
  generators: [requestIdGenerator],
};

export default plugin;
```

Five details in there are the ones plugin authors get wrong most often.

`project.importSuffix` decides the extension on relative import specifiers: `.js` under ESM, where TypeScript
requires the emitted extension, and empty under CommonJS. Hardcoding either one means the generated file
fails to compile in half of all projects.

`project.layout.sourceDir` is not always `src`. Projects that keep their source at the repository root are
detected as flat-layout.

`meta.frameworks` and `meta.languages` are the cheap static filter `atlas list` uses to mark generators that
cannot apply, so it can be honest without running every detector. Empty means "any" in both cases, not
"none". `detect` remains authoritative for anything that has to look at the project.

The marker string `// atlas:middleware` comes from the vocabulary in
[src/constants/markers.ts](../src/constants/markers.ts), which Atlas re-exports precisely so plugin authors
import it rather than copying the literal and getting it subtly wrong. These strings end up permanently in
users' files: add new names freely, never re-spell a shipped one.

File contents are produced by the plugin, not loaded through `context.templates`. That renderer resolves
template names against **Atlas's own** shipped `templates/` directory, so it can only load templates that ship
inside `@mohdsuhel/atlas`. A plugin that wants its files as separate assets rather than as inline strings ships
them in its own package and reads them itself — the shape of the plan is identical either way, because the
engine only ever sees contents.

## Developing locally

You do not need to publish anything to test a plugin. Three ways, in increasing order of fidelity.

**1. A configured path.** Fastest loop. Point the target project's config at the plugin's built entry point:

```ts
// atlas.config.ts in the target project
export default {
  plugins: ['../atlas-plugin-request-id/dist/index.js'],
};
```

A path to a directory resolves to `index.js` inside it. Run `tsc --watch` in the plugin and
`atlas list --verbose` in the project; `--verbose` prints which plugins loaded and why any were skipped.

**2. A file dependency.** Closer to reality, because discovery now happens by name rather than by path:

```
npm install --save-dev @mohdsuhel/atlas file:../atlas-plugin-request-id
```

The package name matches `atlas-plugin-*`, so it is picked up from the dependency list with no config at all
— which is the code path your users will be on. `npm link` works too, though a `file:` dependency is easier
to reason about because it is written down in `package.json`.

**3. A packed tarball.** The last check before publishing, and the only one that catches a broken `files`
list or a missing `exports` entry:

```
npm run build
npm pack
cd ../some-project
npm install --save-dev ../atlas-plugin-request-id/atlas-plugin-request-id-1.0.0.tgz
npx atlas list
npx atlas request-id --dry-run
```

`--dry-run` runs the entire pipeline and omits only the commit, so it exercises detection, prompting,
validation, plan construction, and plan validation without touching the project. It is the right first
command after any change.

Then generate for real into a scratch project and run `tsc` and ESLint over the result. That is the only
honest check that what your generator writes is production quality; everything upstream of it is an assertion
about what it meant to write.

## Before publishing

- `--dry-run` produces the plan you expect in an ESM project **and** a CommonJS one. The import suffix is the
  first thing to break.
- `detect` refuses unsupported projects with a `reason` and a `hint` the user can act on, rather than
  generating something that will not compile. `meta.frameworks` is only the cheap filter `atlas list` uses;
  `detect` is authoritative.
- Every prompt has a default, so `--yes` and CI work without a terminal. Ask through `context.prompts`, never
  by importing a prompt library.
- The generator name and aliases are distinctive enough not to collide with a built-in. `atlas list` in a
  project with Atlas installed shows the current namespace.
- Nothing the plugin generates imports Atlas, or the plugin. Generated code must survive both being
  uninstalled — that is the one rule the whole design exists to protect.
