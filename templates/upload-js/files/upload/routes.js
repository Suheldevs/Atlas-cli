/**
 * An example upload router. Mount it with `app.use('/uploads', createUploadRouter())`.
 *
 * Both handlers are here to be copied and edited: a real endpoint saves the returned filename
 * against a user or a record, which is the part only your application can write.
 */
import { Router } from 'express';

import ApiError from '../utils/api-error__IMPORT_SUFFIX__';

import { uploadConfig } from './config__IMPORT_SUFFIX__';
import { upload, uploadErrorHandler } from './upload__IMPORT_SUFFIX__';

/**
 * @typedef {object} StoredFile
 * @property {string} filename
 * @property {number} size
 * @property {string} mimetype
 */

/**
 * The filename is enough for a client to ask for the file back. `file.path` is left out on purpose:
 * an absolute path tells a caller where the application lives on disk, and it is the kind of detail
 * that ends up in a bug report, a screenshot or a log aggregator.
 *
 * @param {Express.Multer.File} file
 * @returns {StoredFile}
 */
function describe(file) {
  return { filename: file.filename, size: file.size, mimetype: file.mimetype };
}

/**
 * @returns {import('express').Router}
 */
export function createUploadRouter() {
  const router = Router();

  router.post('/', upload.single('file'), (req, res) => {
    const file = req.file;

    if (file === undefined) {
      throw new ApiError(400, 'File is required', [
        { field: 'file', code: 'file_required', message: 'Expected a file in field "file".' },
      ]);
    }

    res.api(201, 'File uploaded', { file: describe(file) });
  });

  router.post('/many', upload.array('files', uploadConfig.maxFiles), (req, res) => {
    // `req.files` is an array for `array()` but a record keyed by field for `fields()`, so this
    // check is a narrowing as much as a validation.
    const files = req.files;

    if (!Array.isArray(files) || files.length === 0) {
      throw new ApiError(400, 'Files are required', [
        {
          field: 'files',
          code: 'files_required',
          message: 'Expected at least one file in field "files".',
        },
      ]);
    }

    res.api(201, 'Files uploaded', { files: files.map(describe) }, { count: files.length });
  });

  // Mounted on the router so a multer failure becomes an `ApiError` before it reaches the
  // application's global error handler, which has never heard of multer.
  router.use(uploadErrorHandler);

  return router;
}
