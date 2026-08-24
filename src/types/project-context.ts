/**
 * What Atlas knows about the project it is generating into.
 *
 * Produced once by `src/detection/`, then treated as immutable. Every generator reads the
 * same instance instead of re-inspecting the filesystem, which keeps a single generation
 * run internally consistent even if the user edits files while a prompt is open.
 */

export type Framework = 'express' | 'nest' | 'fastify' | 'next' | 'react' | 'unknown';

export type Language = 'typescript' | 'javascript';

/**
 * Decides the extension on every relative import in every generated file. Getting this
 * wrong means nothing compiles, which is why it is detected rather than assumed.
 */
export type ModuleSystem = 'esm' | 'cjs';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type DatabaseLayer = 'mongoose' | 'prisma' | 'typeorm' | 'drizzle' | 'none';

/** The parts of `package.json` Atlas reads, normalised so callers never handle `undefined` maps. */
export interface PackageManifest {
  readonly path: string;
  readonly name: string | undefined;
  readonly version: string | undefined;
  /** Literal value of the `type` field: `'module'`, `'commonjs'`, or absent. */
  readonly type: string | undefined;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly peerDependencies: Readonly<Record<string, string>>;
  readonly scripts: Readonly<Record<string, string>>;
  /** Everything else, preserved so writers can round-trip unknown fields. */
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface SourceLayout {
  /** Directory new source belongs in, relative to `root`. Usually `src`. */
  readonly sourceDir: string;
  /** True when the project keeps its source at the repository root with no `src`. */
  readonly flat: boolean;
}

export interface WorkspaceInfo {
  readonly isMonorepo: boolean;
  /**
   * Absolute directory a package manager must be invoked from.
   *
   * In a pnpm or npm workspace this is the workspace root, not the package: installing in
   * the wrong place produces a nested `node_modules` that resolution silently ignores.
   */
  readonly installRoot: string;
  readonly workspaceRoot: string | undefined;
}

export interface TypeScriptInfo {
  readonly present: boolean;
  readonly configPath: string | undefined;
  readonly strict: boolean;
}

export interface ProjectContext {
  /** Absolute path to the project Atlas is operating on. */
  readonly root: string;
  readonly manifest: PackageManifest | undefined;
  readonly framework: Framework;
  readonly language: Language;
  readonly moduleSystem: ModuleSystem;
  readonly packageManager: PackageManager;
  readonly database: DatabaseLayer;
  readonly typescript: TypeScriptInfo;
  readonly layout: SourceLayout;
  readonly workspace: WorkspaceInfo;
  /**
   * Suffix for relative import specifiers in generated code: `.js` under ESM (where
   * TypeScript requires the emitted extension), empty under CommonJS.
   */
  readonly importSuffix: string;
}
