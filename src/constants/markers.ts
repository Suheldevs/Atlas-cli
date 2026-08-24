/**
 * The anchor comments Atlas reads and writes.
 *
 * These strings are a permanent part of Atlas's public contract. Once a generator has
 * written `// atlas:routes` into somebody's `router.ts`, that comment lives in their
 * repository forever, and every future version of Atlas has to keep finding it there.
 * So: add new names freely, but never rename, re-spell, or re-punctuate one that has
 * shipped — a marker that drifts turns a working project into one Atlas can no longer
 * inject into, with no error the user can act on.
 *
 * The vocabulary is kept deliberately tiny. Each name below marks one place where
 * generated code legitimately has to meet code the user owns; anything more specific
 * belongs in the generator, not in a marker.
 */

/** Namespace on every marker, so a project-wide search for `atlas:` finds all of them. */
export const MARKER_PREFIX = 'atlas:';

/**
 * Well-known anchor names.
 *
 * - `routes` — where an Express-style router registers its sub-routers.
 * - `middleware` — where the application installs middleware, order-sensitive.
 * - `env-schema` — where the environment schema declares its variables.
 */
export const MARKERS = {
  routes: 'routes',
  middleware: 'middleware',
  envSchema: 'env-schema',
} as const;

export type MarkerName = (typeof MARKERS)[keyof typeof MARKERS];

/**
 * Builds the line comment for an anchor.
 *
 * A real `//` comment rather than a bare token, so the marker is valid TypeScript wherever
 * a generator drops it and survives a pass of the project's formatter untouched.
 */
export function anchorComment(name: string): string {
  return `// ${MARKER_PREFIX}${name}`;
}

/** `// atlas:routes` */
export const ROUTES_ANCHOR = anchorComment(MARKERS.routes);

/** `// atlas:middleware` */
export const MIDDLEWARE_ANCHOR = anchorComment(MARKERS.middleware);

/** `// atlas:env-schema` */
export const ENV_SCHEMA_ANCHOR = anchorComment(MARKERS.envSchema);

/**
 * Delimiters for a block of generated code inside a file the user also edits.
 *
 * The named form is what generators should use: a region tagged with the feature that owns
 * it can be located, replaced, or removed later without touching a neighbouring region.
 */
export function regionBegin(name: string): string {
  return `${anchorComment('begin')} ${name}`;
}

export function regionEnd(name: string): string {
  return `${anchorComment('end')} ${name}`;
}

/** Prefix shared by every begin line, for callers that need to detect regions generically. */
export const REGION_BEGIN = anchorComment('begin');

/** Prefix shared by every end line. */
export const REGION_END = anchorComment('end');
