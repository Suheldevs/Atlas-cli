# __PROJECT_NAME__ — web client

A Vite + React single-page app in strict TypeScript, wired to the API in `../server`. It is a real client, not a shell:
sign-up, sign-in, session restore, silent token refresh and sign-out all work against the live API
the moment both halves are running.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:5173. Start the API in `../server` first — this package and that one are
independent, and neither installs the other.

| Script            | Does                                            |
| ----------------- | ----------------------------------------------- |
| `npm run dev`     | Dev server on :5173, with `/api` proxied to :5000 |
| `npm run build`   | Typechecks with `tsc`, then bundles into `dist/`  |
| `npm run preview` | Serves the built bundle locally                   |

## Configuration

Copy `.env.example` to `.env` only if you need to change something. By default the client calls the
relative path `/api`, which the Vite dev server proxies to `http://localhost:5000` — see
`vite.config.mts`.

Being same-origin is not cosmetic. The refresh token lives in an `httpOnly`, `sameSite=strict`
cookie, and a strict cookie is not sent on cross-site requests, so a client that talks to the API on
another origin can sign in once and then never refresh. Set `VITE_API_URL` only when the two are
genuinely deployed apart, and configure CORS on the API to allow credentials from this origin.

One related gotcha: the refresh cookie's `Path` has to cover the URL the client refreshes at. If the
auth router is mounted at `/api/auth`, the cookie's path must be `/api/auth` (or `/`) — a cookie
scoped to `/auth` will never be sent to `/api/auth/refresh`, and the failure looks like "my session
ends after fifteen minutes" rather than like a cookie problem.

## How authentication works

The access token is kept **in a module variable** in `src/lib/api.ts` and nowhere else. Not
`localStorage`, not `sessionStorage`, not a script-readable cookie — all of which are readable by
any JavaScript that reaches the page, so a single XSS or one bad dependency walks off with a
credential that outlives the tab. A variable dies with the page.

The refresh token is never seen by this code at all. It lives in an `httpOnly` cookie the browser
attaches by itself, which is why `withCredentials: true` is set on the axios instance.

That gives one flow that covers both "the token expired" and "the page was reloaded":

1. A request goes out with `Authorization: Bearer <access token>`, if there is one.
2. The API answers `401`.
3. The response interceptor calls `POST /api/auth/refresh` **once**, spending the cookie.
4. On success it stores the new access token in memory and replays the original request.
5. On failure it clears the session, and the route guards send the visitor to `/login`.

Step 3 is guarded twice so it cannot loop: the refresh call itself is never retried, and every
request carries a flag that allows at most one retry. Concurrent 401s share a single in-flight
refresh, so four failing requests cause one rotation rather than four.

Session restore on load falls out of the same mechanism. `AuthProvider` simply calls
`GET /api/auth/me`; with no token in memory that answers `401`, the interceptor refreshes, and the
retry succeeds.

## Response envelope

Every API response is wrapped:

```jsonc
// success
{ "statusCode": 200, "success": true, "message": "...", "data": { ... }, "timestamp": "..." }
// failure
{ "success": false, "statusCode": 400, "message": "...", "errors": [ ... ], "timestamp": "..." }
```

`src/lib/api.ts` is the only file that knows this. A response interceptor unwraps `data`, so callers
write `http.get<MePayload>('/auth/me')` and receive the payload directly. Failures are normalised into an
`ApiError` carrying `message`, `errors`, and a `fieldErrors` map — which is what lets the sign-in and
sign-up forms print a server-side validation problem under the input that caused it instead of
showing "Request failed with status code 400".

## Layout

```
src/
  lib/api.ts             axios instance, shared types, in-memory token, envelope unwrap, retry
  context/AuthContext.tsx user + loading state, login / signup / logout, session restore on mount
  routes/                 ProtectedRoute and PublicOnlyRoute
  pages/                  Login, Signup, Dashboard, NotFound
  components/             AuthLayout, TextField, SubmitButton, Alert, BrandMark
  styles/index.css        design tokens, light and dark, one place to retheme
  vite-env.d.ts           the environment variables this app reads, declared once
```

`User`, `AuthPayload`, `LoginInput`, `SignupInput` and `FieldErrors` all live in `src/lib/api.ts`,
next to the calls that produce them. Every source file is `.tsx`, including the ones with no JSX in
them, so the extension never has to be a question when a module grows a component.

## Adding an authenticated call

```ts
import { http } from '../lib/api';

interface Project {
  readonly id: string;
  readonly name: string;
}

const projects = await http.get<readonly Project[]>('/projects');
```

`http.get<T>()` states what the *unwrapped* payload is — the envelope never reaches the call site.

Nothing else is needed. The bearer header, the envelope and the refresh-on-401 are already handled.
