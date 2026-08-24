/**
 * Injectable time.
 *
 * Looks like ceremony until a backup filename carrying a timestamp needs to appear in a
 * committed snapshot test. Anything user-visible that embeds a date reads it from here.
 */
export interface Clock {
  now(): Date;
  /** Milliseconds since the epoch — the form used in generated backup filenames. */
  timestamp(): number;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  timestamp(): number {
    return Date.now();
  }
}
