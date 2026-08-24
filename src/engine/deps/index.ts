/**
 * Dependency reconciliation: work out what is missing, then install exactly that.
 *
 * The split is deliberate. `planDependencies` is pure and decides everything; `DependencyInstaller`
 * only carries the decision out. Callers that merely need to *show* what would happen — `--dry-run`,
 * plan previews — never have to touch a package manager at all.
 */

export {
  DependencyInstaller,
  type DependencyInstallerOptions,
  type DependencyInstallOptions,
} from './dependency-installer.js';
export {
  planDependencies,
  type DependencyConflictReport,
  type DependencyPlan,
} from './dependency-planner.js';
export { splitByKind, toSpecifiers, type SplitDependencies } from './dependency-resolver.js';
