import { capitalizeWords } from './capitalize-words__IMPORT_SUFFIX__';

/**
 * Every failure the API reports deliberately.
 *
 * The shape mirrors `ApiResponse` on purpose — `success`, `statusCode`, `message`, `data` — so a
 * client parses one envelope rather than two, and `errors` carries the field-level detail that a
 * single sentence cannot. Anything thrown that is *not* an `ApiError` is treated by the error
 * handler as a defect: it becomes a 500 whose message is never taken from the throwable.
 */
export class ApiError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} [message]
   * @param {unknown[]} [errors] Field-level detail, e.g. one entry per failing Mongoose path.
   * @param {string} [stack] The trace to keep when translating a lower-level throwable.
   */
  constructor(statusCode, message = 'Something went wrong', errors = [], stack = '') {
    super(capitalizeWords(message));

    this.statusCode = statusCode;

    /** Always null: the envelope keeps the same keys whether the request succeeded or failed. */
    this.data = null;

    this.message = capitalizeWords(message);
    this.success = false;
    this.errors = errors;

    if (stack !== '') {
      // Translating a lower-level throwable keeps the original trace, which is the one that
      // points at the code that actually failed.
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export default ApiError;
