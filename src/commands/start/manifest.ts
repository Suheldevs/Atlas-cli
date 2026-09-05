import type { DependencyRequest, ScriptRequest } from '../../types/generation-plan.js';

export interface HalfManifestRequest {
  /** The directory name the user asked for, used as the package-name stem. */
  readonly projectName: string;
  /** `server` or `client`; disambiguates the two package names. */
  readonly half: string;
  readonly description: string;
  readonly scripts: readonly ScriptRequest[];
  readonly dependencies: readonly DependencyRequest[];
}

/**
 * Writes the `package.json` for one half.
 *
 * The templates deliberately do not ship one. They declare their scripts and dependencies in
 * `template.json`, because that is what lets the same template be added to a project that
 * already has a manifest — `atlas add logger` must merge into the user's file, never replace it.
 * `start` is the case with no file to merge into, so the manifest is assembled here from the
 * plan the templates produced.
 *
 * Everything in it follows from decisions made elsewhere and is not re-derived: `type: module`
 * mirrors the synthetic context's ESM, and the scripts and dependencies are exactly what the
 * plan carries after the templates have been merged and their ranges reconciled.
 */
export function renderHalfManifest(request: HalfManifestRequest): string {
  const production = request.dependencies.filter((dependency) => !dependency.dev);
  const development = request.dependencies.filter((dependency) => dependency.dev);

  const manifest: Record<string, unknown> = {
    name: `${request.projectName}-${request.half}`,
    version: '0.1.0',
    // A generated project is nobody's npm package until its author decides otherwise, and an
    // accidental `npm publish` is not a mistake worth leaving available.
    private: true,
    description: request.description,
    type: 'module',
    scripts: Object.fromEntries(
      [...request.scripts]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((script) => [script.name, script.command]),
    ),
  };

  // Declared here as well as installed, so that `npm install` in a fresh clone — or after
  // `--skip-install`, or after an install that failed — reproduces the same tree.
  if (production.length > 0) {
    manifest['dependencies'] = toRangeMap(production);
  }

  if (development.length > 0) {
    manifest['devDependencies'] = toRangeMap(development);
  }

  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Sorted, because npm rewrites these alphabetically on its first install anyway. */
function toRangeMap(dependencies: readonly DependencyRequest[]): Record<string, string> {
  return Object.fromEntries(
    [...dependencies]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((dependency) => [dependency.name, dependency.range]),
  );
}
