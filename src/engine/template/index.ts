/** Public surface of the template subsystem: manifests in, rendered file contents out. */

export { TemplateCache } from './template-cache.js';

export {
  TemplateLoader,
  TEMPLATE_FILES_DIR_NAME,
  type TemplateLoaderOptions,
} from './template-loader.js';

export {
  checkRequirements,
  parseTemplateManifest,
  type RequirementCheck,
} from './template-manifest.js';

export * from './token-replacer.js';
export * from './token-table.js';

export type {
  LoadedTemplate,
  RenderedFile,
  TemplateFileEntry,
  TemplateManifest,
  TemplateRequirements,
  TokenValues,
} from '../../types/template-manifest.js';
