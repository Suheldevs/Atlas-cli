import type { Role } from './user__IMPORT_SUFFIX__';

/**
 * Claims carried by an access token.
 *
 * The role is embedded so authorisation needs no database round trip. The cost is that a role
 * change only takes effect when the access token expires — which is why access-token lifetimes
 * are short. Revoking immediately means revoking the refresh family and forcing a re-login.
 */
export interface AccessTokenClaims {
  readonly sub: string;
  readonly email: string;
  readonly role: Role;
  /** Unique token id, so a specific access token can be identified in logs. */
  readonly jti: string;
}

/**
 * Claims carried by a refresh token.
 *
 * `family` is what makes reuse detection possible: every token descended from one login shares
 * it, so presenting an already-rotated token can revoke the whole lineage rather than just the
 * one credential an attacker replayed.
 */
export interface RefreshTokenClaims {
  readonly sub: string;
  readonly jti: string;
  readonly family: string;
}

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshTokenExpiresAt: Date;
}

/** A freshly issued pair, plus the bookkeeping the repository needs to persist. */
export interface IssuedTokens extends TokenPair {
  readonly refreshJti: string;
  readonly family: string;
}
