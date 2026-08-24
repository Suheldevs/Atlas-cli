import { DOCS_BASE_URL } from '../constants/branding.js';
import { ExitCode } from '../constants/exit-codes.js';

/**
 * Every way Atlas is allowed to fail on purpose.
 *
 * Codes are stable and greppable: a user pasting `ATLAS_1003` into an issue should land
 * on exactly one documented cause. Numbers are grouped by blame — 1xxx environment,
 * 2xxx usage, 9xxx Atlas itself — and are never recycled.
 */
export const ErrorCode = {
  UnsupportedNodeVersion: 'ATLAS_1001',
  GitUnavailable: 'ATLAS_1002',
  NoPackageManager: 'ATLAS_1003',
  DirectoryNotWritable: 'ATLAS_1004',
  CommandFailed: 'ATLAS_1005',
  ExecutableNotFound: 'ATLAS_1006',
  EnvironmentUnhealthy: 'ATLAS_1007',
  InvalidUsage: 'ATLAS_2001',
  NotAProject: 'ATLAS_2002',
  UnsupportedFramework: 'ATLAS_2003',
  UnknownGenerator: 'ATLAS_2004',
  GenerationFailed: 'ATLAS_3001',
  ConflictUnresolved: 'ATLAS_3002',
  PlanInvalid: 'ATLAS_3003',
  RollbackFailed: 'ATLAS_3004',
  TemplateNotFound: 'ATLAS_4001',
  TemplateManifestInvalid: 'ATLAS_4002',
  DependencyInstallFailed: 'ATLAS_5001',
  DependencyConflict: 'ATLAS_5002',
  FormatFailed: 'ATLAS_5003',
  PluginLoadFailed: 'ATLAS_6001',
  PluginInvalid: 'ATLAS_6002',
  Cancelled: 'ATLAS_9001',
  Internal: 'ATLAS_9999',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ErrorDescriptor {
  /** Exit status Atlas leaves behind when this error reaches the top level. */
  readonly exitCode: ExitCode;
  /** Short label used in diagnostics; not the user-facing message. */
  readonly summary: string;
}

const DESCRIPTORS: Readonly<Record<ErrorCode, ErrorDescriptor>> = {
  [ErrorCode.UnsupportedNodeVersion]: {
    exitCode: ExitCode.PreconditionFailed,
    summary: 'Unsupported Node.js version',
  },
  [ErrorCode.GitUnavailable]: {
    exitCode: ExitCode.PreconditionFailed,
    summary: 'Git is not available',
  },
  [ErrorCode.NoPackageManager]: {
    exitCode: ExitCode.PreconditionFailed,
    summary: 'No supported package manager found',
  },
  [ErrorCode.DirectoryNotWritable]: {
    exitCode: ExitCode.PreconditionFailed,
    summary: 'Target directory is not writable',
  },
  [ErrorCode.CommandFailed]: {
    exitCode: ExitCode.Failure,
    summary: 'A child process exited with a non-zero status',
  },
  [ErrorCode.ExecutableNotFound]: {
    exitCode: ExitCode.PreconditionFailed,
    summary: 'Executable not found on PATH',
  },
  [ErrorCode.EnvironmentUnhealthy]: {
    exitCode: ExitCode.PreconditionFailed,
    summary: 'Environment preflight checks failed',
  },
  [ErrorCode.InvalidUsage]: {
    exitCode: ExitCode.InvalidUsage,
    summary: 'Invalid command usage',
  },
  [ErrorCode.NotAProject]: {
    exitCode: ExitCode.PreconditionFailed,
    summary: 'No package.json found',
  },
  [ErrorCode.UnsupportedFramework]: {
    exitCode: ExitCode.PreconditionFailed,
    summary: 'Generator does not support this project',
  },
  [ErrorCode.UnknownGenerator]: {
    exitCode: ExitCode.InvalidUsage,
    summary: 'Unknown generator',
  },
  [ErrorCode.GenerationFailed]: {
    exitCode: ExitCode.Failure,
    summary: 'Generation failed and was rolled back',
  },
  [ErrorCode.ConflictUnresolved]: {
    exitCode: ExitCode.Conflict,
    summary: 'Stopped at an unresolved file conflict',
  },
  [ErrorCode.PlanInvalid]: {
    exitCode: ExitCode.Failure,
    summary: 'Generator produced an invalid plan',
  },
  [ErrorCode.RollbackFailed]: {
    exitCode: ExitCode.Failure,
    summary: 'Rollback could not fully restore the project',
  },
  [ErrorCode.TemplateNotFound]: {
    exitCode: ExitCode.Failure,
    summary: 'Template directory is missing',
  },
  [ErrorCode.TemplateManifestInvalid]: {
    exitCode: ExitCode.Failure,
    summary: 'template.json is malformed',
  },
  [ErrorCode.DependencyInstallFailed]: {
    exitCode: ExitCode.Failure,
    summary: 'Dependency installation failed',
  },
  /**
   * Reserved, and not yet thrown by anything.
   *
   * The engine currently reports a range mismatch as a warning and installs the packages that
   * are not in conflict, because it has no way to know whether the mismatch is fatal. That
   * changes once a template manifest can declare a hard requirement, at which point an
   * unsatisfiable one becomes this error rather than a warning the user might miss.
   */
  [ErrorCode.DependencyConflict]: {
    exitCode: ExitCode.Conflict,
    summary: 'Required dependency range conflicts with the project',
  },
  [ErrorCode.FormatFailed]: {
    exitCode: ExitCode.Failure,
    summary: 'Generated code could not be formatted',
  },
  [ErrorCode.PluginLoadFailed]: {
    exitCode: ExitCode.Failure,
    summary: 'Plugin could not be loaded',
  },
  [ErrorCode.PluginInvalid]: {
    exitCode: ExitCode.Failure,
    summary: 'Plugin does not satisfy the generator contract',
  },
  [ErrorCode.Cancelled]: {
    exitCode: ExitCode.Interrupted,
    summary: 'Cancelled by the user',
  },
  [ErrorCode.Internal]: {
    exitCode: ExitCode.Failure,
    summary: 'Unexpected internal error',
  },
};

export function describeErrorCode(code: ErrorCode): ErrorDescriptor {
  return DESCRIPTORS[code];
}

/**
 * Anchor links depend on `docs/troubleshooting.md` using the bare code as its heading
 * (`### ATLAS_1001`), which GitHub slugifies to the lowercased form.
 */
export function docsUrlForErrorCode(code: ErrorCode): string {
  return `${DOCS_BASE_URL}/troubleshooting.md#${code.toLowerCase()}`;
}
