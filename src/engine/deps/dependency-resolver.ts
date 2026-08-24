import type { DependencyRequest } from '../../types/generation-plan.js';

export interface SplitDependencies {
  readonly prod: readonly DependencyRequest[];
  readonly dev: readonly DependencyRequest[];
}

/** Turns requests into the `name@range` specifiers a package manager takes on its argv. */
export function toSpecifiers(requests: readonly DependencyRequest[]): readonly string[] {
  return requests.map((request) =>
    // `pkg@` is not a valid specifier, so an empty range degrades to the bare name — which is
    // what every manager reads as "whatever the registry calls latest" anyway.
    request.range.trim() === '' ? request.name : `${request.name}@${request.range}`,
  );
}

/** Production and development requests need different manager flags, so they travel separately. */
export function splitByKind(requests: readonly DependencyRequest[]): SplitDependencies {
  return {
    prod: requests.filter((request) => !request.dev),
    dev: requests.filter((request) => request.dev),
  };
}
