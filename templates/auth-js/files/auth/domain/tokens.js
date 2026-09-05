/**
 * The claim shapes carried by the two token types.
 *
 * Declarations only — this module holds no runtime code. It exists so the claim contract is written
 * down once and referenced by the token service, the auth middleware and the controller, instead of
 * being re-guessed at each site from whatever `jwt.verify` happened to return.
 */

/**
 * Claims carried by an access token.
 *
 * The role and the display name are embedded so authorisation and `/me` need no database round
 * trip. The cost is staleness: a role change, or a renamed account, only takes effect when the
 * access token expires — which is why access-token lifetimes are short. Revoking immediately means
 * revoking the refresh family and forcing a re-login.
 *
 * @typedef {object} AccessTokenClaims
 * @property {string} sub The user id.
 * @property {string} email
 * @property {string} name
 * @property {import('./user__IMPORT_SUFFIX__').Role} role
 * @property {string} jti Unique token id, so a specific access token can be identified in logs.
 */

/**
 * Claims carried by a refresh token.
 *
 * `family` is what makes reuse detection possible: every token descended from one login shares it,
 * so presenting an already-rotated token can revoke the whole lineage rather than just the one
 * credential an attacker replayed.
 *
 * @typedef {object} RefreshTokenClaims
 * @property {string} sub
 * @property {string} jti
 * @property {string} family
 */

/**
 * @typedef {object} TokenPair
 * @property {string} accessToken
 * @property {string} refreshToken
 * @property {Date} accessTokenExpiresAt
 * @property {Date} refreshTokenExpiresAt
 */

/**
 * A freshly issued pair, plus the bookkeeping the repository needs to persist.
 *
 * @typedef {TokenPair & { refreshJti: string, family: string }} IssuedTokens
 */

export {};
