import { AtlasError } from '../errors/atlas-error.js';
import { ErrorCode } from '../errors/error-catalog.js';
import type { AnyGenerator } from '../types/generator.js';
import type { PluginSource } from '../types/plugin.js';
import { closestMatch } from '../utils/text.js';

export interface RegisteredGenerator {
  readonly generator: AnyGenerator;
  readonly source: PluginSource;
}

/**
 * The catalog of available generators.
 *
 * Built-ins and third-party plugins register through this same method, which is what makes
 * external plugins first-class rather than a bolt-on: nothing downstream can tell them
 * apart except by looking at `source`.
 */
export class GeneratorRegistry {
  readonly #byName = new Map<string, RegisteredGenerator>();
  readonly #aliases = new Map<string, string>();

  /**
   * Registers a generator, refusing to shadow an existing name or alias.
   *
   * Silent shadowing is the failure mode to avoid here: a plugin that quietly replaced the
   * built-in `auth` generator would leave a user debugging output that does not match any
   * documentation, with nothing in the log to explain it.
   */
  register(generator: AnyGenerator, source: PluginSource): void {
    const { name, aliases } = generator.meta;

    const existing = this.#byName.get(name);
    if (existing !== undefined) {
      throw new AtlasError({
        code: ErrorCode.PluginInvalid,
        message: `Two generators are both named "${name}".`,
        details: [
          `already registered by ${describeSource(existing.source)}`,
          `rejected from ${describeSource(source)}`,
        ],
        hint: 'Uninstall one of the plugins, or ask its author to rename the generator.',
      });
    }

    for (const alias of aliases) {
      const owner = this.#aliases.get(alias) ?? (this.#byName.has(alias) ? alias : undefined);
      if (owner !== undefined) {
        throw new AtlasError({
          code: ErrorCode.PluginInvalid,
          message: `Generator "${name}" claims the alias "${alias}", which "${owner}" already uses.`,
          details: [describeSource(source)],
        });
      }
    }

    this.#byName.set(name, { generator, source });
    for (const alias of aliases) {
      this.#aliases.set(alias, name);
    }
  }

  get(nameOrAlias: string): RegisteredGenerator | undefined {
    const canonical = this.#aliases.get(nameOrAlias) ?? nameOrAlias;
    return this.#byName.get(canonical);
  }

  has(nameOrAlias: string): boolean {
    return this.get(nameOrAlias) !== undefined;
  }

  /** Like `get`, but fails with a suggestion rather than returning undefined. */
  require(nameOrAlias: string): RegisteredGenerator {
    const found = this.get(nameOrAlias);
    if (found !== undefined) {
      return found;
    }

    const suggestion = closestMatch(nameOrAlias, [...this.#byName.keys(), ...this.#aliases.keys()]);

    throw new AtlasError({
      code: ErrorCode.UnknownGenerator,
      message: `No generator named "${nameOrAlias}".`,
      hint:
        suggestion === undefined
          ? 'Run `atlas list` to see what is available.'
          : `Did you mean "${suggestion}"?`,
    });
  }

  /** Every generator, name-sorted so `atlas list` output is stable. */
  list(): readonly RegisteredGenerator[] {
    return [...this.#byName.values()].sort((a, b) =>
      a.generator.meta.name.localeCompare(b.generator.meta.name),
    );
  }

  names(): readonly string[] {
    return [...this.#byName.keys()].sort();
  }

  get size(): number {
    return this.#byName.size;
  }
}

export function describeSource(source: PluginSource): string {
  return source.kind === 'builtin' ? 'Atlas itself' : `${source.kind} ${source.specifier}`;
}
