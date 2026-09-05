# Atlas v1.0 — Wizard-Driven Auth + CRUD

## Context

Atlas today works: seven generators, 736 tests, and generated output verified by compiling it against
real packages under `strict`. But it is a **flag-driven** tool. `atlas auth --hashing scrypt --database
prisma` requires knowing three flags exist. `atlas crud User` produces a fixed `name` + `description`
shape nobody actually wants. And every generator ends by printing "Next steps" — manual work the user
has to finish by hand.

v1.0 closes that gap for the two generators that matter most:

> **A developer should be able to create a production-ready Express + TypeScript backend with
> Auth + CRUD through an interactive wizard, with almost zero manual wiring.**

**Scope is deliberately narrow: only `auth` and `crud`.** The other five generators — `logger`,
`prisma`, `redis`, `socket`, `upload` — are not touched and keep working exactly as they do now. They
continue to use Zod, because changing them is out of scope.

### Decisions

| Decision           | Choice                                                                      |
| ------------------ | --------------------------------------------------------------------------- |
| Validation         | **No validation library.** Hand-written validators. Zod removed from both   |
| Password hashing   | **bcryptjs only.** No argon2, no scrypt, no choice to make                  |
| Tokens             | **`jsonwebtoken`, always.** Replaces `jose`                                 |
| Roles              | **A single `role` field: `'admin' \| 'user'`.** Not a string array          |
| Auth endpoints     | signup, login, me, refresh, logout — **refresh rotation stays**             |
| Not in v1.0        | Email verification, forgot password, Swagger, generated tests               |
| ORMs               | Mongoose, Prisma, **Sequelize (new)**, and None                             |
| JavaScript support | **Parallel hand-written JS template set** for auth + crud, with JSDoc types |
| Auto-wiring        | **New `atlas init`** scaffolds `app.ts` carrying Atlas's own markers        |

### Assumptions — override any of these

1. **Field input is multi-line inline**, ended by a blank line, not `$EDITOR`. Inquirer's editor prompt
   shells out to `$EDITOR`, which on Windows is often notepad and can hang with no visible cause.
   Pasting a block into a terminal is only keystrokes, so paste works either way.
2. **Fields reach the model, the validators, and the searchable/sortable lists** — not relations.
   `author:ref:User` needs cross-entity ordering and three incompatible relation dialects. That is v1.1.
3. **Signup always creates a `user`.** A client-supplied role is ignored, never trusted — otherwise
   anyone can POST their way to admin. The first admin is promoted directly in the database, and the
   generated notes say so.
4. **TypeScript first, then JavaScript.** Same total scope, but the JS set gets written once against
   templates that have stopped moving rather than rewritten after every design change.

---

## Consequences of dropping Zod

This is the largest change to code that already exists and works, so it is worth being explicit about
what replaces it.

Zod currently does four jobs in these two templates: it parses and coerces query strings, it validates
request bodies, it produces the TypeScript types via `z.infer`, and it reports field-level errors. All
four have to be hand-written now:

- **`auth/http/validate.ts`** and the CRUD equivalent — small hand-written helpers returning
  `{ ok: true, value } | { ok: false, errors }`. No throwing for expected input; a malformed body is a
  400, not an exception.
- **Types are declared, not inferred.** `z.infer<typeof schema>` becomes a hand-written `interface`, and
  the validator must be checked against it — that is what stops the type and the runtime check drifting
  apart, which is the one real thing Zod was buying.
- **Query coercion becomes explicit.** `z.coerce.number().int().min(1).max(100)` becomes a
  `parsePositiveInt(raw, { min, max, fallback })` helper. `req.query` values are `string | string[] |
undefined`, and that union is exactly where hand-rolled validation usually goes wrong.

The bounds that exist today must survive the rewrite: `limit` stays capped so one request cannot ask for
the whole table, and a PATCH with no fields stays a 400 rather than a silent no-op.

---

## The two architectural moves everything rests on

### 1. Comment-position tokens carry multi-line content

Field lists need repetition, which string substitution cannot express. The trick is token placement:

```ts
export interface __ENTITY_NAME__ {
  id: string;
  // __ENTITY_INTERFACE_FIELDS__
}
```

