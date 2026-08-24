import type { OutputStream } from '../../src/services/reporter.service.js';

/**
 * In-memory stand-in for `process.stdout` / `process.stderr`.
 *
 * Reports `isTTY: false` so spinners stay disabled and assertions see plain text rather
 * than ANSI cursor movement.
 */
export class MemoryStream implements OutputStream {
  readonly isTTY = false;
  readonly columns = 80;
  readonly chunks: string[] = [];

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  get text(): string {
    return this.chunks.join('');
  }
}
