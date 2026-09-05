# Publishing Atlas

How this repository gets onto GitHub, and how a version of it gets onto npm.

Two things make publishing a CLI different from publishing a library, and both shape everything below:

- **`templates/` is shipped, not bundled.** tsup bundles `src/` into `dist/`, but templates are copied
  verbatim, because they are assets the CLI reads at runtime. A tarball with an empty `templates/`
  directory installs cleanly and then cannot generate a single file. The release workflow checks for this
  explicitly.
- **npm versions are immutable.** You cannot re-publish `0.1.0` with a fix. The only remedies are a
  deprecation and another version. That is why the gate runs _before_ the publish, not after.

---

## Current state of this repository

Checked against the working tree, so you know exactly what is left to do:

| Thing                          | State                                                               |
| ------------------------------ | ------------------------------------------------------------------- |
| Git repository                 | Initialised, 2 commits on `main`, remote `Suheldevs/Atlas-cli`      |
| `repository` in `package.json` | `github.com/Suheldevs/Atlas-cli` — set                              |
| `@mohdsuhel/atlas` on npm      | Unpublished (404). The **scope owner is unverified**                |
| `NPM_TOKEN` secret             | Not set                                                             |
| `CHANGELOG.md`                 | Does not exist yet — Changesets writes it on the first version bump |
| CI and release workflows       | Written and complete, never yet run                                 |

---

# Part 1 — Connecting GitHub

## 1. Decide the repository name and owner

Everything else keys off this. Pick the owner (your personal account or an org) and the repository name,
then use it consistently in three places: the git remote, the three URLs in `package.json`, and — if you
want npm provenance — the `repository` field must match the repository the workflow runs in, exactly.

The rest of this document writes it as `YOUR_USER/atlas`. Substitute yours.

## 2. Replace the placeholder URLs

`package.json` currently points at a repository that does not exist:

```json
"homepage": "https://github.com/Suheldevs/Atlas-cli#readme",
"repository": { "type": "git", "url": "git+https://github.com/Suheldevs/Atlas-cli.git" },
"bugs": { "url": "https://github.com/Suheldevs/Atlas-cli/issues" }
```

Fix all three before the first publish. `homepage` and `bugs` being wrong is only embarrassing —
they become dead links on the npm page. `repository` being wrong is **fatal to provenance**: npm
cross-checks it against the GitHub OIDC claim and rejects the attestation when they disagree.

## 3. First commit

```bash
git config user.name  "Your Name"
git config user.email "you@example.com"

git add -A
git commit -m "Initial commit: Atlas CLI"
```

The default branch matters. `.changeset/config.json` sets `"baseBranch": "main"` and both workflows
trigger on `main`, so if your local branch is `master`, rename it:

```bash
git branch -M main
```

## 4. Create the repository and push

With the GitHub CLI, which creates the repository and wires the remote in one step:

```bash
gh auth login
gh repo create YOUR_USER/atlas --public --source=. --remote=origin --push
```

Or by hand — create an empty repository on github.com first (**no** README, license, or `.gitignore`;
this repository already has all three and an initial commit on their side means a merge before you can
push):

```bash
git remote add origin https://github.com/YOUR_USER/atlas.git
git push -u origin main
```

**Make it public if you want provenance.** npm's `--provenance` requires a public repository. A private
repository can still publish; drop `--provenance` from `.github/workflows/release.yml` if you go that
way, or the publish step will fail.

## 5. What happens on that first push

`.github/workflows/ci.yml` runs five jobs. Expect the first run to take 10–20 minutes because nothing
is cached yet:

| Job                  | What it proves                                                             |
| -------------------- | -------------------------------------------------------------------------- |
| `lint-and-typecheck` | `typecheck`, `lint`, `format:check` — once, not per matrix cell            |
| `test`               | The suite on Node 22 and 24, on **Ubuntu and Windows**                     |
| `package-managers`   | The dependency tree resolves and the binary runs under npm, pnpm, and yarn |
| `templates`          | Every template renders and typechecks, manifests and `__TOKEN__`s validate |
| `generated-output`   | Generated code compiles and lints — gated behind the two cheap jobs above  |

Windows is half the test matrix on purpose. Two bugs in this project reproduced _only_ on Windows;
the reasoning is written into the matrix comment.

If the first run fails, run `npm run verify` locally first — it is the same gate, and the feedback
loop is minutes instead of tens of minutes.

## 6. Protect the branch

Settings → Branches → Add rule for `main`:

- Require a pull request before merging
- Require status checks to pass, selecting **Lint and typecheck**, **Test**, and
  **Generated output compiles and lints**
- Require branches to be up to date before merging

Do this _after_ the first CI run, because GitHub only offers checks it has seen at least once.

