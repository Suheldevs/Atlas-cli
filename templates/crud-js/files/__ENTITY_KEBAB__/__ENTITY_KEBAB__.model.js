/**
 * The __ENTITY_TITLE__ collection.
 *
 * The schema is the last line of defence, not the first: every request is checked by
 * `__ENTITY_KEBAB__.validators__IMPORT_SUFFIX__` before it reaches the service. The bounds are
 * repeated here anyway, because a document can also arrive from a migration, a seed script or a
 * mongosh session, and those never pass through the HTTP layer at all.
 */
import mongoose, { Schema } from 'mongoose';

export const MAX_NAME_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 2000;

/** The one place the collection's model name is written. */
export const MODEL_NAME = '__ENTITY_NAME__';

const __ENTITY_CAMEL__Schema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_NAME_LENGTH,
    },
    description: {
      type: String,
      trim: true,
      maxlength: MAX_DESCRIPTION_LENGTH,
      // No default. An absent description stays absent rather than being stored as `''`, so
      // "never written" and "deliberately cleared" remain distinguishable.
      default: undefined,
    },
  },
  {
    // Mongoose maintains `createdAt` and `updatedAt`, including on `findByIdAndUpdate`. Doing it
    // here rather than in the service means a write from anywhere — a script, a shell — is stamped
    // too.
    timestamps: true,
    // `__v` is an optimistic-concurrency counter this module never reads, and it shows up in every
    // response body that forgets to strip it.
    versionKey: false,
  },
);

/**
 * The default page: newest first, with `_id` as the tie-breaker.
 *
 * The tie-breaker is not cosmetic. Two documents created in the same millisecond have no defined
 * order without one, so their relative position can change between two requests for consecutive
 * pages — which makes a row appear twice, or not at all. The compound index covers the sort so
 * MongoDB does not have to load and sort the whole collection to answer page one.
 */
__ENTITY_CAMEL__Schema.index({ createdAt: -1, _id: -1 });

/**
 * Supports `?sort=name`, and gives the `^`-anchored search below an index to walk instead of a
 * collection scan. An unanchored substring search cannot use it — see the note in the service.
 */
__ENTITY_CAMEL__Schema.index({ name: 1, _id: -1 });

/**
 * A model may only be registered once per connection; the second call throws `OverwriteModelError`.
 * A dev server with hot reload re-evaluates this module on every edit, so without the lookup the
 * first write after a change would crash the process instead of saving a document.
 */
export const __ENTITY_NAME__Model =
  mongoose.models[MODEL_NAME] ??
  mongoose.model(MODEL_NAME, __ENTITY_CAMEL__Schema);

/**
 * @typedef {object} __ENTITY_NAME__Record
 * @property {string} id
 * @property {string} name
 * @property {string | null} description
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * The single serialisation point for this collection.
 *
 * Mapped field by field rather than spread, so a field added to the collection — an internal flag, a
 * soft-delete marker, an owner id — cannot leak into an API response merely by existing. `_id` is
 * renamed to `id` here rather than through a `toJSON` transform, so that lean reads and hydrated
 * documents produce exactly the same shape.
 *
 * @param {Record<string, any>} doc
 * @returns {__ENTITY_NAME__Record}
 */
export function to__ENTITY_NAME__Record(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    description: doc.description ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