`{ __ENTITY_INTERFACE_FIELDS__ }` in value position would parse but fail the typecheck gate. In
**comment** position it typechecks clean before generation, as an empty shape, and becomes real code
after. The replacer must indent continuation lines to the token's own column.

### 2. Region markers make CRUD options optional _inside_ a file

`regionBegin` / `regionEnd` in [markers.ts](../src/constants/markers.ts) already exist for this and have
never been used. Soft delete, timestamps, search, sorting and filtering each touch several files without
owning any of them, so file-level variant filtering — what `selectFiles` in
[auth.plan.ts](../src/generators/auth/auth.plan.ts) does — cannot express them:

```ts
export interface __ENTITY_NAME__ {
  id: string;
  // atlas:begin softDelete
  deletedAt: Date | null;
  // atlas:end softDelete
}
```

Unselected regions are deleted line-wise before token substitution. This is **line deletion, not an
expression language** — the no-template-language constraint holds, and the template stays valid,
typecheckable TypeScript before generation because the markers are comments.

**Auth needs none of this.** With hashing, tokens, roles and refresh all fixed, auth has no toggles left
except the ORM — which `selectFiles` already handles by whole file. Regions are a CRUD-only mechanism.

Both mechanisms need validation on the same principle as `findUnknownTokens`: an unbalanced region, or
one whose name is not declared in `template.json`, is a CI failure rather than a mystery in someone's
generated output.

---

## Milestones

Each ends with `npm run verify` and `npm run validate:templates` green.

### M1 — Auth template rewrite (Mongoose + Prisma, TypeScript) — **Delivered**

The biggest single change, and first because everything else builds on the result.

Verified by generating into two scratch projects and installing the real packages: the Mongoose variant
typechecks under `strict` and passes 21 runtime checks (rotation, family revocation on replay,
indistinguishable login failures, the 72-byte rejection, type-confusion refusal); the Prisma variant
passes `prisma validate`, `prisma generate` on SQLite, and then `tsc` against the **real** generated
client rather than the ambient shim.

Three bugs surfaced that no gate here could have caught, all now pinned by
[auth-template-source.test.ts](../tests/unit/auth-template-source.test.ts):

- `import { sign } from 'jsonwebtoken'` typechecks and throws at import. The package is CommonJS and
  Node cannot synthesise those named exports; only a default import works.
- `createTokenService` read `config.issuer` in its own body, and the module ends with
  `export const tokenService = createTokenService()`. That resolved the lazy `authConfig` proxy at
  import time, so importing any auth file demanded a `JWT_SECRET` — defeating the entire reason the
  proxy exists. Pre-existing, not introduced by the rewrite.
- `TIMING_DECOY_HASH` was an argon2 string. Against bcrypt, `compare` throws instead of doing the work
  and returns _faster_ than the real path, restoring the account-enumeration timing oracle the
  constant exists to remove — silently, with every test green.

- **Swap `jose` → `jsonwebtoken`** in `auth/security/token-service.ts`. Two things must carry over or
  the rewrite is a downgrade: the algorithm stays pinned (`algorithms: ['HS256']` on verify — never
  trust the token header), and `issuer` / `audience` stay verified. Keep the access/refresh token type
  separation so an access token cannot be replayed as a refresh token.
- **Replace both hashers with `auth/security/bcrypt-hasher.ts`.** Delete `argon2-hasher.ts`,
  `scrypt-hasher.ts` and the `--hashing` flag; `HASHER_FILES` and `HASHER_DEPENDENCIES` in
  [auth.plan.ts](../src/generators/auth/auth.plan.ts) go with them. Keep the cost factor in config and
  keep the rehash-on-login upgrade path.
- **Delete Zod.** New `auth/http/validate.ts` with hand-written email, password and body checks; the
  DTO types become declared interfaces. `auth/http/auth-validators.ts` is rewritten, not adapted.
- **`roles: readonly string[]` → `role: 'admin' | 'user'`.** Touches the User domain type, both
  repositories, the Prisma fragment, the JWT claims, and `require-role.ts`.
- **Endpoints:** `POST /auth/signup`, `POST /auth/login`, `GET /auth/me`, `POST /auth/refresh`,
  `POST /auth/logout`, plus one admin-only route demonstrating `requireRole('admin')`.
