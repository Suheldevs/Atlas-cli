import type { GenerationPlan } from '../../types/generation-plan.js';
import type {
  DetectionVerdict,
  Generator,
  GeneratorContext,
  GeneratorInvocation,
  GeneratorMeta,
} from '../../types/generator.js';
import { buildPlanFromTemplate } from '../template-plan.js';

import { readUploadOptions, validateUploadOptions, type UploadOptions } from './upload.schema.js';

const META: GeneratorMeta = {
  name: 'upload',
  summary: 'Multer file uploads with a size limit, a MIME allowlist and generated filenames.',
  aliases: [],
  version: '1.0.0',
  argument: undefined,
  flags: [
    {
      flag: '--dir <path>',
      description: "Where to write the module. Defaults to the project's source directory.",
      defaultValue: undefined,
    },
  ],
  // Express only: the router and the error middleware are Express, as the template's own
  // `requires` declares.
  frameworks: ['express'],
  languages: ['typescript'],
};

const NOTES: readonly string[] = [
  'Mount the router where you want it: `app.use("/uploads", createUploadRouter())`.',
  'UPLOAD_DIR sets the destination (default "uploads"); it is created on startup.',
  'UPLOAD_MAX_FILE_SIZE_BYTES caps each file (default 5242880) and UPLOAD_MAX_FILES caps how many arrive at once (default 5).',
  'UPLOAD_ALLOWED_MIME_TYPES narrows the allowlist; it defaults to JPEG, PNG, GIF and WebP.',
  'Add the upload directory to .gitignore — uploaded files are user data, not source.',
];

export const uploadGenerator: Generator<UploadOptions> = {
  meta: META,

  detect(context: GeneratorContext): DetectionVerdict {
    if (context.project.language !== 'typescript') {
      return {
        supported: false,
        reason: 'The upload template is TypeScript, and this project is JavaScript.',
        hint: 'Add a tsconfig.json, or install typescript, and run this again.',
      };
    }

    if (context.project.framework !== 'express') {
      return {
        supported: false,
        reason: `The upload template targets Express, and this looks like ${context.project.framework}.`,
        hint: 'Nest and Fastify handle multipart bodies their own way; those generators are not written yet.',
      };
    }

    return { supported: true, reason: undefined, hint: undefined };
  },

  async prompt(invocation: GeneratorInvocation, context: GeneratorContext): Promise<UploadOptions> {
    // Nothing worth asking: the limits are environment variables the user can change after the
    // fact, and the one path option already has a good default.
    return readUploadOptions(invocation.flags, context.project.layout.sourceDir);
  },

  validate(options: UploadOptions): void {
    validateUploadOptions(options);
  },

  generate(options: UploadOptions, context: GeneratorContext): Promise<GenerationPlan> {
    return buildPlanFromTemplate({
      context,
      generator: META.name,
      template: 'upload',
      destinationPrefix: options.directory,
      notes: NOTES,
    });
  },
};
