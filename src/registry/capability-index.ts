import type { ProjectContext } from '../types/project-context.js';

import type { GeneratorRegistry, RegisteredGenerator } from './generator-registry.js';

export interface GeneratorAvailability {
  readonly entry: RegisteredGenerator;
  readonly applicable: boolean;
  /** Why it does not apply, when it does not. */
  readonly reason: string | undefined;
}

/**
 * Answers "which generators make sense for *this* project?".
 *
 * Uses only the declared `frameworks` metadata, which is cheap and synchronous. A
 * generator's own `detect()` is the authoritative check, but running every generator's
 * detector just to render `atlas list` would mean doing real work to print a menu.
 */
export function describeAvailability(
  registry: GeneratorRegistry,
  project: ProjectContext | undefined,
): readonly GeneratorAvailability[] {
  return registry.list().map((entry) => {
    if (project === undefined) {
      return { entry, applicable: true, reason: undefined };
    }

    const reason = firstUnmetRequirement(entry.generator.meta, project);

    return reason === undefined
      ? { entry, applicable: true, reason: undefined }
      : { entry, applicable: false, reason };
  });
}

/**
 * Returns the first declared requirement this project fails, or undefined when it passes all
 * of them. Only the first is reported: a menu row has room for one reason, and the first is
 * enough for the user to know why the generator is greyed out.
 */
function firstUnmetRequirement(
  meta: RegisteredGenerator['generator']['meta'],
  project: ProjectContext,
): string | undefined {
  if (meta.frameworks.length > 0 && !meta.frameworks.includes(project.framework)) {
    return `needs ${meta.frameworks.join(' or ')}, found ${project.framework}`;
  }

  if (meta.languages.length > 0 && !meta.languages.includes(project.language)) {
    return `needs ${meta.languages.join(' or ')}, found ${project.language}`;
  }

  return undefined;
}

export function applicableGenerators(
  registry: GeneratorRegistry,
  project: ProjectContext | undefined,
): readonly RegisteredGenerator[] {
  return describeAvailability(registry, project)
    .filter((availability) => availability.applicable)
    .map((availability) => availability.entry);
}
