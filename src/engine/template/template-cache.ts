import type { LoadedTemplate } from '../../types/template-manifest.js';

/**
 * Process-lifetime cache of parsed template manifests, keyed by template name.
 *
 * A single `atlas add` run asks for the same template from several places — requirement
 * checks, the dependency planner, the generator itself — and re-reading and re-validating
 * `template.json` each time is pure overhead against files that ship inside the package and
 * cannot change mid-run.
 *
 * Rendered output is deliberately **not** cached. A render is a function of the token table,
 * which differs per invocation (`atlas add auth` and `atlas add crud --name Post` share
 * templates but no tokens), so caching by template name would hand the second caller the
 * first caller's substitutions. Manifests are token-independent; rendered files are not.
 */
export class TemplateCache {
  readonly #entries = new Map<string, LoadedTemplate>();

  get(name: string): LoadedTemplate | undefined {
    return this.#entries.get(name);
  }

  set(name: string, template: LoadedTemplate): void {
    this.#entries.set(name, template);
  }

  has(name: string): boolean {
    return this.#entries.has(name);
  }

  /** Drops one entry. Used by tests and by long-lived hosts that edit templates on disk. */
  invalidate(name: string): boolean {
    return this.#entries.delete(name);
  }

  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }
}
