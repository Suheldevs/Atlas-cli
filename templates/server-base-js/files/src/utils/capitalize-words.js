/** Start of a word: the beginning of the string, or the character after any whitespace. */
const WORD_START = /(^|\s)(\S)/gu;

/**
 * Upper-cases the first letter of every word.
 *
 * Every message that reaches a client — an `ApiError` message, an `ApiResponse` message — goes
 * through this, so a message written as `'user not found'` in one handler and `'User Not Found'`
 * in another still reads identically to whoever is consuming the API.
 *
 * @param {string} value
 * @returns {string}
 */
export function capitalizeWords(value) {
  return value.replace(WORD_START, (_match, leading, first) => `${leading}${first.toUpperCase()}`);
}
