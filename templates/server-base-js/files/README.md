# __PROJECT_NAME__

An Express 5 + Mongoose API server on modern Node ESM JavaScript.

## Running it

```bash
cp .env.example .env    # then set MONGODB_URI and both JWT secrets
npm install
npm run dev             # nodemon, restarts on change
```

`npm start` runs it without the watcher. `src/config/env.js` validates the environment at import time and exits with a list of every problem it found, so a
missing variable is a message rather than a crash on the first request that needed it.

## Layout

```
src/
  app.js                     the Express app: middleware, routes, error handling
  server.js                  boots it: database first, then listen; graceful shutdown
  config/
    env.js                   reads and validates process.env, exits on a bad configuration
    db.js                    mongoose connect/disconnect and connection event logging
  middleware/
    error-handler.js         the one place a failure becomes a response
    not-found.js             throws a 404 so unmatched routes use the same envelope
  routes/
    index.js                 the /api router
    health.routes.js         GET /api/health
  utils/
    api-error.js             ApiError: statusCode, message, errors
    api-response.js          the response envelope and the res.api helper
    async-handler.js         forwards async rejections to the error handler
    capitalize-words.js      shared message casing
```

## The response envelope

Every response — success or failure — has the same shape, so a client parses one thing:

```jsonc
{
  "statusCode": 200,
  "success": true,
  "message": "Service Is Healthy",
  "data": { "ok": true, "uptime": 12, "timestamp": "2026-01-01T00:00:00.000Z" },
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

`responseMiddleware` is mounted before the routes and attaches `res.api` to every response:

```js
res.api(200, 'User created', user); // full form
res.api(200, { user }); // shorthand: a plain object is the payload
res.api(200, 'Users', users, { page: 1, total: 120 }); // with meta
```

`responseMiddleware` is the only thing that defines `res.api`, so the envelope has exactly one
implementation.

## Errors

Throw an `ApiError` and the handler does the rest:

```js
import ApiError from '../utils/api-error.js';

if (user === null) throw new ApiError(404, 'user not found');
```

Failures the handler translates for you, so they do not surface as an opaque 500:

| Thrown                          | Response                                     |
| ------------------------------- | -------------------------------------------- |
| Mongoose `CastError`            | `400 Invalid <path>`                          |
| Mongoose `ValidationError`      | `400 Validation Failed` with one `errors` entry per path |
| Duplicate key (`11000`)         | `409 <field> Already Exists`                  |
| `TokenExpiredError`             | `401 Session Expired, Please Sign In Again`   |
| `JsonWebTokenError`             | `401 Invalid Authentication Token`            |
| Anything else                   | `500 Something Went Wrong`                    |

The failure body carries `stack` only when `NODE_ENV` is not `production`, and a 500's message is
never taken from the underlying error.

Express 5 forwards rejections from async handlers on its own; `asyncHandler` wraps one explicitly
where you want the forwarding stated at the call site.

## Configuration

`src/config/env.js` is the only module that reads `process.env`. It runs before anything else in
`src/server.js`, validates every variable, collects **all** the problems it finds and prints them
as one list, then exits non-zero. A misconfigured server never reaches "listening".

Everything else imports the frozen `config` object, so `config.port` is already a number and
`config.dbAutoIndex` is already a boolean — no coercion at use sites, and no defaults scattered
across the codebase.

| Variable            | Required | Default                  | Validated as                                     |
| ------------------- | -------- | ------------------------ | ------------------------------------------------ |
| `NODE_ENV`          | no       | `development`            | one of `development`, `test`, `production`        |
| `PORT`              | no       | `5000`                   | whole number, 1–65535 (`3000abc` is rejected)     |
| `MONGODB_URI`       | **yes**  | —                        | starts with `mongodb://` or `mongodb+srv://`      |
| `DB_AUTO_INDEX`     | no       | `false`                  | exactly `true` or `false`                         |
| `CLIENT_URL`        | no       | `http://localhost:5173`  | absolute URL — it is the CORS allowlist           |
| `JWT_ACCESS_SECRET` | **yes**  | —                        | ≥ 32 characters, not the `.env.example` placeholder |
| `JWT_REFRESH_SECRET`| **yes**  | —                        | ≥ 32 characters, not the `.env.example` placeholder |
| `JWT_ACCESS_TTL`    | no       | `15m`                    | duration such as `15m`, `24h`, `7d`               |
| `JWT_REFRESH_TTL`   | no       | `7d`                     | duration such as `15m`, `24h`, `7d`               |

Generate the secrets with `openssl rand -base64 48`. Booting with the placeholders from
`.env.example` is refused: a deployed project signing tokens with the example secret has no
authentication at all. The JWT values are consumed by whatever auth layer you add on top; the
server validates them here so the failure is at boot rather than at the first login.

Secret **values** are never printed. An error message names the variable and, for a too-short
secret, its length. The startup line logs `describeConfig()`, which omits both JWT secrets and
strips any credentials out of the connection string.

## Shutdown

`SIGINT` and `SIGTERM` stop the listener, drain in-flight requests, close Mongoose, and exit 0.
A shutdown that has not finished within 10 seconds exits 1 rather than hanging.
