import { createHash } from 'node:crypto';

/**
 * Content fingerprint used by conflict detection.
 *
 * Line endings are normalised first: a file that differs from what Atlas would write only
 * because Git checked it out with CRLF is not a conflict, and prompting about it would train
 * users to click through the prompt that actually matters.
 *
 * Lives in its own module rather than beside `FileSystemService` for two reasons: hashing is
 * not a filesystem concern, and keeping `node:crypto` out of that module lets the bundler drop
 * this entirely from entry points that never compare content.
 */
export function fingerprint(contents: string): string {
  return createHash('sha256').update(contents.replace(/\r\n/gu, '\n'), 'utf8').digest('hex');
}