- Preserve what makes this module worth generating: timing-equalised login, identical error for unknown
  email and wrong password, refresh rotation with family-wide reuse detection, and the httpOnly
  SameSite=strict cookie.
- Update `templates/auth/template.json` — `bcryptjs`, `jsonwebtoken`, `@types/bcryptjs`,
  `@types/jsonwebtoken`; remove `jose` and `zod`. **Install both as real devDependencies here** so the
  gate compiles against the real types.
- Rewrite the auth unit tests. The existing suite asserts on argon2, scrypt and `roles[]`.

### M2 — Sequelize for auth

- `sequelize-user-repository.ts`, `sequelize-refresh-token-repository.ts` and model definitions; extend
  `DATABASE_FILES` and `DATABASE_DEPENDENCIES` in `auth.plan.ts`.
- Add `'sequelize'` to `DatabaseLayer` in [project-context.ts](../src/types/project-context.ts) and a
  signature to [database.detector.ts](../src/detection/detectors/database.detector.ts).
- **Install `sequelize` as a real devDependency. Do not write an ambient shim.** The express-shim
  incident is precisely this mistake: a shim let templates typecheck in CI while importing types the
  manifest never declared, and the gate reported PASS on code that could not compile.

### M3 — Wizard foundation

- `PromptRunner.lines()` for multi-line input, added to the interface and to both
  `InteractivePromptRunner` and `ScriptedPromptRunner` in
  [prompt-runner.ts](../src/prompts/prompt-runner.ts). Non-interactive returns the default, like every
  other method.
- `src/prompts/wizard.ts` — section headers, plus the **detected-config summary and "Use it?" confirm**.
  Today `askDatabase` in [auth.prompts.ts](../src/generators/auth/auth.prompts.ts) silently
  short-circuits on detection; it should show what it found and let you say no.
- **Database engine as a concept separate from ORM.** `ProjectContext.database` is the ORM. Add an
  engine question — MongoDB / PostgreSQL / MySQL / SQLite — and derive the ORM choices from it, so
  MongoDB + Sequelize and SQLite + Mongoose are unreachable rather than rejected after the fact.

Every question keeps a default so `--yes` and CI behave identically. That single gate is the reason
`InteractivePromptRunner` exists, and the wizard must not bypass it.

### M4 — `atlas init` and real auto-wiring

- New generator `src/generators/init/` and `templates/init/`, writing `src/app.ts` and `src/server.ts`
  with `// atlas:imports`, `// atlas:middleware` and `// atlas:routes` already in place, plus
  `package.json` scripts, `tsconfig.json` when absent, `.env`, and `.gitignore` entries.
- **New `MARKERS.imports`.** An injected `app.use('/auth', …)` is useless without its import line.
  Adding names to the marker vocabulary is explicitly allowed; renaming a shipped one is not.
- **`auth/index.ts` must expose one composition function.** It currently ships a comment block telling
  the user to assemble repositories and a hasher by hand. Zero-wiring needs
  `createAuthModule(deps) → { router }` so a single injected line is enough.
