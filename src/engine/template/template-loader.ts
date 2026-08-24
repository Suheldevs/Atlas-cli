import { join, posix } from 'node:path';

import { resolveTemplatesRoot } from '../../config/package-meta.js';
import { TEMPLATE_MANIFEST_FILE_NAME } from '../../constants/paths.js';
import { AtlasError } from '../../errors/atlas-error.js';
import { ErrorCode } from '../../errors/error-catalog.js';
import type { FileSystemService } from '../../services/filesystem.service.js';
import type { Reporter } from '../../services/reporter.service.js';
import type {
  LoadedTemplate,
  RenderedFile,
  TemplateFileEntry,
  TokenValues,
} from '../../types/template-manifest.js';

import { TemplateCache } from './template-cache.js';
import { parseTemplateManifest } from './template-manifest.js';
import { replaceTokens, replaceTokensInPath } from './token-replacer.js';

/** Subdirectory of a template holding the real `.ts` files it contributes. */
export const TEMPLATE_FILES_DIR_NAME = 'files';

export interface TemplateLoaderOptions {
  readonly fs: FileSystemService;
  readonly reporter: Reporter;
  /** Defaults to `resolveTemplatesRoot()`. Overridable for tests. */
  readonly templatesRoot?: string | undefined;
}

/**
 * Turns a template directory into rendered file contents.
 *
 * Reading and validating a manifest is separated from rendering it because the two have
 * different lifetimes: a manifest is fixed for the process, while a render depends on the
 * token table of the invocation that asked for it.
 */
export class TemplateLoader {
  readonly #fs: FileSystemService;
  readonly #reporter: Reporter;
  readonly #templatesRoot: string;
  readonly #cache = new TemplateCache();

  constructor(options: TemplateLoaderOptions) {
    this.#fs = options.fs;
    this.#reporter = options.reporter;
    this.#templatesRoot = options.templatesRoot ?? resolveTemplatesRoot();
  }

  /** Absolute directory templates are resolved against. Exposed for diagnostics. */
  get templatesRoot(): string {
    return this.#templatesRoot;
  }

  async load(name: string): Promise<LoadedTemplate> {
    const cached = this.#cache.get(name);
    if (cached !== undefined) return cached;

    const root = join(this.#templatesRoot, name);
    const manifestPath = join(root, TEMPLATE_MANIFEST_FILE_NAME);

    if (!(await this.#fs.exists(root))) {
      throw this.#missing(`Template "${name}" does not exist.`, root);
    }

    if (!(await this.#fs.exists(manifestPath))) {
      throw this.#missing(
        `Template "${name}" has no ${TEMPLATE_MANIFEST_FILE_NAME}.`,
        manifestPath,
      );
    }

    const template: LoadedTemplate = {
      manifest: parseTemplateManifest(await this.#readManifest(name, manifestPath), manifestPath),
      root,
      filesRoot: join(root, TEMPLATE_FILES_DIR_NAME),
    };

    this.#cache.set(name, template);
    this.#reporter.debug(`Loaded template "${name}" from ${root}`);

    return template;
  }

  async render(template: LoadedTemplate, tokens: TokenValues): Promise<readonly RenderedFile[]> {
    const { manifest, filesRoot } = template;

    if (!(await this.#fs.exists(filesRoot))) {
      throw this.#missing(
        `Template "${manifest.name}" has no ${TEMPLATE_FILES_DIR_NAME}/ directory.`,
        filesRoot,
      );
    }

    const entries =
      manifest.files.length > 0 ? manifest.files : await this.#mirrorEntries(filesRoot);
    const rendered: RenderedFile[] = [];

    for (const entry of entries) {
      rendered.push(await this.#renderEntry(template, entry, tokens));
    }

    return rendered;
  }

  async #readManifest(name: string, manifestPath: string): Promise<unknown> {
    try {
      return await this.#fs.readJson(manifestPath);
    } catch (error) {
      throw new AtlasError({
        code: ErrorCode.TemplateManifestInvalid,
        message: `Template "${name}" has a ${TEMPLATE_MANIFEST_FILE_NAME} that is not valid JSON.`,
        hint: 'Run the file through a JSON validator; a trailing comma is the usual cause.',
        details: [manifestPath, describeError(error)],
        cause: error,
      });
    }
  }

  async #renderEntry(
    template: LoadedTemplate,
    entry: TemplateFileEntry,
    tokens: TokenValues,
  ): Promise<RenderedFile> {
    const sourcePath = join(template.filesRoot, entry.source);
    const contents = await this.#fs.readTextIfExists(sourcePath);

    if (contents === undefined) {
      throw this.#missing(
        `Template "${template.manifest.name}" lists a file that is not in the package.`,
        sourcePath,
      );
    }

    // Strict on purpose: an unresolved `__TOKEN__` reaching a user's project is a generator bug,
    // and one that compiles. Failing the whole run is cheaper than shipping it.
    const rendered = this.#substitute(template, entry, contents, tokens);

    this.#reporter.debug(
      `Rendered ${template.manifest.name}: ${entry.source} -> ${rendered.destination}`,
    );

    return rendered;
  }

