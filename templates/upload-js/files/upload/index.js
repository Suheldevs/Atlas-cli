/**
 * Public surface of the upload module. Application code imports from here.
 */
export {
  extensionFor,
  isAllowedMimeType,
  MIME_EXTENSIONS,
  uploadConfig,
} from './config__IMPORT_SUFFIX__';
export { createUploadRouter } from './routes__IMPORT_SUFFIX__';
export { upload, uploadErrorHandler } from './upload__IMPORT_SUFFIX__';