- **Write a real `JWT_SECRET` to `.env`.** [generation-engine.ts:199-209](../src/engine/generation-engine.ts#L199-L209)
  puts a placeholder in the committed `.env.example` and only touches `.env` when it already exists.
  `.env` is gitignored, so it can and should receive the generated value — otherwise the app cannot boot
  without a manual edit and the goal fails on its last step.
- Both injections go through the existing `builder.addInjection`. The fallback-to-printed-hint path
  stays, for projects Atlas did not scaffold.

### M5 — CRUD rewrite: fields, persistence, options

- `src/engine/template/region-filter.ts`, applied before `token-replacer`, reusing `REGION_BEGIN` and
  `REGION_END`. `template.json` gains a `features` array, and
  [validate-templates.ts](../scripts/validate-templates.ts) checks every region is balanced,
  non-overlapping, and declared.
- **Delete Zod from CRUD.** `models/__ENTITY_KEBAB__.model.ts` is currently four Zod schemas and
  nothing else; it becomes a declared interface plus hand-written validators, keeping the `limit` cap
  and the empty-PATCH rejection.
- `src/generators/crud/field-spec.ts` — parser for `name:string:required`. Types `string`, `text`,
  `number`, `integer`, `boolean`, `date`, `email`, `url`; modifiers `required`, `unique`, `index`.
  Per-line errors that echo the offending line and re-prompt rather than aborting the run.
- `src/generators/crud/field-mapping.ts` — one field spec to Mongoose, Prisma, Sequelize, a validator,
  and a TypeScript type.
- New comment-position tokens in [tokens.ts](../src/constants/tokens.ts), and indentation-aware
  substitution in `token-replacer.ts`.
- CRUD gains real persistence per ORM — repository plus model — keeping the in-memory store as the
  `None` option, which is what it already is.
- Options: pagination, search, sorting, filtering, soft delete, timestamps. **Pagination and search
  already exist**, so they become regions rather than new code.
- The default field set stays `name` + `description` so `atlas crud User --yes` keeps working, but
  [crud-generator.test.ts](../tests/unit/crud-generator.test.ts) needs rewriting either way — it
  asserts `plan.dependencies` is exactly `[zod]`.

### M6 — JavaScript template set

- `templates/auth/files/ts/**` and `templates/auth/files/js/**`, same for crud. `template.json` gains a
  `languages` map giving each language its own files root and devDependencies — so JS pulls no
  `@types/*`, and no version literal moves into code.
- One focused change at [template-loader.ts:75](../src/engine/template/template-loader.ts#L75):
  `filesRoot` becomes language-aware. An absent `languages` map means today's `files/`, so the five
  untouched templates need no edits at all.
- **The JS gate is `tsc --checkJs --noEmit` against JSDoc**, not `node --check`. Syntax-only checking
  would make "handwritten quality" unverifiable. Interface-only files become `@typedef` blocks.
- Relax `requires.language` on auth and crud only. `atlas list` then correctly shows those two as
  available in a JavaScript project and the other five as not.
- Extend [check-generated-output.ts](../scripts/check-generated-output.ts) to loop the matrix: two
  languages × three ORMs × CRUD options on / off. Log what was covered — a gate that silently samples
  reads as "covered everything".

### M7 — Real-project testing, then publish `0.x`

Five projects, deliberately different: one Mongoose, one Prisma, one Sequelize, one CommonJS, one
JavaScript. Five variations of the same ESM + Prisma app would all pass while most detection branches
stayed unproven.

Publish `0.1.0` early rather than at the end. `0.x` means unstable by definition, it secures the name,
it resolves the `@mohdsuhel` scope question while that is still cheap, and it makes the release pipeline
fail at a moment when failing is free. See [publishing.md](./publishing.md).

---

## Cost

Dropping email verification, forgot password, and the hashing choice takes roughly 15 files out of the
plan. Adding Sequelize and the JavaScript set puts them back: auth lands near 22 files per language,
CRUD near 12, so auth + crud finish around **70 template files** rather than the ~100 the previous
version of this plan implied.

Removing Zod is not free either — it is the one change that makes existing, working, verified code
worse before it gets better, and hand-written validation is where bugs will concentrate. That is why the
`limit` cap and the empty-PATCH rejection are called out above as things to preserve: they are the two
behaviours most likely to be quietly lost in the rewrite.

If v1.0 needs to land sooner, the highest-ratio cut is still **M6**: close to half the remaining work,
and the only milestone that adds no capability the TypeScript path already has.

---

## Verification

Per milestone:

1. `npm run verify` — typecheck, lint, format, tests, build
2. `npm run validate:templates` — manifests, tokens, and now regions; every rendered combination
   typechecks

End to end, in a scratch directory outside the repo — the only honest check:

```bash
npm run build && npm link
mkdir ../atlas-e2e && cd ../atlas-e2e

atlas init                 # answer the wizard
atlas auth                 # signup, login, me, refresh, logout, roles
atlas crud                 # paste a field block

npm install
npx tsc --noEmit           # generated code compiles
npm run dev                # the server actually boots
```

Then exercise it for real: sign up, log in, call `/auth/me` with the token and without one, hit the
admin-only route as a `user` and confirm the 403, refresh, reuse a rotated refresh token and confirm the
family is revoked, and run the CRUD endpoints with pagination and search. Finally:

```bash
npm unlink @mohdsuhel/atlas && npx tsc --noEmit   # still compiles with Atlas gone
```

That last command is the one that matters. Every other check can pass while Atlas has quietly leaked a
dependency on itself into the generated code.