  #substitute(
    template: LoadedTemplate,
    entry: TemplateFileEntry,
    contents: string,
    tokens: TokenValues,
  ): RenderedFile {
    try {
      return {
        destination: replaceTokensInPath(entry.destination, tokens),
        contents: replaceTokens(contents, tokens, { strict: true }),
        format: entry.format,
      };
    } catch (error) {
      throw this.#renderFailure(template, entry, error);
    }
  }

  /**
   * Re-throws a substitution failure naming the template and the file it came from.
   *
   * The token replacer only knows about a string, so its message alone leaves the user hunting
   * for which of a template's twenty files carried the bad token.
   */
  #renderFailure(template: LoadedTemplate, entry: TemplateFileEntry, error: unknown): AtlasError {
    const where = `template "${template.manifest.name}", file ${entry.source}`;
    const source = join(template.filesRoot, entry.source);

    if (AtlasError.isAtlasError(error)) {
      return new AtlasError({
        code: error.code,
        message: `Could not render ${where}: ${error.message}`,
        ...(error.hint === undefined ? {} : { hint: error.hint }),
        details: [...error.details, source],
        cause: error,
      });
    }

    return new AtlasError({
      code: ErrorCode.GenerationFailed,
      message: `Could not render ${where}: ${describeError(error)}`,
      details: [source],
      cause: error,
    });
  }

  /**
   * Every file under `files/`, as entries destined for the same relative path.
   *
   * This is the default so that adding a file to a template does not also mean remembering to
   * register it in the manifest.
   */
  async #mirrorEntries(filesRoot: string): Promise<readonly TemplateFileEntry[]> {
    const sources: string[] = [];
    await this.#collectSources(filesRoot, '', sources);

    // Sorted, not left in directory order: rendered output feeds snapshot tests and a plan the
    // user reads, and `readdir` order is not guaranteed to be stable across platforms.
    return sources
      .sort((a, b) => a.localeCompare(b))
      .map((source) => ({ source, destination: source, format: true }));
  }

  async #collectSources(filesRoot: string, relativeDir: string, into: string[]): Promise<void> {
    const absoluteDir = relativeDir === '' ? filesRoot : join(filesRoot, relativeDir);

    for (const name of await this.#fs.listDir(absoluteDir)) {
      // Relative paths are joined with the POSIX separator so a manifest written on Linux and a
      // walk performed on Windows produce identical entries.
      const relativePath = relativeDir === '' ? name : posix.join(relativeDir, name);

      if (await this.#fs.isDirectory(join(filesRoot, relativePath))) {
        await this.#collectSources(filesRoot, relativePath, into);
      } else {
        into.push(relativePath);
      }
    }
  }

  #missing(message: string, path: string): AtlasError {
    return new AtlasError({
      code: ErrorCode.TemplateNotFound,
      message,
      // The path is the fastest way to see a packaging mistake, which is the usual cause: the
      // template exists in the repository but never made it into the published tarball.
      hint: `Atlas looked in ${path}. If you installed Atlas globally, reinstalling should restore the shipped templates.`,
      details: [path, `Templates root: ${this.#templatesRoot}`],
    });
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
