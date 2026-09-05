/**
 * What the auth module needs from the application's configuration.
 *
 * This file deliberately parses nothing. Environment reading, coercion and the "collect every
 * error, then fail once" behaviour all live in `src/config/env.js`, and duplicating any of it here
 * would create a second failure path: a deployment could pass the central validator and then die
 * later, separately, with a different message about the same variable. One validator, one report,
 * one exit.
 *
 * What lives here instead is the *declaration* — which keys auth requires, what each one is for, and
 * what happens if it is wrong. `collectAuthConfigIssues` is written to be called by the central
 * validator so that a missing `JWT_ACCESS_SECRET` is listed alongside a missing `MONGODB_URI` in the
 * one report the operator reads, rather than being discovered on the first login attempt.
 *
 * Wire it in `src/config/env.js`:
 *
 *   import { collectAuthConfigIssues } from '../auth/config/env-schema.js';
 *   issues.push(...collectAuthConfigIssues(candidate));
 *
 * If it is never wired in, nothing is silently skipped: `auth-config.js` runs the same check on
 * first use, so the failure is late rather than absent.
 */

/**
 * Below this, HS256 is brute-forceable offline: an attacker with one token can grind candidate keys
 * locally at full speed, with no rate limit to stop them.
 */
export const MIN_SECRET_LENGTH = 32;

/**
 * One configuration key the auth module reads.
 *
 * @typedef {object} ConfigRequirement
 * @property {string} key The property name on the resolved config object.
 * @property {string} env The environment variable it is resolved from, for the error message.
 * @property {'string' | 'number' | 'boolean'} kind
 * @property {boolean} required
 * @property {number} [minLength] Applies to strings only.
 * @property {string} why What breaks if it is absent or wrong.
 */

/**
 * The full list, in the order an operator would want to see it reported.
 *
 * Only the first three are required, and all three are already resolved by `src/config/env.js`.
 * Everything after them has a safe default applied in `auth-config.js`, chosen so that an
 * unconfigured deployment is *secure* rather than merely working — a short access-token lifetime, a
 * `Secure` cookie, a real bcrypt cost.
 *
 * The last four are not read by `src/config/env.js` today. They are declared anyway, so the module
 * states its whole surface in one place: add them there when you want them configurable, and this
 * list is already the specification of what to add.
 *
 * `jwtAccessTtl` and `jwtRefreshTtl` are declared as plain strings, not durations. The central
 * validator already owns their format; re-checking it here would report the same typo twice in the
 * same boot report.
 *
 * @type {readonly ConfigRequirement[]}
 */
