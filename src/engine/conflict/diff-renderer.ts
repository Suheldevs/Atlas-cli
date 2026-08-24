export interface DiffOptions {
  /** ANSI is opt-in per call so the renderer stays pure and its output stays assertable. */
  readonly color: boolean;
  readonly existingLabel?: string;
  readonly incomingLabel?: string;
  readonly context?: number;
}

interface DiffLine {
  readonly sign: ' ' | '-' | '+';
  readonly text: string;
}

// Built from the char code rather than written as a literal escape byte, which is invisible in
// a review diff and trivially destroyed by an editor that normalises control characters.
const ESC = String.fromCharCode(0x1b);
const RED = `${ESC}[31m`;
const GREEN = `${ESC}[32m`;
const CYAN = `${ESC}[36m`;
const RESET = `${ESC}[39m`;

function splitLines(text: string): readonly string[] {
  const normalised = text.replace(/\r\n/gu, '\n');
  const lines = normalised.split('\n');
  // A trailing newline terminates the last line rather than starting an empty one; keeping the
  // empty string would report a phantom change whenever only one file ends with a newline.
  return lines.at(-1) === '' && lines.length > 1 ? lines.slice(0, -1) : lines;
}

/**
 * Longest-common-subsequence line diff.
 *
 * A positional line-by-line comparison is useless for source code: inserting one import shifts
 * every following line, and the diff then claims the whole file changed. The table is O(n·m),
 * which is why the caller trims the common prefix and suffix first — for a realistic edit that
 * leaves only the changed region to align.
 */
function alignLines(before: readonly string[], after: readonly string[]): DiffLine[] {
  const rows = before.length;
  const columns = after.length;
  const width = columns + 1;
  const lengths = new Uint32Array((rows + 1) * width);

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      lengths[i * width + j] =
        before[i] === after[j]
          ? (lengths[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(lengths[(i + 1) * width + j] ?? 0, lengths[i * width + j + 1] ?? 0);
    }
  }

  const aligned: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < rows && j < columns) {
    if (before[i] === after[j]) {
      aligned.push({ sign: ' ', text: before[i] ?? '' });
      i += 1;
      j += 1;
    } else if ((lengths[(i + 1) * width + j] ?? 0) >= (lengths[i * width + j + 1] ?? 0)) {
      aligned.push({ sign: '-', text: before[i] ?? '' });
      i += 1;
    } else {
      aligned.push({ sign: '+', text: after[j] ?? '' });
      j += 1;
    }
  }

  for (; i < rows; i += 1) aligned.push({ sign: '-', text: before[i] ?? '' });
  for (; j < columns; j += 1) aligned.push({ sign: '+', text: after[j] ?? '' });

  return aligned;
}

function diffLines(before: readonly string[], after: readonly string[]): DiffLine[] {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1;

  let tailBefore = before.length;
  let tailAfter = after.length;
  while (tailBefore > head && tailAfter > head && before[tailBefore - 1] === after[tailAfter - 1]) {
    tailBefore -= 1;
    tailAfter -= 1;
  }

  const context = (text: string): DiffLine => ({ sign: ' ', text });

  return [
    ...before.slice(0, head).map(context),
    ...alignLines(before.slice(head, tailBefore), after.slice(head, tailAfter)),
    ...before.slice(tailBefore).map(context),
  ];
}

/** Indices within `context` lines of a change, which is exactly what a hunk covers. */
function hunkMembership(lines: readonly DiffLine[], context: number): readonly boolean[] {
  const included = Array.from({ length: lines.length }, () => false);

  lines.forEach((line, index) => {
    if (line.sign === ' ') return;
    const from = Math.max(0, index - context);
    const to = Math.min(lines.length - 1, index + context);
    for (let i = from; i <= to; i += 1) included[i] = true;
  });

  return included;
}

function paint(line: DiffLine, color: boolean): string {
  const text = `${line.sign}${line.text}`;
  if (!color || line.sign === ' ') return text;
  return `${line.sign === '+' ? GREEN : RED}${text}${RESET}`;
}

/**
 * Unified diff of two file versions: `---`/`+++` headers, `@@` hunk markers, three lines of
 * context. Returns an empty string when the two sides are equal, so callers can treat "no diff"
 * as "nothing to show".
 */
export function renderUnifiedDiff(
  existing: string,
  incoming: string,
  options: DiffOptions,
): string {
  const context = options.context ?? 3;
  const lines = diffLines(splitLines(existing), splitLines(incoming));

  if (!lines.some((line) => line.sign !== ' ')) return '';

  const included = hunkMembership(lines, context);
  const output: string[] = [
    `--- ${options.existingLabel ?? 'existing'}`,
    `+++ ${options.incomingLabel ?? 'incoming'}`,
  ];

  let oldLine = 0;
  let newLine = 0;
  let index = 0;

  while (index < lines.length) {
    if (included[index] !== true) {
      const line = lines[index];
      if (line?.sign !== '+') oldLine += 1;
      if (line?.sign !== '-') newLine += 1;
      index += 1;
      continue;
    }

    const oldStart = oldLine;
    const newStart = newLine;
    const body: string[] = [];
    let oldCount = 0;
    let newCount = 0;

    while (index < lines.length && included[index] === true) {
      const line = lines[index];
      if (line === undefined) break;
      if (line.sign !== '+') oldCount += 1;
      if (line.sign !== '-') newCount += 1;
      body.push(paint(line, options.color));
      index += 1;
    }

    oldLine += oldCount;
    newLine += newCount;

    // Unified diff numbers hunks from 1, and a hunk with no lines on one side is anchored to the
    // line before it — hence the count-dependent offset.
    const oldRange = `${String(oldCount === 0 ? oldStart : oldStart + 1)},${String(oldCount)}`;
    const newRange = `${String(newCount === 0 ? newStart : newStart + 1)},${String(newCount)}`;
    const header = `@@ -${oldRange} +${newRange} @@`;
    output.push(options.color ? `${CYAN}${header}${RESET}` : header, ...body);
  }

  return output.join('\n');
}
