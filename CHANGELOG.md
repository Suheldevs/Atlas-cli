# @mohdsuhel/atlas

## 0.2.0

### Minor Changes

- Add `atlas start <name>` — scaffold a complete full-stack project from an empty directory.

  Until now Atlas could only generate into a project that already existed: in a fresh directory
  every generator reported "needs express, found unknown" and there was nothing to do. `start`
  closes that gap, and it is the first command that creates a project rather than extending one.

  It generates two independent packages, `client/` and `server/`, each with its own
  `package.json` and no root manifest, so either half can be split into its own repository later
  without unpicking a workspace.

  - **Language selection.** Prompts for JavaScript or TypeScript, or takes `--language <js|ts>`.
    The TypeScript path reuses the existing, compile-verified templates; JavaScript gets a new
    hand-written template set rather than a mechanical strip of the types.
  - **Server:** Express 5 + Mongoose, with JWT auth (signup, login, me, refresh with rotation and
    reuse detection, logout), a CRUD resource, file uploads and structured logging.
  - **Consistent responses.** Every endpoint answers through one envelope — `ApiError` for
    failures, `res.api(status, message, data, meta)` for successes — and the error handler
    translates Mongoose `CastError`, `ValidationError` and duplicate-key `11000` into proper
    status codes instead of leaking a 500.
  - **Client:** Vite + React with react-router, an axios layer that unwraps the envelope and
    refreshes an expired access token exactly once, an auth context holding the access token in
    memory (never `localStorage`), and working login, signup and protected pages.

  The generated project keeps Atlas's core guarantee: nothing in it imports Atlas, so it runs
  unchanged after Atlas is uninstalled.
