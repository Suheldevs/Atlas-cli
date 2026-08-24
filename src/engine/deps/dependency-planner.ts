import type { DependencyRequest } from '../../types/generation-plan.js';
import type { PackageManifest } from '../../types/project-context.js';
import {
  compareVersions,
  extractMinimumVersion,
  isWorkspaceOrLocalRange,
  rangeSatisfiedBy,
} from '../../utils/semver.js';

export interface DependencyConflictReport {
  readonly name: string;
  readonly installedRange: string;
  readonly requiredRange: string;
  readonly dev: boolean;
}

export interface DependencyPlan {
  readonly toInstall: readonly DependencyRequest[];
  readonly alreadySatisfied: readonly DependencyRequest[];
  readonly conflicts: readonly DependencyConflictReport[];
}

/**
 * Decides which of a template's declared dependencies actually need installing.
 *
 * Pure by design: no filesystem, no package manager, no clock. Everything this function needs
 * is the requests and the manifest already read from disk, which is what makes the interesting
 * half of dependency handling unit-testable and `--dry-run` trustworthy.
 */
export function planDependencies(
  requested: readonly DependencyRequest[],
  manifest: PackageManifest | undefined,
): DependencyPlan {
  const toInstall: DependencyRequest[] = [];
  const alreadySatisfied: DependencyRequest[] = [];
  const conflicts: DependencyConflictReport[] = [];

  for (const request of dedupe(requested)) {
    const installedRange = installedRangeFor(request, manifest);

    if (installedRange === undefined) {
      toInstall.push(request);
      continue;
    }

    // A `workspace:`, `file:` or `link:` range is the user deliberately overriding resolution.
    // Atlas must not fight that, and must not report it as a problem either.
    if (isWorkspaceOrLocalRange(installedRange)) {
      alreadySatisfied.push(request);
      continue;
    }

    // Never reinstall something adequate: an install would rewrite a range the user may have
    // pinned on purpose, which is how a code generator quietly breaks a working project.
    if (rangeSatisfiedBy(installedRange, request.range)) {
      alreadySatisfied.push(request);
      continue;
    }

    // Present, but older than the template needs. Reported rather than upgraded — a major
    // version bump of somebody else's dependency is not a decision Atlas gets to make alone.
    conflicts.push({
      name: request.name,
      installedRange,
      requiredRange: request.range,
      dev: request.dev,
    });
  }

  // Sorted so plan rendering, snapshots and `--dry-run` output are identical run to run.
  return {
    toInstall: toInstall.sort(byName),
    alreadySatisfied: alreadySatisfied.sort(byName),
    conflicts: conflicts.sort(byName),
  };
}

/**
 * The range the project already declares for this request, or undefined when it declares none.
 *
 * A production dependency satisfies a dev request: the package is installed and importable, and
 * moving it to `devDependencies` would edit the user's manifest to no practical benefit. The
 * reverse does not hold — shipping code that imports a dev-only dependency breaks in production.
 *
 * `peerDependencies` are ignored on purpose: declaring a peer says the *consumer* must provide
 * the package, not that this project has it installed.
 */
function installedRangeFor(
  request: DependencyRequest,
  manifest: PackageManifest | undefined,
): string | undefined {
  if (manifest === undefined) return undefined;

  const prod = manifest.dependencies[request.name];
  if (prod !== undefined) return prod;

  return request.dev ? manifest.devDependencies[request.name] : undefined;
}

/**
 * Collapses repeated requests for the same package.
 *
 * Two templates in one run routinely want the same library, and a package can only occupy one
 * entry in a manifest, so the requests must be merged before anything is compared against it.
 */
function dedupe(requested: readonly DependencyRequest[]): readonly DependencyRequest[] {
  const merged = new Map<string, DependencyRequest>();

  for (const request of requested) {
    const existing = merged.get(request.name);
    merged.set(request.name, existing === undefined ? request : mergeRequests(existing, request));
  }

  return [...merged.values()];
}

function mergeRequests(
  existing: DependencyRequest,
  incoming: DependencyRequest,
): DependencyRequest {
  return {
    name: existing.name,
    range: higherRange(existing.range, incoming.range),
    // One production consumer makes the package a production dependency, whatever the other
    // requests called it.
    dev: existing.dev && incoming.dev,
  };
}

/** Keeps the stricter of two ranges, so no requester ends up with less than it asked for. */
function higherRange(existing: string, incoming: string): string {
  const existingMinimum = extractMinimumVersion(existing);
  const incomingMinimum = extractMinimumVersion(incoming);

  // An unreadable range is left exactly as the first requester wrote it: replacing it would be
  // inventing a version on the strength of a comparison that never happened.
  if (existingMinimum === undefined || incomingMinimum === undefined) return existing;

  return compareVersions(incomingMinimum, existingMinimum) > 0 ? incoming : existing;
}

/** Codepoint order rather than `localeCompare`, so the output cannot shift with the locale. */
function byName(a: { readonly name: string }, b: { readonly name: string }): number {
  if (a.name === b.name) return 0;
  return a.name < b.name ? -1 : 1;
}
