/**
 * Public surface of the upload module. Application code imports from here.
 */
export {
  extensionFor,
  isAllowedMimeType,
  MIME_EXTENSIONS,
  uploadConfig,
  type UploadConfig,
} from './config__IMPORT_SUFFIX__';
export { createUploadRouter, type StoredFile } from './routes__IMPORT_SUFFIX__';
export {
  UnsupportedFileTypeError,
  upload,
  uploadErrorHandler,
  type UploadErrorBody,
} from './upload__IMPORT_SUFFIX__';
