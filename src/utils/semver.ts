/**
 * The smallest semver subset dependency planning actually needs.
 *
 * Atlas ships no runtime dependency of its own, so there is no `semver` package to lean on.
 * Everything here exists to answer one question — "is the range the project already declares
 * good enough for the range a template asks for?" — and it is honest about being an
 * approximation of that answer.
 *
 * Known limits, all deliberate: prerelease and build metadata are ignored rather than ordered
 * (`1.0.0-rc.2` compares equal to `1.0.0`), ranges are never intersected, and forms this module
 * does not recognise — hyphen ranges such as `1.2.3 - 2.0.0`, tags such as `latest`, git and
 * tarball URLs — are reported as unknown instead of being guessed at. Callers must treat
 * "unknown" as "leave the project alone", which is why every unknown answer here is `undefined`
 * rather than a fabricated version.
 */

export interface SemanticVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

interface ComparatorBound {
  /** Undefined when the comparator constrains only the upper end, as `<2.0.0` does. */
  readonly lowerBound: string | undefined;
}

/** The minimum of a range with no lower bound at all: `*`, `<2.0.0`, or an empty range. */
const ZERO_VERSION = '0.0.0';

/** Segment wildcards, as used in `1.2.x` and `1.*`. */
const WILDCARD_SEGMENTS = new Set(['x', 'X', '*']);

const VERSION_PATTERN = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+][\w.-]+)?$/u;

/**
 * One comparator: an optional operator, an optional `v`, and up to three numeric or wildcard
 * segments, with any prerelease or build suffix tolerated and discarded.
 */
const COMPARATOR_PATTERN =
  /^(\^|~>|~|>=|<=|>|<|=)?v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:[-+][\w.-]+)?$/u;

/** Operators that constrain only the top of a range, and so say nothing about its minimum. */
const UPPER_BOUND_OPERATORS = new Set(['<', '<=']);

/** npm allows a space between the operator and the version; comparators are split on space. */
const OPERATOR_SPACING_PATTERN = /(>=|<=|~>|[\^~><=])\s+/gu;

/** Ranges that resolve outside the registry, and that Atlas must never try to "upgrade". */
const LOCAL_RANGE_PREFIXES = ['workspace:', 'file:', 'link:', 'catalog:', 'portal:'] as const;

export function parseVersion(value: string): SemanticVersion | undefined {
  const match = VERSION_PATTERN.exec(stripLeadingV(value.trim()));
  if (match === null) return undefined;

  return {
    major: Number(match[1] ?? '0'),
    minor: Number(match[2] ?? '0'),
    patch: Number(match[3] ?? '0'),
  };
}

/**
 * Orders two version strings, negative when `a` is lower.
 *
 * Unparseable input orders before every real version rather than throwing, so the function
 * stays usable as a comparator in the middle of a sort.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);

  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return -1;
  if (right === undefined) return 1;

  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

/**
 * The lowest concrete version a range admits, normalised to `major.minor.patch`.
 *
 * Returns undefined for ranges this module cannot read, which callers must treat as "no
 * opinion" rather than as `0.0.0`.
 */
export function extractMinimumVersion(range: string): string | undefined {
  const trimmed = range.trim();
  // An empty range is npm's "any version".
  if (trimmed === '') return ZERO_VERSION;

  let lowest: string | undefined;

  // `a || b` is a union, so the union's minimum is the lowest of its branches. One unreadable
  // branch makes the whole union unreadable: the true minimum could be inside it.
  for (const branch of trimmed.split('||')) {
    const candidate = branchMinimum(branch);
    if (candidate === undefined) return undefined;
    if (lowest === undefined || compareVersions(candidate, lowest) < 0) lowest = candidate;
  }

  return lowest;
}

/**
 * Whether what the project already declares is good enough for what a template requires.
 *
 * This is an intentional approximation: it compares the two ranges' minimum versions and
 * nothing else, so it can neither detect a genuine upper-bound clash nor prove real
 * compatibility. Its only job is deciding whether Atlas should leave a dependency alone, and
 * it is biased toward exactly that — an unreadable range on either side counts as satisfied,
 * because reinstalling on a guess would rewrite a version the user may have pinned on purpose.
 */
export function rangeSatisfiedBy(installedRange: string, requiredRange: string): boolean {
  const required = extractMinimumVersion(requiredRange);
  if (required === undefined) return true;

  const installed = extractMinimumVersion(installedRange);
  if (installed === undefined) return true;

  return compareVersions(installed, required) >= 0;
}

/**
 * Ranges that point at something other than the registry: a sibling workspace package, a
 * directory, a symlink, or a pnpm catalog entry.
 */
export function isWorkspaceOrLocalRange(range: string): boolean {
  const normalized = range.trim().toLowerCase();
  return LOCAL_RANGE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function stripLeadingV(value: string): string {
  return value.startsWith('v') || value.startsWith('V') ? value.slice(1) : value;
}

/**
 * The effective lower bound of one space-separated comparator set, where the comparators are
 * ANDed together — so the set's minimum is the *highest* of its lower bounds.
 */
function branchMinimum(branch: string): string | undefined {
  const tokens = branch.replace(OPERATOR_SPACING_PATTERN, '$1').trim().split(/\s+/u);

  let bound: string | undefined;

  for (const token of tokens) {
    if (token === '') continue;

    const comparator = comparatorBound(token);
    if (comparator === undefined) return undefined;

    // An upper-bound-only comparator leaves the minimum where it was.
    const { lowerBound } = comparator;
    if (lowerBound === undefined) continue;

    if (bound === undefined || compareVersions(lowerBound, bound) > 0) bound = lowerBound;
  }

  // A set of nothing but upper bounds (`<2.0.0`) really does admit `0.0.0`.
  return bound ?? ZERO_VERSION;
}

/**
 * The bound a single comparator imposes, or undefined when the comparator is not understood.
 *
 * `^1.2.3`, `~1.2.3`, `>=1.2.3`, `>1.2.3` and `1.2.3` all share the same lower bound here.
 * Treating `>1.2.3` as inclusive is one patch release too generous, which only ever errs toward
 * leaving an installed dependency alone.
 */
function comparatorBound(token: string): ComparatorBound | undefined {
  const match = COMPARATOR_PATTERN.exec(token);
  if (match === null) return undefined;

  if (UPPER_BOUND_OPERATORS.has(match[1] ?? '')) return { lowerBound: undefined };

  const major = segmentValue(match[2]);
  const minor = segmentValue(match[3]);
  const patch = segmentValue(match[4]);

  return { lowerBound: `${String(major)}.${String(minor)}.${String(patch)}` };
}

/** A missing or wildcard segment contributes zero: the lowest version `1.2.x` admits is `1.2.0`. */
function segmentValue(segment: string | undefined): number {
  if (segment === undefined || WILDCARD_SEGMENTS.has(segment)) return 0;
  return Number(segment);
}