export const AUTH_CONFIG_REQUIREMENTS = Object.freeze([
  Object.freeze({
    key: 'jwtAccessSecret',
    env: 'JWT_ACCESS_SECRET',
    kind: 'string',
    required: true,
    minLength: MIN_SECRET_LENGTH,
    why: 'Signs and verifies access tokens. There is deliberately no default: a fallback secret would work in development, survive review, and ship — at which point every deployment that forgot to set it shares a signing key with every other one.',
  }),
  Object.freeze({
    key: 'jwtRefreshSecret',
    env: 'JWT_REFRESH_SECRET',
    kind: 'string',
    required: true,
    minLength: MIN_SECRET_LENGTH,
    why: 'Signs and verifies refresh tokens. Kept separate from the access secret so a leak of one cannot mint the other — an access secret disclosed through a log or a debug endpoint must not be enough to forge a week-long credential.',
  }),
  Object.freeze({
    key: 'nodeEnv',
    env: 'NODE_ENV',
    kind: 'string',
    required: true,
    why: 'Decides the refresh cookie\u2019s Secure and SameSite attributes. Getting it wrong in production means sending a refresh token over cleartext.',
  }),
  Object.freeze({
    key: 'jwtAccessTtl',
    env: 'JWT_ACCESS_TTL',
    kind: 'string',
    required: false,
    why: 'How long a role change takes to land. Short by design, because authorisation is decided from the token without a database round trip.',
  }),
  Object.freeze({
    key: 'jwtRefreshTtl',
    env: 'JWT_REFRESH_TTL',
    kind: 'string',
    required: false,
    why: 'How long a session survives without a login.',
  }),
  Object.freeze({
    key: 'jwtIssuer',
    env: 'JWT_ISSUER',
    kind: 'string',
    required: false,
    why: 'The `iss` claim, required on every token this service verifies. Not read by src/config/env.js yet; auth defaults it.',
  }),
  Object.freeze({
    key: 'jwtAudience',
    env: 'JWT_AUDIENCE',
    kind: 'string',
    required: false,
    why: 'The `aud` claim, required on every token. Without it, any service sharing the secret could mint credentials that authenticate here. Not read by src/config/env.js yet; auth defaults it.',
  }),
  Object.freeze({
    key: 'authCookieName',
    env: 'AUTH_COOKIE_NAME',
    kind: 'string',
    required: false,
    why: 'The refresh cookie\u2019s name. Changing it after deployment signs everyone out. Not read by src/config/env.js yet; auth defaults it.',
  }),
  Object.freeze({
    key: 'bcryptRounds',
    env: 'BCRYPT_ROUNDS',
    kind: 'number',
    required: false,
    why: 'The password hashing cost factor. Raising it also means regenerating TIMING_DECOY_HASH in services/auth-service.js. Not read by src/config/env.js yet; auth defaults it.',
  }),
]);

/**
 * Every problem with the auth-relevant slice of a resolved config, as human-readable strings.
 *
 * Returns them all rather than throwing on the first, so the caller can merge them into one report.
 * Presence and shape only — no coercion, no defaulting, no reading of `process.env`. A value that is
 * absent but optional is not an issue here; `auth-config.js` supplies the default.
 *
 * @param {Record<string, unknown> | undefined | null} config The resolved config object.
 * @returns {string[]}
 */
export function collectAuthConfigIssues(config) {
  if (typeof config !== 'object' || config === null) {
    return ['auth: the resolved configuration object is missing.'];
  }

  /** @type {string[]} */
  const issues = [];

  for (const requirement of AUTH_CONFIG_REQUIREMENTS) {
    const value = /** @type {Record<string, unknown>} */ (config)[requirement.key];

    if (value === undefined || value === null || value === '') {
      if (requirement.required) {
        issues.push(`${requirement.env} is not set. ${requirement.why}`);
      }

      continue;
    }

    if (requirement.kind === 'number') {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        issues.push(`${requirement.env} must resolve to a positive whole number.`);
      }

      continue;
    }

    if (requirement.kind === 'boolean') {
      if (typeof value !== 'boolean') {
        issues.push(`${requirement.env} must resolve to a boolean.`);
      }

      continue;
    }

    if (typeof value !== 'string') {
      issues.push(`${requirement.env} must resolve to a string.`);
      continue;
    }

    if (requirement.minLength !== undefined && value.length < requirement.minLength) {
      // The length is named; the value never is. An error message that echoed a too-short secret
      // would print it into the container log, which is the one place a secret must never appear.
      issues.push(`${requirement.env} must be at least ${requirement.minLength} characters.`);
    }
  }

  return issues;
}

/**
 * Throws once, listing everything wrong, or returns cleanly.
 *
 * The backstop for the case where `collectAuthConfigIssues` was never wired into the central
 * validator. A misconfigured auth module must not serve traffic: the alternative — defaulting
 * something and carrying on — means the failure surfaces at the first login in production, by which
 * time the signal is a support ticket rather than a failed deploy.
 *
 * @param {Record<string, unknown> | undefined | null} config
 * @returns {void}
 */
export function assertAuthConfigSatisfied(config) {
  const issues = collectAuthConfigIssues(config);

  if (issues.length === 0) {
    return;
  }

  throw new Error(
    `Invalid auth configuration:\n  - ${issues.join('\n  - ')}\n` +
      'Fix these in your environment; the auth module will not start without them.',
  );
}
