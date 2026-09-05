/**
 * The configured multer instance, plus the middleware that turns its failures into `ApiError`.
 *
 * Files land on the local disk. That is the right default for a single server and the wrong one for
 * more than one — swap `multer.diskStorage` for an S3 storage engine when you get there.
 */
import { randomUUID } from 'node:crypto';

import multer from 'multer';

import ApiError from '../utils/api-error__IMPORT_SUFFIX__';

import { extensionFor, isAllowedMimeType, uploadConfig } from './config__IMPORT_SUFFIX__';

/**
 * A rejection from the file filter. Built here rather than as a bare `Error` so that a wrong MIME
 * type reaches the client through the same envelope as every other failure in the application.
 *
 * @param {string} mimetype
 * @returns {ApiError}
 */
function unsupportedType(mimetype) {
  return new ApiError(400, 'Unsupported file type', [
    {
      field: 'file',
      code: 'unsupported_file_type',
      message: `Files of type "${mimetype}" are not accepted.`,
    },
  ]);
}

const storage = multer.diskStorage({
  destination: uploadConfig.directory,

  filename: (_req, file, callback) => {
    const extension = extensionFor(file.mimetype);

    if (extension === undefined) {
      callback(unsupportedType(file.mimetype), '');
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
  // Without limits an upload endpoint is a free disk-filling service: one request can stream until
  // the volume is full.
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
      callback(unsupportedType(file.mimetype));
      return;
    }

    callback(null, true);
  },
});

/**
 * @param {import('multer').MulterError} error
 * @returns {ApiError}
 */
function toApiError(error) {
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return new ApiError(413, 'File too large', [
        {
          field: error.field ?? 'file',
          code: 'file_too_large',
          message: `Each file must be at most ${uploadConfig.maxFileSizeBytes} bytes.`,
        },
      ]);
    case 'LIMIT_FILE_COUNT':
      return new ApiError(413, 'Too many files', [
        {
          field: error.field ?? 'files',
          code: 'too_many_files',
          message: `At most ${uploadConfig.maxFiles} files may be uploaded at once.`,
        },
      ]);
    case 'LIMIT_UNEXPECTED_FILE':
      return new ApiError(400, 'Unexpected file', [
        {
          field: error.field ?? 'file',
          code: 'unexpected_file',
          message:
            'A file arrived on a field this endpoint does not accept, or there were too many.',
        },
      ]);
    default:
      return new ApiError(400, 'Upload failed', [
        { field: error.field ?? 'file', code: 'upload_failed', message: error.message },
      ]);
  }
}

/**
 * Error middleware for upload failures.
 *
 * Nothing is rendered here. A multer error is translated into an `ApiError` and handed to the next
 * error handler, so every upload rejection leaves through the application's single global handler
 * and looks exactly like every other failure. Anything unrecognised is passed along untouched.
 *
 * @type {import('express').ErrorRequestHandler}
 */
export function uploadErrorHandler(error, _req, _res, next) {
  if (error instanceof multer.MulterError) {
    next(toApiError(error));
    return;
  }

  next(error);
}
