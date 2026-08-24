/**
 * Upload settings, read from the environment once at startup.
 *
 * Everything tunable lives here so the multer setup next door stays about multer.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The allowlist, mapped to the extension used on disk.
 *
 * A type is only accepted if it appears here, because a stored file needs an extension we chose
 * ourselves. Add a row to accept another type.
 */
export const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

const DEFAULT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;
const DEFAULT_UPLOAD_DIR = 'uploads';

export interface UploadConfig {
  /** Absolute path to the directory files are written to. */
  readonly directory: string;
  readonly maxFileSizeBytes: number;
  readonly maxFiles: number;
  readonly allowedMimeTypes: readonly string[];
}

/** An empty value counts as unset: `UPLOAD_DIR=` in a .env file is a leftover, not a request. */
function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = read(name);
  if (raw === undefined) return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer; received "${raw}".`);
  }

  return parsed;
}

function readAllowedMimeTypes(): readonly string[] {
  const raw = read('UPLOAD_ALLOWED_MIME_TYPES');
  if (raw === undefined) return Object.keys(MIME_EXTENSIONS);

  const types = raw
    .split(',')
    .map((type) => type.trim().toLowerCase())
    .filter((type) => type !== '');

  if (types.length === 0) {
    throw new Error('UPLOAD_ALLOWED_MIME_TYPES is set but lists no types.');
  }

  for (const type of types) {
    // Fail at boot rather than on the first upload of a type nothing knows how to name.
    if (MIME_EXTENSIONS[type] === undefined) {
      throw new Error(
        `UPLOAD_ALLOWED_MIME_TYPES lists "${type}", which has no extension in MIME_EXTENSIONS.`,
      );
    }
  }

  return types;
}

export const uploadConfig: UploadConfig = {
  directory: resolve(read('UPLOAD_DIR') ?? DEFAULT_UPLOAD_DIR),
  maxFileSizeBytes: readPositiveInteger('UPLOAD_MAX_FILE_SIZE_BYTES', DEFAULT_MAX_FILE_SIZE_BYTES),
  maxFiles: readPositiveInteger('UPLOAD_MAX_FILES', DEFAULT_MAX_FILES),
  allowedMimeTypes: readAllowedMimeTypes(),
};

// Multer would create the directory on first use, but doing it at startup means an unwritable
// UPLOAD_DIR fails the boot instead of every upload request.
mkdirSync(uploadConfig.directory, { recursive: true });

export function isAllowedMimeType(mimetype: string): boolean {
  return uploadConfig.allowedMimeTypes.includes(mimetype.toLowerCase());
}

export function extensionFor(mimetype: string): string | undefined {
  return MIME_EXTENSIONS[mimetype.toLowerCase()];
}
