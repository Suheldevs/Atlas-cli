/** Small pure string helpers. No I/O, no state. */

/**
 * Levenshtein distance, iterative with a single row.
 *
 * Only ever runs over a handful of short generator names, so clarity beats the classic
 * matrix implementation.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_unused, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];

    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const insertion = (current[j - 1] ?? 0) + 1;
      const deletion = (previous[j] ?? 0) + 1;
      current.push(Math.min(substitution, insertion, deletion));
    }

    previous = current;
  }

  return previous[b.length] ?? 0;
}

/**
 * Nearest candidate to `value`, or undefined when nothing is close enough.
 *
 * The threshold scales with length so `crud` → `crd` matches while two unrelated short
 * words do not — a bad suggestion is more annoying than no suggestion.
 */
export function closestMatch(value: string, candidates: readonly string[]): string | undefined {
  const threshold = Math.max(2, Math.floor(value.length / 2));
  let best: { candidate: string; distance: number } | undefined;

  for (const candidate of candidates) {
    const distance = editDistance(value.toLowerCase(), candidate.toLowerCase());
    if (distance <= threshold && (best === undefined || distance < best.distance)) {
      best = { candidate, distance };
    }
  }

  return best?.candidate;
}

/** Pluralises a count for user-facing messages: `1 file`, `3 files`. */
export function describeCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}
