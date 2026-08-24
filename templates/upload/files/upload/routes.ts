/**
 * An example upload router. Mount it with `app.use('/uploads', createUploadRouter())`.
 *
 * Both handlers are here to be copied and edited: a real endpoint saves the returned filename
 * against a user or a record, which is the part only your application can write.
 */
import { Router } from 'express';

import { uploadConfig } from './config__IMPORT_SUFFIX__';
import { upload, uploadErrorHandler } from './upload__IMPORT_SUFFIX__';

export interface StoredFile {
  readonly filename: string;
  readonly size: number;
  readonly mimetype: string;
}

/**
 * The filename is enough for a client to ask for the file back. `file.path` is left out on
 * purpose: an absolute path tells a caller where the application lives on disk, and it is the
 * kind of detail that ends up in a bug report, a screenshot or a log aggregator.
 */
function describe(file: Express.Multer.File): StoredFile {
  return { filename: file.filename, size: file.size, mimetype: file.mimetype };
}

export function createUploadRouter(): Router {
  const router = Router();

  router.post('/', upload.single('file'), (req, res) => {
    const file = req.file;

    if (file === undefined) {
      res.status(400).json({ code: 'file_required', message: 'Expected a file in field "file".' });
      return;
    }

    res.status(201).json({ file: describe(file) });
  });

  router.post('/many', upload.array('files', uploadConfig.maxFiles), (req, res) => {
    // `req.files` is an array for `array()` but a record keyed by field for `fields()`, so this
    // check is a narrowing as much as a validation.
    const files = req.files;

    if (!Array.isArray(files) || files.length === 0) {
      res
        .status(400)
        .json({ code: 'files_required', message: 'Expected at least one file in field "files".' });
      return;
    }

    res.status(201).json({ files: files.map(describe) });
  });

  // Mounted on the router so multer failures are answered correctly even if the application's own
  // error handler has never heard of uploads.
  router.use(uploadErrorHandler);

  return router;
}
