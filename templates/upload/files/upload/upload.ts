/**
 * The configured multer instance, plus the error middleware that renders its failures.
 *
 * Files land on the local disk. That is the right default for a single server and the wrong one
 * for more than one — swap `multer.diskStorage` for an S3 storage engine when you get there.
 */
import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';

import { extensionFor, isAllowedMimeType, uploadConfig } from './config__IMPORT_SUFFIX__';

/** Thrown by the file filter so the error handler can answer 415 instead of a generic 400. */
export class UnsupportedFileTypeError extends Error {
  constructor(mimetype: string) {
    super(`Files of type "${mimetype}" are not accepted.`);
    this.name = 'UnsupportedFileTypeError';
  }
}

export interface UploadErrorBody {
  /** Stable and machine-readable. Clients branch on this, not on the message text. */
  readonly code: string;
  readonly message: string;
}

const storage = multer.diskStorage({
  destination: uploadConfig.directory,

  filename: (_req, file, callback) => {
    const extension = extensionFor(file.mimetype);

    if (extension === undefined) {
      callback(new UnsupportedFileTypeError(file.mimetype), '');
      return;
    }

    // The stored name is ours end to end. `file.originalname` is attacker-controlled text, and a
    // name like `../../app.js` or `avatar.png.js` is exactly how a path traversal or a
    // served-executable bug happens — so even the extension comes from the allowlisted MIME type
    // rather than from the name we were handed.
    callback(null, `${randomUUID()}${extension}`);
  },
});

export const upload = multer({
  storage,
  // Without limits an upload endpoint is a free disk-filling service: one request can stream
  // until the volume is full.
  limits: {
    fileSize: uploadConfig.maxFileSizeBytes,
    files: uploadConfig.maxFiles,
  },
  fileFilter: (_req, file, callback) => {
    // An allowlist, never a blocklist: the interesting extensions are the ones nobody thought of.
    // Note that the type is a header the client sent, so it is a hint and not proof — a script
    // renamed and declared as image/png passes this. If it matters, read the magic bytes of the
    // stored file before serving it.
    if (!isAllowedMimeType(file.mimetype)) {
      callback(new UnsupportedFileTypeError(file.mimetype));
      return;
    }

    callback(null, true);
  },
});

function bodyFor(error: multer.MulterError): UploadErrorBody {
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return {
        code: 'file_too_large',
        message: `Each file must be at most ${String(uploadConfig.maxFileSizeBytes)} bytes.`,
      };
    case 'LIMIT_FILE_COUNT':
      return {
        code: 'too_many_files',
        message: `At most ${String(uploadConfig.maxFiles)} files may be uploaded at once.`,
      };
    case 'LIMIT_UNEXPECTED_FILE':
      return {
        code: 'unexpected_file',
        message: 'A file arrived on a field this endpoint does not accept, or there were too many.',
      };
    default:
      return { code: 'upload_failed', message: 'The upload could not be processed.' };
  }
}

function statusFor(error: multer.MulterError): number {
  return error.code === 'LIMIT_FILE_SIZE' || error.code === 'LIMIT_FILE_COUNT' ? 413 : 400;
}

/**
 * Error middleware for upload failures.
 *
 * Anything it does not recognise is passed along, so the application's own error handler still
 * gets the last word.
 */
export function uploadErrorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Express cannot rewrite a response whose headers have already gone out.
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof UnsupportedFileTypeError) {
    res.status(415).json({ code: 'unsupported_file_type', message: error.message });
    return;
  }

  if (error instanceof multer.MulterError) {
    res.status(statusFor(error)).json(bodyFor(error));
    return;
  }

  next(error);
}
