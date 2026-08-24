import type { Framework, Language } from './project-context.js';

/**
 * Token substitution map: `__TOKEN__` → replacement.
 *
 * Tokens are chosen to be valid TypeScript identifiers so that a template stays parseable
 * *before* generation — `class __ENTITY_NAME__Service` compiles, which is what lets templates
 * be real `.ts` files with working editor support instead of inert text.
 */
export type TokenValues = Readonly<Record<string, string>>;

/** One file a template contributes. */
export interface TemplateFileEntry {
  /** Path relative to the template's `files/` directory. */
  readonly source: string;
  /**
   * Destination relative to the project root. May itself contain tokens, so a template can
   * name files after the entity it is generating.
   */
  readonly destination: string;
  /** False for files the target project's formatter must not touch. */
  readonly format: boolean;
}

/**
 * Conditions a project must meet for a template to apply.
 *
 * Checked before anything is generated, so an unsupported project is refused with an
 * explanation rather than handed code that cannot compile.
 */
export interface TemplateRequirements {
  /** Empty means framework-agnostic. */
  readonly frameworks: readonly Framework[];
  readonly language: Language | undefined;
  /** Packages that must already be present, with the range required. */
  readonly dependencies: Readonly<Record<string, string>>;
}

/**
 * A parsed `template.json`.
 *
 * Dependencies are declared here and **only** here. No generator hardcodes a package name or
 * version: that keeps the dependency surface auditable in one file per template, and means
 * bumping a version is a data change rather than a code change.
 */
export interface TemplateManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly scripts: Readonly<Record<string, string>>;
  /**
   * Explicit file list. When empty, the loader mirrors the template's `files/` directory
   * recursively — the common case, so that adding a file to a template does not also mean
   * remembering to register it.
   */
  readonly files: readonly TemplateFileEntry[];
  readonly requires: TemplateRequirements;
}

/** A manifest plus where it was loaded from. */
export interface LoadedTemplate {
  readonly manifest: TemplateManifest;
  /** Absolute path to the template directory. */
  readonly root: string;
  /** Absolute path to the template's `files/` directory. */
  readonly filesRoot: string;
}

/** A template file with its tokens already substituted, ready to become a `FileOperation`. */
export interface RenderedFile {
  /** Project-relative destination, tokens resolved. */
  readonly destination: string;
  readonly contents: string;
  readonly format: boolean;
}

/**
 * Template access, as handed to a generator.
 *
 * Declared as an interface here rather than referencing `TemplateLoader` directly so that
 * `types/` stays a leaf and generators depend on the capability instead of the implementation.
 * `TemplateLoader` satisfies it structurally.
 */
export interface TemplateRenderer {
  load(name: string): Promise<LoadedTemplate>;
  render(template: LoadedTemplate, tokens: TokenValues): Promise<readonly RenderedFile[]>;
}
