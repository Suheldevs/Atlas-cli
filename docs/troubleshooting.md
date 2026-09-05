# Atlas — Troubleshooting

Every failure Atlas can produce carries a stable code, a human-readable message, an optional hint, and a
link to the matching section of this page. Nothing that is an _expected_ failure is ever printed as a
stack trace.

Run any command with `--verbose` to print stack traces alongside the presented error. Use it when a
failure does not match its description here, and include the output when reporting a bug.

## Exit codes

| Exit code | Meaning             |
| --------- | ------------------- |
| 0         | Success             |
| 1         | Failure             |
| 2         | Invalid usage       |
| 3         | Precondition failed |
| 4         | Conflict            |
| 130       | Interrupted         |

These values are part of Atlas's public contract, because CI pipelines branch on them. They are never
reassigned — a code's meaning is fixed for the life of the tool, and new failure classes get new codes
rather than repurposing existing ones.

## Error codes

### ATLAS_1001

Atlas requires Node.js **22.13.0 or newer** and refuses to run on anything older. The check runs in
[bin/atlas.js](../bin/atlas.js) before any modern syntax is parsed, so the message you see is this error
rather than a `SyntaxError`.

**Cause.** The `node` binary resolving on your PATH is older than 22.13.0. 22.13 is the floor for two
reasons: Node 20 reached end of life in April 2026, so it no longer receives security patches, and Atlas's
pinned dependencies already require Node 22 — `@inquirer/prompts@8` declares
`engines.node >= 23.5.0 || ^22.13.0 || ^20.17.0`, which is the binding constraint and where the exact
22.13.0 comes from, while `commander@15` requires `>= 22.12.0` and `chalk@6` and `execa@10` require Node 22.

**Fix.** Check with `node --version`. Upgrade Node, or select a supported version with your version
manager (`nvm use 22`, `fnm use 22`, `volta install node@22`). If you are running Atlas inside CI, pin the
Node version in your workflow rather than relying on the runner default. If a project-local `.nvmrc` or
`.node-version` pins an older release, that file needs updating too.

**Exit code:** 3

### ATLAS_1002

Git was not found on PATH. Some operations — checking whether the working tree is clean before writing,
and initialising a repository for a new project — need it.

**Cause.** Git is not installed, or it is installed but its directory is not on the PATH of the shell
running Atlas. The second case is common in minimal Docker images and in GUI-launched terminals on macOS.

**Fix.** Verify with `git --version`. Install Git if it is missing (`apt install git`,
`brew install git`, or the Windows installer), then reopen your terminal so the updated PATH is picked up.
In a container image, add Git to the image rather than installing it at run time. If you intend to run
Atlas without Git, use `--no-git` where the command supports it.

**Exit code:** 3

### ATLAS_1003

No supported package manager was found. Atlas looks for `npm`, `pnpm`, `yarn`, and `bun`, and needs at
least one in order to install the dependencies a generator declares.

**Cause.** None of the four binaries resolves on PATH. Usually this means Node was installed without npm
(some distribution packages split them), or the project's lockfile names a manager that is not installed.

