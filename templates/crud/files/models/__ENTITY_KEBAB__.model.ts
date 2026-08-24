/** The __ENTITY_TITLE__ shape and the Zod schemas the HTTP layer validates against. */
import * as z from 'zod';

const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_SEARCH_LENGTH = 200;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface __ENTITY_NAME__ {
  id: string;
  name: string;
  description: string | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export const create__ENTITY_NAME__Schema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(MAX_NAME_LENGTH),
  description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).optional(),
});

// A PATCH with no fields is a client bug, not a no-op, so it gets a 400 rather than a 200.
export const update__ENTITY_NAME__Schema = create__ENTITY_NAME__Schema
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Send at least one field to update.');

export const list__ENTITY_PLURAL__QuerySchema = z.object({
  // Bounded: an unbounded limit lets one request ask for the whole table.
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().trim().max(MAX_SEARCH_LENGTH).optional(),
});

export type Create__ENTITY_NAME__Input = z.infer<typeof create__ENTITY_NAME__Schema>;
export type Update__ENTITY_NAME__Input = z.infer<typeof update__ENTITY_NAME__Schema>;
export type List__ENTITY_PLURAL__Query = z.infer<typeof list__ENTITY_PLURAL__QuerySchema>;