## 7. Repository settings worth setting once

- **Actions → General → Workflow permissions:** read-only is enough. Both workflows declare the
  permissions they need per job (`release.yml` needs `id-token: write` for provenance).
- **`.github/dependabot.yml`** is already committed and starts opening PRs immediately. If the noise
  is too much at the start, widen the interval there rather than disabling it.
- **`.github/CODEOWNERS`** is committed and references a placeholder owner. Update it or delete it —
  a CODEOWNERS file naming a non-existent user silently fails to request reviews.

---

# Part 2 — Publishing to npm

## 1. Settle the package name

This is the one decision that is genuinely hard to reverse, so check it before anything else.

**`@mohdsuhel/atlas` is a scoped name, and a scope is not first-come-first-served — it must be your npm
username or an org you belong to.** If your npm username is not `suhel` and you do not own a `suhel`
org, `npm publish` fails with `E403` no matter how correct everything else is.

Verified against the registry just now:

| Name               | Status                                                                |
| ------------------ | --------------------------------------------------------------------- |
| `@mohdsuhel/atlas` | Unpublished. Usable **only if you own the `suhel` scope**             |
| `atlas-cli`        | **Taken** — v1.0.2 by someone else. Not available                     |
| `suhel-cli`        | **Free** — and matches the `npx suhel-cli auth` idea you started from |

Three ways forward:

- **Own the scope.** `npm login`, then `npm whoami`. If it prints `suhel`, you are done. If not,
  create an org named `suhel` (npm → Add organization; free for public packages) and keep the name.
- **Change the scope** to your actual username: `@your-name/atlas`. One edit in `package.json`.
- **Go unscoped** as `suhel-cli`. Shortest to type and needs no scope, but you also give up the
  namespace — every future package has to find its own free name.

If you change the name, change it in exactly one place — `package.json`'s `name` — then update the
`npx` invocations in `README.md`. Nothing in `src/` hardcodes the package name; `src/config/package-meta.ts`
reads it at runtime.

Scoped packages default to **restricted** (private, paid). That is why the workflow passes
`--access public`. Do not remove that flag.

## 2. Create an automation token

The publish runs unattended, so it needs a token that does not prompt for 2FA.

npm → your avatar → **Access Tokens** → **Generate New Token** → **Granular Access Token**:

- Expiration: 90 days or less. Calendar it — an expired token surfaces as a confusing `ENEEDAUTH`
  in a release run months from now.
- Packages and scopes: **Read and write**, limited to this package or scope. Not "all packages".
- Organizations: no access needed.

For the very first publish the package does not exist yet, so scope the token to the **scope**
(`@mohdsuhel/*`) rather than to the package, or the token will have permission to write nothing.

Then on GitHub: Settings → Secrets and variables → Actions → New repository secret, named exactly
**`NPM_TOKEN`**. The workflow reads it as `NODE_AUTH_TOKEN`; the name in `release.yml` is `NPM_TOKEN`.

Also enable **2FA on your npm account** and set the package's publish requirement to
"two-factor authentication or automation tokens" — otherwise the automation token is a single
credential with unlimited publish rights.

## 3. Rehearse before you publish

Both of these are safe and neither touches the registry:

```bash
npm run verify          # typecheck, lint, format:check, test, build — the whole gate
npm run validate:templates

npm pack --dry-run      # lists every file that would ship
npm publish --dry-run   # everything except the upload
```

Read the `npm pack --dry-run` output properly. You are looking for two things: that `dist/` and
`templates/` are both present, and that nothing private leaked in. `files` in `package.json` is an
allowlist (`bin`, `dist`, `templates`, `README.md`, `LICENSE`, `CHANGELOG.md`), so leaks are unlikely
— but `dist/` is gitignored, which means **`npm pack` will silently ship a stale `dist/` if you have
not built**. Run `npm run build` first, or rely on `prepublishOnly`, which runs the full `verify`
(build included) on every real publish.

## 4. Version with Changesets

Changesets is already installed and configured. It exists so the changelog is written when the change
is fresh, by the person who made it, rather than reconstructed from commit messages at release time.

For each user-visible change, on the branch that makes it:

```bash
npm run changeset
```

It asks for a bump type and a summary, and writes a markdown file to `.changeset/`. **Commit that
file with your code.** Pre-1.0, use `patch` for fixes and `minor` for features; save `major` for the
1.0 line. A new generator is a `minor`; a change to what an existing generator writes is closer to a
`major` in spirit, because someone's next `atlas auth` produces different files.

When you are ready to cut a release, on `main`:

```bash
npm run changeset:version
```