**Fix.** Confirm with `npm --version`. If npm is missing, reinstall Node from nodejs.org or via a version
manager, which bundles it. If the project has a `pnpm-lock.yaml` or `bun.lockb`, install that manager
(`corepack enable pnpm`, or follow the manager's own instructions) so Atlas does not have to fall back and
produce a lockfile mismatch. Run `atlas doctor` to see exactly which managers Atlas can find.

**Exit code:** 3

### ATLAS_1004

The target directory cannot be written to, so Atlas stopped before planning any output rather than failing
part-way through.

**Cause.** Filesystem permissions on the working directory or on a specific target path; a read-only
mount; a directory owned by another user (frequently the result of an earlier command run under `sudo`);
or, on Windows, a file locked by a running process such as an editor or a dev server.

**Fix.** Check ownership and permissions on the directory Atlas reported. On Unix, `ls -ld <dir>` and
`chown -R "$USER" <dir>` if a previous `sudo` run left root-owned files behind — do not re-run Atlas under
`sudo`, which only creates more of them. On Windows, close processes holding the file (stop the dev server,
close the editor tab) and confirm the path is not inside a synced folder that is currently locked. If you
meant to generate elsewhere, pass `--cwd <path>`.

**Exit code:** 3

### ATLAS_1005

A child process Atlas spawned — a package manager install, a formatter, a git command — exited with a
non-zero status. Atlas reports the command, its exit status, and its output.

**Cause.** The underlying tool failed. Common cases: a dependency install rejected by a version conflict
or a registry timeout, a private registry requiring authentication, a `tsc` invocation reporting errors,
or a git command refusing to act on a dirty tree.

**Fix.** Read the child process's own output in the error — it is the authoritative message, and Atlas
does not summarise it. Re-run the failing command by hand to iterate on it. For install failures, check
network and registry access (`npm ping`), your `.npmrc` credentials, and whether the resolved dependency
range conflicts with something already in `package.json`. If Atlas had already written files when the
child process failed, they were rolled back; nothing partial is left behind.

**Exit code:** 1

### ATLAS_1006

An executable Atlas needed was not found on PATH. This is the generic form of ATLAS_1002 and ATLAS_1003
for any other binary a command requires.

**Cause.** The named program is not installed, or PATH differs between your interactive shell and the
environment running Atlas. The mismatch is especially common in CI, in editor-integrated terminals, and
under process managers that do not load your shell profile.

**Fix.** The error names the missing executable — install it, then reopen the terminal. If the program is
installed but Atlas cannot see it, compare `which <name>` (or `where <name>` on Windows) against the PATH
that Atlas is running with; a tool installed only in an interactive shell profile will not be visible to a
non-login shell.

**Exit code:** 3

### ATLAS_1007

Environment preflight checks failed. `atlas doctor` inspects the Node version, available package managers,
Git, and working-directory writability, and reports every problem it found rather than the first one.

**Cause.** One or more of the conditions covered by ATLAS_1001 through ATLAS_1004 is not satisfied. This
code exists so that a preflight run fails once with a complete list, instead of forcing you through the
problems one at a time.

**Fix.** Run `atlas doctor` and resolve each reported item, then run it again until it is clean. Each line
maps to a specific code documented above. In CI, running `atlas doctor` as an explicit early step turns an
environment problem into an obvious failure at the top of the log rather than a confusing one later.

**Exit code:** 3

### ATLAS_1008

The disk filled up while Atlas was writing a project. Everything that had been written was removed, so the
target directory is not left half-populated.

**Cause.** No space left on the device holding the target directory. A scaffolded project is small, but
`npm install` into it is not, and a device that was already close to full frequently crosses the line
during generation rather than before it. On Linux the device can also be out of inodes rather than bytes,
which reports the same errno.

**Fix.** Free space and run the same command again — nothing was kept, so a re-run starts clean. Check with
`df -h .` for bytes and `df -i .` for inodes on Linux. Common culprits are stale `node_modules` directories
(`find . -name node_modules -maxdepth 4 -type d` and remove the ones you no longer need), package-manager
caches (`npm cache clean --force`, `pnpm store prune`), and Docker images. If the target sits on a small
partition, pass `--cwd` to scaffold somewhere with room.

**Exit code:** 3

### ATLAS_1009

The target directory is on a filesystem mounted read-only, so no amount of permission changing will make
the write succeed.

**Cause.** A read-only mount — a container image layer, a squashfs or ISO mount, a network share exported
read-only, or a Linux root filesystem remounted read-only after a disk error. This is distinct from
ATLAS_1004: the permissions may be perfectly correct and the write still cannot happen.

**Fix.** Scaffold somewhere writable with `--cwd <path>`, or remount the filesystem read-write
(`mount -o remount,rw <mountpoint>`). Inside a container, write into a mounted volume rather than the image
filesystem. If the root filesystem went read-only unexpectedly, check `dmesg` — that usually means a disk
error, and generating a project is not the problem to solve first.

**Exit code:** 3

### ATLAS_1010

A path Atlas needed to write is longer than the filesystem allows.

**Cause.** The combination of the directory Atlas was run in, the project name, and a nested template path
exceeded the platform limit — 255 bytes per path segment on most Linux filesystems, and a 260-character
total path on Windows unless long-path support is enabled. Deeply nested working directories and very long
project names are the usual contributors, and encrypted-home setups on Linux lower the per-segment limit
further.

**Fix.** Use a shorter project name, or scaffold nearer the root of the drive with `--cwd`. On Windows,
enable long paths (`git config --system core.longpaths true` for Git, and the
`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled` registry value for the filesystem
itself), then run the command again.

**Exit code:** 3

### ATLAS_2001

The command line could not be interpreted: an unknown command or flag, a missing required argument, too
many positional arguments, or a value that failed validation.

**Cause.** A typo, a flag that belongs to a different command, or an option value outside its allowed set.
Atlas takes ownership of Commander's exit behaviour so that usage errors carry this code consistently
instead of Commander's defaults.

**Fix.** Run `atlas --help` for the command list, or `atlas <command> --help` for one command's flags and
arity. `atlas list` shows every available generator, including any installed plugins, which is the quickest
way to check whether a generator name is real. Note that global flags such as `--cwd`, `--yes`,
`--dry-run`, and `--verbose` are accepted at the root.

**Exit code:** 2

### ATLAS_2002

No `package.json` was found where Atlas was pointed, so there is no project to generate into. The manifest is
what tells Atlas the module system, the package manager, and which dependencies are already present; without
it, every one of those answers would be a guess.

**Cause.** The working directory is not a project root. Usually that means a directory one level above the
project, an empty folder, or a `--cwd` that resolved somewhere unintended. Inside a monorepo it is often a
package directory that genuinely has no manifest of its own, or the workspace root when the intended target
was one package inside it.

**Fix.** Change to the directory holding `package.json`, or pass `--cwd <path>`. Run `atlas info` to see
what Atlas resolved and what each detector concluded — it is the quickest way to confirm you are pointed at
the project you think you are. Atlas will not create a manifest for you: initialising somebody's project is
not a side effect a generator should have.

**Exit code:** 3

### ATLAS_2003

The generator you named cannot write for this project. Every generator declares the frameworks it targets in
`meta.frameworks`, and its own `detect` step has the final say; the message you see is that step's reason,
printed verbatim, along with whatever hint it supplied. Until built-in generators arrive, only a plugin can
produce this error.

**Cause.** Detection found a framework the generator does not target — asking an Express-only generator to
write into a Nest or Fastify application, for instance. Less often, detection is itself wrong: an
unconventional layout, or a framework present only as a transitive dependency, can leave the project
classified as `unknown`, which no framework-specific generator matches.

**Fix.** Run `atlas info` and compare the framework it reports against what you expect. If it is wrong, the
detector is at fault rather than the generator — please report it with that output. If it is right, this
generator has nothing it can write here; `atlas list` marks every generator as applicable or not for the
current project and gives the reason when it is not.

**Exit code:** 3

### ATLAS_2004

No generator is registered under the name or alias you used. Atlas resolves the name against its built-ins
and every plugin it discovered, and suggests the closest match when there is one.

**Cause.** A typo, an alias that belongs to a different generator, or a generator that lives in a plugin
this project does not have. Plugins are discovered from the project's own `dependencies` and
`devDependencies`, so one installed globally is invisible; and a plugin that failed to load was skipped with
a warning earlier in the output rather than stopping the run.

**Fix.** Run `atlas list` to see every registered generator alongside the plugin it came from. If the name
was supposed to come from a plugin, confirm that `atlas-plugin-*` package is a dependency of the project you
are running in, and re-read the earlier output for a `Skipped plugin` warning — that case is ATLAS_6001.
When Atlas suggests a name, the suggestion is always a real registered generator.

**Exit code:** 2

### ATLAS_2005

The name given to `atlas start` cannot be used as both a directory name and an npm package name. The
message names the specific rule that was broken rather than saying only that the name is invalid.

**Cause.** One of: the name is empty or whitespace only; it is an absolute path; it contains a path
separator or a `..` segment; it starts with `.` or `_`, which npm forbids; it contains uppercase letters,
which npm package names cannot; it is a reserved Windows device name (`con`, `prn`, `aux`, `nul`, `com1`
through `com9`, `lpt1` through `lpt9`, with or without an extension); it is longer than 214 characters; or
it contains characters outside letters, digits, dots, dashes and underscores.

Windows device names are rejected on every platform, not only Windows. A `con/` directory created on Linux
cannot be checked out on Windows at all, and that failure lands on someone else, later, with no message
explaining it.

**Fix.** Use a lower-case name made of letters, digits, dashes and underscores — `my-app` is the canonical
shape. `atlas start` always creates its directory inside the current one; to scaffold elsewhere, pass
`--cwd <path>` rather than putting a path in the name.

**Exit code:** 2

### ATLAS_2006

The directory `atlas start` was asked to create already exists and contains files. Atlas will not merge a
generated project into it, and does not offer to.

**Cause.** The name is already taken by a previous run or by unrelated work. `start` writes upwards of
fifty files across two package roots, and there is no safe answer to "what should happen to the `src/` you
already had" — so an occupied target is refused outright rather than resolved file by file the way
`atlas add` resolves conflicts.

An empty directory is accepted, and `.git`, `.DS_Store` and `Thumbs.db` do not count as contents: an
initialised but empty repository is not somebody's work, and nobody deliberately put a `.DS_Store` there.
The error lists the first few entries it actually found, so you can see what you nearly wrote over.

**Fix.** Pick a different name, move the existing directory aside, or delete it if you no longer want it.
To add modules to a project that already exists, that is what `atlas add` is for.

**Exit code:** 3

### ATLAS_2007

The path `atlas start` was asked to create already exists as a file rather than a directory.

**Cause.** A file with the same name sits in the working directory — often a stray archive, a lockfile, or
a note saved under the name you wanted for the project.

**Fix.** Rename or remove the file, or choose a different project name. Atlas never deletes an existing
path to make room for generated output.

**Exit code:** 3

### ATLAS_3001

Generation failed part-way through and was rolled back. **Nothing was kept.** The engine stages every change
— files, `package.json` edits, `.env` entries, injections — in a virtual filesystem and commits them through
a single journalled flush. The journal records each path's previous state immediately before that path is
touched, so a write that fails mid-commit is followed by a full restore: your project is byte-identical to
what it was before you ran the command.

**Cause.** A write, delete, or copy inside the commit failed. In practice that is the filesystem — a
permission denied on one path, a file locked by an editor or a dev server on Windows, a full disk, or a path
longer than the operating system allows. The original failure is attached as the error's cause.

**Fix.** Read the cause, fix it, and run exactly the same command again. Re-running is safe precisely because
nothing partial survived; there is no half-generated state to clean up first and no files of Atlas's to
delete. Use `--verbose` for the underlying stack trace, and `--dry-run` to list every path the run would
touch without touching any of them. If the message says the rollback itself did not finish, that is
ATLAS_3004 and it takes priority over this.

**Exit code:** 1

### ATLAS_3002

You answered _abort_ when Atlas asked how to resolve a file conflict. Nothing was written: every conflict is
detected and settled before the first byte reaches disk, which is exactly what makes _abort_ cost you
nothing.

**Cause.** A file the generator wanted to write already exists with different content, and you chose not to
decide. The error lists every path still needing an answer, not only the one you were asked about. Content
is compared by fingerprint with line endings normalised, so a file that differs only by CRLF is treated as
identical and never prompts at all.

**Fix.** Re-run and pick one of the other answers for each listed path — _overwrite_, _skip_, or _backup_ —
using _diff_ first if you want to see what would change. Passing `--yes` resolves every conflict by **backing
up** the existing file rather than overwriting it: your version is copied to a
`<name>.<timestamp>.atlas-backup` sibling and the generated file takes its place. The destructive answer is
never the one Atlas picks on your behalf, so a non-interactive run is recoverable by construction.

**Exit code:** 4

### ATLAS_3003

A generator produced a plan the engine refuses to apply. This is a bug in the generator, not something you
configured wrongly. The check exists so that a malformed plan fails before it can write anything rather than
half-way through.

**Cause.** One of four things. The plan queued a file outside the project root — containment is checked by
comparing resolved paths, so `/project-evil` is not accepted as being inside `/project`. It contained an
empty file, which nearly always means a template failed to load. It queued the same destination twice, which
is a duplicate rather than a conflict to resolve. Or it asked for one package at two different version
ranges.

**Fix.** There is nothing to configure here. Please report it at <https://github.com/Suheldevs/Atlas-cli/issues>
with the command you ran, the error's detail lines — they name the offending paths or package — and the
output of `atlas info`. The message names the generator that built the plan, so if it came from a plugin,
report it to that plugin's author instead. `--dry-run` runs this check too, so the failure reproduces without
touching your project.

**Exit code:** 1

### ATLAS_3004

Atlas tried to undo a partially applied run and could not finish. This is the one failure in this document
that can leave your project in a state nobody chose, so it is reported loudly rather than swallowed: a
partial rollback you were not told about is worse than no rollback, because you would believe the project had
been restored.

**Cause.** A write or delete during the rollback itself failed. Whatever blocked the original commit — a
locked file, a revoked permission, a full disk, a filesystem that went away — usually blocks the undo as
well. The rollback does not stop at the first failure: it reverses every entry it can and collects the ones
it cannot, so the remaining damage is as small as the filesystem allowed.

**Fix.** The error's detail lines are the work list. Every path Atlas could not restore is named there with
the reason it could not be restored, and those paths are the ones to inspect — treat everything else in the
project as correctly reverted. Where a conflict had been resolved by backing up, the previous contents are
still in the `<name>.<timestamp>.atlas-backup` sibling next to the file. If the project is under version
control, `git status` and `git diff` limited to the listed paths is the fastest way to see and undo what
changed. Do not re-run the generator until those paths are settled.

**Exit code:** 1

### ATLAS_4001

A template directory a generator asked for is not on disk. Templates ship as verbatim asset files rather than
being bundled into the JavaScript, so they are located by path at run time and can be missing independently
of the code that reads them.

**Cause.** A broken or partial installation: a package extracted without its `templates/` directory, an
aggressively pruned `node_modules`, or a container image that copied `dist/` but not the templates beside it.
Running from a clone, it means the build step that puts templates in place has not been run.

**Fix.** The error names the directory it looked for, which tells you whether the path or the installation is
at fault. Reinstall Atlas and confirm the package's `templates/` directory is present. In a container, copy
the whole published package rather than selected directories. From a clone, run `npm run build` before
`node bin/atlas.js`.

**Exit code:** 1

### ATLAS_4002

A template's `template.json` could not be read as a valid manifest. The manifest is the only place a template
declares its dependencies, scripts, and file list, so Atlas refuses to work from one it only partly
understands rather than generating something incomplete.

**Cause.** Malformed JSON — a trailing comma, an unquoted key, a truncated file — or valid JSON that fails
the schema: a missing `name` or `version`, a `files` entry that is not an array, a dependency range that is
not a string. Outside template development, a hand-edited file inside `node_modules` is the usual source.

**Fix.** The error names the manifest and the specific problem with it. If you edited it, correct it against
the manifest schema described in [project-plan.md](./project-plan.md). If you did not, the installation is
damaged — reinstall as for ATLAS_4001. If you are authoring a template, this is the error the repository's
own template validation is there to catch before a user ever sees it.

**Exit code:** 1

### ATLAS_5001

The package manager exited non-zero while installing what a generator declared. Dependencies are installed
last, after everything else has been committed, so the generated source is already on disk and correct —
only the install is missing.

**Cause.** The install itself failed: an unreachable or slow registry, a private registry needing
credentials Atlas does not have, a peer-dependency conflict the manager refuses to resolve (`ERESOLVE`), a
lockfile that disagrees with the manifest, or a manager other than the one the lockfile belongs to.

**Fix.** The error carries the exact command, its exit status, the directory it ran in, and the package
manager's own stderr in full — Atlas neither truncates nor summarises it, because that output is the
authoritative message. Run that command by hand in that directory and iterate there. Once it succeeds you are
done: the generated files are already in place, so there is nothing to re-run. In a monorepo the directory
will be the workspace install root rather than the package, because installing inside a package produces a
nested `node_modules` that resolution ignores.

**Exit code:** 1

### ATLAS_5002

A package a generator requires is already in `package.json` at a range that does not satisfy what the
generator needs. Atlas reports the mismatch and installs nothing for that package. It never widens or bumps a
range you pinned on your behalf — quietly upgrading somebody else's dependency is how a code generator
breaks a working project.

**Cause.** The project declares, say, `zod@^3.22.0` and the generator needs `^4.0.0`. The comparison is
against the range declared in the manifest, not the installed tree. A production dependency satisfies a dev
request; `workspace:`, `file:`, and `link:` ranges are treated as deliberate overrides and left alone; and
`peerDependencies` are ignored, because declaring a peer says a consumer must supply the package, not that
this project has it.

**Fix.** Make the upgrade deliberately: widen or bump the range in `package.json`, install it, then run
Atlas again — the second run finds the requirement satisfied and installs nothing. Read the package's own
upgrade notes first when the gap is a major version. If you would rather not move, the generated code is
still on disk and nothing in it imports Atlas, so adapting it to the version you have is a normal source
edit.

**Exit code:** 4

### ATLAS_5003

Prettier could not format a generated file. You only see this in strict mode: formatting is lenient by
default, and a file prettier cannot parse is written unformatted rather than failing the run.

**Cause.** The generated code is not syntactically valid, which makes it a template bug — output that cannot
be parsed is output that would not have compiled either. It is not a problem with your project's prettier
configuration. Atlas resolves and honours the target project's own config, and a file type it has no parser
for is skipped silently rather than treated as a failure.

**Fix.** Run with `--verbose` to see prettier's own diagnostic, which names the position it could not parse;
that diagnostic is the bug report. For a built-in template, please file it at
<https://github.com/Suheldevs/Atlas-cli/issues> with that output. If you are authoring the template, fix the syntax
and run again — strict mode exists so the template test suite fails loudly on exactly this, while a real
user's run is never aborted over cosmetics.

**Exit code:** 1

### ATLAS_6001

A plugin could not be imported. Atlas discovers third-party generators from `atlas-plugin-*` packages in the
project's own dependencies and from paths named in configuration. During that discovery pass a plugin that
fails to load is skipped with a warning and the run continues, so this code surfaces when a plugin was loaded
explicitly and its failure is the whole answer.

**Cause.** `import()` threw. The package is declared but not installed, it is CommonJS rather than ESM, its
`exports` map has no importable entry, or its own top-level code threw on load — a missing transitive
dependency of the plugin, or a build that was never run.

**Fix.** The error names the specifier it tried to import and carries the underlying import error as its
cause, which `--verbose` prints with the stack. Confirm the package is installed in the project you are
running in, that it publishes ESM, and that its build output exists; reinstalling the plugin resolves most of
these. If you only need the other generators, note that a plugin skipped during discovery is not fatal —
`atlas list` still works and shows exactly what did load.

**Exit code:** 1

### ATLAS_6002

A plugin loaded, but what it exported does not satisfy the contract. Plugin code runs inside Atlas's process,
so it is checked at the boundary; the alternative is a `TypeError` deep in the engine that looks like an
Atlas bug and gets reported as one. As with ATLAS_6001, a plugin that fails this check during discovery is
skipped with a warning rather than aborting the run.

**Cause.** Either the module did not export an object shaped `{ name, version, generators }`, or one of its
generators is incomplete. The error lists exactly which members were missing or malformed — a `meta.name`
that is not a non-empty string, `meta.aliases` or `meta.frameworks` that are not arrays, or any of `detect`,
`prompt`, `validate`, and `generate` that is not a function. The same code also covers a generator whose name
or alias collides with one already registered: the registry refuses the shadowing generator rather than
silently replacing the one that was there.

**Fix.** If you are the author, work through the listed problems against
[generator-contract.md](./generator-contract.md) — each line names one member and what was wrong with it. If
you are not, send that list to the plugin's author and pin a version that worked in the meantime. For a name
collision, uninstall one of the two plugins or ask its author to rename the generator; the error names both
sources so it is clear which two are fighting.

**Exit code:** 1

### ATLAS_9001

Cancelled by the user. Exit code 130 is the conventional value for a process terminated by SIGINT, so
shells and CI systems interpret it correctly.

**Cause.** You pressed Ctrl-C, or answered a confirmation prompt with no, or chose _abort_ when asked how
to resolve a file conflict.

**Fix.** None required — this is a clean, intentional stop. Nothing was written: if the cancellation
arrived after the engine had begun committing, the undo journal rolled every applied operation back. To
avoid interactive prompts entirely, pass `--yes` to accept defaults, or `--dry-run` to see the full plan
without being asked to commit to it.

**Exit code:** 130

### ATLAS_9999

An unexpected internal error. Every other code in this document describes a failure Atlas anticipated;
this one means it did not, which makes it a bug.

**Cause.** A defect in Atlas — an unhandled edge case in detection, planning, or commit. It is not
something you configured incorrectly.

**Fix.** Re-run with `--verbose` to get the stack trace, then please report it at
<https://github.com/Suheldevs/Atlas-cli/issues> with the trace, the exact command you ran, the output of
`atlas doctor`, and your Node version, package manager, and operating system. If you need to keep working
in the meantime, `--dry-run` will often reveal which part of the plan is at fault. As with every other
failure, no partial output is left on disk.

**Exit code:** 1
