/**
 * Every __ENTITY_TITLE__ query the application makes.
 *
 * Nothing above this layer mentions Mongoose: the controller passes validated plain objects in and
 * gets plain records out, so swapping the driver is a change to this file alone. Nothing below it
 * re-validates, because the controller has already done that.
 */
import mongoose from 'mongoose';

import ApiError from '../utils/api-error__IMPORT_SUFFIX__';

import { to__ENTITY_NAME__Record, __ENTITY_NAME__Model } from './__ENTITY_KEBAB__.model__IMPORT_SUFFIX__';

/**
 * A malformed id is a "no such __ENTITY_TITLE__", not a crash.
 *
 * Mongoose casts the argument of `findById` and throws a `CastError` on anything that is not an
 * ObjectId, which would turn a request carrying a junk path parameter into a 500. Checking first
 * gives it the same 404 a well-formed but unused id already gets.
 *
 * @param {string} id
 * @returns {boolean}
 */
function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

/**
 * @param {string} id
 * @returns {ApiError}
 */
function notFound(id) {
  return new ApiError(404, '__ENTITY_TITLE__ not found', [
    { field: 'id', code: '__ENTITY_KEBAB__-not-found', message: `No __ENTITY_TITLE__ with id '${id}'.` },
  ]);
}

/**
 * Escapes a user-supplied string for use inside a regular expression.
 *
 * Without this, a search for `a.*b` is executed as a pattern rather than as text, and a search for
 * something like `(a+)+$` is a catastrophic-backtracking denial of service against the database
 * process. The length of `search` is already bounded by the validator, which is the other half of
 * the same defence.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The Mongo filter for a list request.
 *
 * A case-insensitive substring match is the behaviour people expect from a search box, and it is
 * also the one MongoDB cannot serve from an index — every document has to be examined. That is fine
 * for thousands of documents and not for millions: at that point move to a text index
 * (`$text: { $search }`) or to a search engine, and change this function only.
 *
 * @param {{ search?: string }} query
 * @returns {Record<string, unknown>}
 */
function filterFor(query) {
  if (query.search === undefined || query.search === '') return {};

  const pattern = new RegExp(escapeRegExp(query.search), 'i');

  return { $or: [{ name: pattern }, { description: pattern }] };
}

/**
 * The sort, always with `_id` as the tie-breaker.
 *
 * Without one, documents with equal `createdAt` have no defined order, and two requests for
 * consecutive pages can return the same document twice or skip it entirely.
 *
 * @param {{ sort: string, order: 'asc' | 'desc' }} query
 * @returns {Record<string, 1 | -1>}
 */
function sortFor(query) {
  const direction = query.order === 'asc' ? 1 : -1;
  return { [query.sort]: direction, _id: direction };
}

/**
 * @typedef {object} List__ENTITY_PLURAL__Result
 * @property {import('./__ENTITY_KEBAB__.model__IMPORT_SUFFIX__').__ENTITY_NAME__Record[]} items
 * @property {number} total
 * @property {number} page
 * @property {number} limit
 * @property {number} pages
 */

/**
 * One page of __ENTITY_PLURAL__, plus the counts a client needs to render a pager.
 *
 * `limit` is capped by the validator, so `skip` is the only unbounded part of the query. Deep paging
 * gets slower the further in it goes, because MongoDB walks and discards every skipped document — if
 * that becomes a problem, switch to a cursor keyed on the sort field.
 *
 * @param {{ page: number, limit: number, sort: string, order: 'asc' | 'desc', search?: string }} query
 * @returns {Promise<List__ENTITY_PLURAL__Result>}
 */
export async function list__ENTITY_PLURAL__(query) {
  const filter = filterFor(query);
  const skip = (query.page - 1) * query.limit;

  // Issued together: the count does not depend on the page, and running the two in sequence would
  // double the latency of the most-requested endpoint in the module.
  const [documents, total] = await Promise.all([
    __ENTITY_NAME__Model.find(filter).sort(sortFor(query)).skip(skip).limit(query.limit).lean().exec(),
    __ENTITY_NAME__Model.countDocuments(filter).exec(),
  ]);

  return {
    items: documents.map(to__ENTITY_NAME__Record),
    total,
    page: query.page,
    limit: query.limit,
    pages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

/**
 * @param {string} id
 * @returns {Promise<import('./__ENTITY_KEBAB__.model__IMPORT_SUFFIX__').__ENTITY_NAME__Record>}
 */
export async function get__ENTITY_NAME__ById(id) {
  if (!isValidId(id)) throw notFound(id);

  const document = await __ENTITY_NAME__Model.findById(id).lean().exec();

  if (document === null) throw notFound(id);

  return to__ENTITY_NAME__Record(document);
}

/**
 * @param {{ name: string, description?: string }} input
 * @returns {Promise<import('./__ENTITY_KEBAB__.model__IMPORT_SUFFIX__').__ENTITY_NAME__Record>}
 */
export async function create__ENTITY_NAME__(input) {
  const document = await __ENTITY_NAME__Model.create(input);
  return to__ENTITY_NAME__Record(document);
}

/**
 * Applies a patch and returns the updated record.
 *
 * `$set` with the validated object, never the raw body: a body of `{ "$rename": ... }` reaching an
 * update is how a request rewrites documents it was never meant to touch. `runValidators` is on so
 * the schema's bounds apply to updates as well as to inserts, which they do not by default.
 *
 * @param {string} id
 * @param {{ name?: string, description?: string }} patch
 * @returns {Promise<import('./__ENTITY_KEBAB__.model__IMPORT_SUFFIX__').__ENTITY_NAME__Record>}
 */
export async function update__ENTITY_NAME__(id, patch) {
  if (!isValidId(id)) throw notFound(id);

  const document = await __ENTITY_NAME__Model.findByIdAndUpdate(
    id,
    { $set: patch },
    { new: true, runValidators: true },
  )
    .lean()
    .exec();

  if (document === null) throw notFound(id);

  return to__ENTITY_NAME__Record(document);
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function remove__ENTITY_NAME__(id) {
  if (!isValidId(id)) throw notFound(id);

  const document = await __ENTITY_NAME__Model.findByIdAndDelete(id).lean().exec();

  // Reported rather than swallowed. A delete that quietly succeeds on an id that was never there
  // hides a client working against stale data.
  if (document === null) throw notFound(id);
}