That consumes the `.changeset/*.md` files, bumps `version` in `package.json`, and writes or extends
`CHANGELOG.md`. Read the diff before committing — this is the last cheap moment to notice a wrong
bump type.

## 5. Release

The workflow triggers on a **tag**, and refuses to publish if the tag and `package.json` disagree.
So the order is: bump, commit, tag the commit that carries the bump, push.

```bash
git add -A
git commit -m "Release 0.1.0"
git push origin main

git tag v0.1.0
git push origin v0.1.0
```

Watch it under the repository's Actions tab. The workflow runs the full `verify`, typechecks templates,
validates manifests, checks the tarball actually carries `dist/` and `templates/`, and only then
publishes with `--provenance --access public`.

`workflow_dispatch` is also wired up, taking a tag as input, for the case where a run failed for an
environmental reason and you want to retry the same tag without cutting a new version.

## 6. Confirm it worked

```bash
npm view @mohdsuhel/atlas
npm view @mohdsuhel/atlas dist-tags

cd $(mktemp -d)
npx --yes @mohdsuhel/atlas@0.1.0 --version
npx --yes @mohdsuhel/atlas@0.1.0 list
```

Run that from a directory that is **not** this repository. Running the published package from inside
the repository can resolve the local copy and tell you nothing.

On the npm page, the "Provenance" section should show the commit and workflow that built it. If it is
absent, the publish succeeded but the attestation did not — almost always the `repository` field not
matching, or the repository being private.

## Publishing by hand

Useful for a first publish you want to watch, and for the case where GitHub Actions is not available.

```bash
npm login
npm whoami            # confirm this matches your scope
npm publish --access public
```

`prepublishOnly` runs `npm run verify` first, so this cannot publish something that does not build.
It also means the publish takes a few minutes and will refuse if anything at all is failing — that is
the point. You lose provenance, since that requires a CI OIDC token.

## Pre-releases

To get a version in front of people without it becoming what `npm install` gives everyone:

```bash
npm version 0.2.0-beta.0 --no-git-tag-version
npm publish --tag beta --access public
```

Installed explicitly with `npm i -D @mohdsuhel/atlas@beta`. The `latest` tag is untouched. **Never publish
a pre-release without `--tag`** — omitting it moves `latest` to your beta, and every plain
`npm install` starts serving it.

## When something goes wrong

| Situation                  | What to do                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Published a broken version | `npm deprecate @mohdsuhel/atlas@0.1.0 "Broken build, use 0.1.1"`, then publish the fix                             |
| Published a secret         | Revoke the secret first. Unpublish second — assume it is already scraped                                           |
| Need it gone               | `npm unpublish @mohdsuhel/atlas@0.1.0` — allowed for **72 hours** only, and the version number is burned forever   |
| `E403 Forbidden`           | The scope is not yours, or the token lacks write access, or `--access public` is missing on a scoped first publish |
| `ENEEDAUTH` in CI          | `NPM_TOKEN` is missing, expired, or `registry-url` was removed from the setup-node step                            |
| Provenance rejected        | `repository` in `package.json` does not match the actual repository, or it is private                              |
| Tag/version mismatch       | The workflow's first step catches this and stops. Bump, commit, delete the tag, re-tag the new commit              |

## One inconsistency to know about

`.changeset/config.json` says `"access": "restricted"`, while `release.yml` publishes with
`--access public`. Today the workflow wins, because releases run `npm publish` directly and never
`changeset publish` — so the Changesets field is simply unused. If you ever switch to
`changeset publish`, change that field to `public` at the same time, or the first release after the
switch fails as a restricted publish on a scoped package.

## Release checklist

- [ ] `repository`, `homepage`, and `bugs` point at the real repository
- [ ] Package name settled, and `npm whoami` confirms you own the scope
- [ ] `NPM_TOKEN` set as a repository secret, not expired
- [ ] 2FA enabled on the npm account
- [ ] `npm run verify` green locally
- [ ] `npm pack --dry-run` shows `dist/` **and** `templates/`
- [ ] `README.md` describes what actually ships — it is the npm landing page
- [ ] Changesets consumed, `CHANGELOG.md` read
- [ ] Tag matches `package.json`, pushed after the commit that bumped it
- [ ] Smoke-tested with `npx` from outside this repository

Not present yet and worth adding before a 1.0: `SECURITY.md` (a CLI that generates auth code should
say where to report a vulnerability) and `CODE_OF_CONDUCT.md`.

---

## See also

- [usage.md](./usage.md) — testing locally before publishing, and installing after
- [CONTRIBUTING.md](../CONTRIBUTING.md) — the scripts, the verify gate, commit conventions
- [troubleshooting.md](./troubleshooting.md) — every `ATLAS_nnnn` error code
