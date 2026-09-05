/**
 * The HTTP layer for __ENTITY_TITLE__.
 *
 * Two rules, and everything here follows from them. **Nothing catches**: Express 5 forwards a throw
 * and a rejected promise to the global error handler, which is the one place an `ApiError` becomes a
 * response body — a `try/catch` here would be a second, inconsistent renderer. And **nothing formats
 * a success response by hand**: `res.api` puts every payload in the same envelope, so a client
 * parses one shape across the whole API.
 */
import ApiError from '../utils/api-error__IMPORT_SUFFIX__';

import {
  create__ENTITY_NAME__,
  get__ENTITY_NAME__ById,
  list__ENTITY_PLURAL__,
  remove__ENTITY_NAME__,
  update__ENTITY_NAME__,
} from './__ENTITY_KEBAB__.service__IMPORT_SUFFIX__';
import {
  validateCreate__ENTITY_NAME__,
  validateList__ENTITY_PLURAL__Query,
  validateUpdate__ENTITY_NAME__,
} from './__ENTITY_KEBAB__.validators__IMPORT_SUFFIX__';

/**
 * Turns a failed validation into the same error every other failure uses.
 *
 * The field-level detail travels in `errors`, which is what makes a 400 actionable: a client can
 * point at the offending input instead of re-reading the docs. Only the field and the rule that
 * failed are included — never the submitted value, which would put a password or a card number into
 * a response body, and from there into browser devtools, proxy logs and error trackers.
 *
 * @param {{ field: string, message: string }[]} errors
 * @returns {ApiError}
 */
function validationFailed(errors) {
  return new ApiError(400, 'Validation failed', errors);
}

export const __ENTITY_CAMEL__Controller = {
  /**
   * @type {import('express').RequestHandler}
   */
  create: async (req, res) => {
    const parsed = validateCreate__ENTITY_NAME__(req.body);
    if (!parsed.ok) throw validationFailed(parsed.errors);

    const created = await create__ENTITY_NAME__(parsed.value);

    res.api(201, '__ENTITY_TITLE__ created', created);
  },

  /**
   * @type {import('express').RequestHandler}
   */
  list: async (req, res) => {
    const parsed = validateList__ENTITY_PLURAL__Query(req.query);
    if (!parsed.ok) throw validationFailed(parsed.errors);

    const page = await list__ENTITY_PLURAL__(parsed.value);

    // Pagination is metadata about the response, not part of it: keeping it out of `data` means a
    // client can hand `data` straight to a renderer without unwrapping anything first.
    res.api(200, '__ENTITY_TITLE__ list fetched', page.items, {
      page: page.page,
      limit: page.limit,
      total: page.total,
      pages: page.pages,
    });
  },

  /**
   * @type {import('express').RequestHandler}
   */
  get: async (req, res) => {
    const found = await get__ENTITY_NAME__ById(req.params.id);

    res.api(200, '__ENTITY_TITLE__ fetched', found);
  },

  /**
   * @type {import('express').RequestHandler}
   */
  update: async (req, res) => {
    // An empty patch fails here, before any query runs: see the note in the validator for why a
    // no-op PATCH is a 400 rather than a cheerful 200.
    const parsed = validateUpdate__ENTITY_NAME__(req.body);
    if (!parsed.ok) throw validationFailed(parsed.errors);

    const updated = await update__ENTITY_NAME__(req.params.id, parsed.value);

    res.api(200, '__ENTITY_TITLE__ updated', updated);
  },

  /**
   * @type {import('express').RequestHandler}
   */
  remove: async (req, res) => {
    await remove__ENTITY_NAME__(req.params.id);

    // 200 with a null payload rather than 204: the envelope is the contract, and a bodiless
    // response would be the one reply in the API a client has to special-case.
    res.api(200, '__ENTITY_TITLE__ deleted', null);
  },
};
