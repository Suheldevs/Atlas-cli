import { randomUUID } from 'node:crypto';

import type {
  __ENTITY_NAME__,
  Create__ENTITY_NAME__Input,
  List__ENTITY_PLURAL__Query,
  Update__ENTITY_NAME__Input,
} from '../models/__ENTITY_KEBAB__.model__IMPORT_SUFFIX__';

/** `status` is here so your error middleware can render this without a lookup table. */
export class __ENTITY_NAME__NotFoundError extends Error {
  readonly status = 404;
  readonly code = '__ENTITY_KEBAB__-not-found';

  constructor(id: string) {
    super(`No __ENTITY_TITLE__ with id '${id}'.`);
    this.name = '__ENTITY_NAME__NotFoundError';
  }
}

export interface List__ENTITY_PLURAL__Result {
  data: __ENTITY_NAME__[];
  total: number;
  limit: number;
  offset: number;
}

// In-memory so the endpoints work the moment they are generated. Replace it with your database:
// each function below is one query, and nothing outside this file knows where the data lives.
const store = new Map<string, __ENTITY_NAME__>();

function matchesSearch(record: __ENTITY_NAME__, search: string | undefined): boolean {
  if (search === undefined || search === '') {
    return true;
  }

  const needle = search.toLowerCase();

  return (
    record.name.toLowerCase().includes(needle) ||
    (record.description ?? '').toLowerCase().includes(needle)
  );
}

export async function create__ENTITY_NAME__(
  input: Create__ENTITY_NAME__Input,
): Promise<__ENTITY_NAME__> {
  const now = new Date();

  const record: __ENTITY_NAME__ = {
    id: randomUUID(),
    name: input.name,
    description: input.description,
    createdAt: now,
    updatedAt: now,
  };

  store.set(record.id, record);

  return record;
}

export async function list__ENTITY_PLURAL__(
  query: List__ENTITY_PLURAL__Query,
): Promise<List__ENTITY_PLURAL__Result> {
  const matched = [...store.values()]
    .filter((record) => matchesSearch(record, query.search))
    // Newest first, id as tie-breaker: without one, pages reshuffle between requests and rows
    // get skipped or repeated.
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id));

  return {
    data: matched.slice(query.offset, query.offset + query.limit),
    total: matched.length,
    limit: query.limit,
    offset: query.offset,
  };
}

export async function get__ENTITY_NAME__(id: string): Promise<__ENTITY_NAME__> {
  const record = store.get(id);

  if (record === undefined) {
    throw new __ENTITY_NAME__NotFoundError(id);
  }

  return record;
}

export async function update__ENTITY_NAME__(
  id: string,
  input: Update__ENTITY_NAME__Input,
): Promise<__ENTITY_NAME__> {
  const current = await get__ENTITY_NAME__(id);

  // Only the fields the client sent change; anything omitted keeps its current value.
  const updated: __ENTITY_NAME__ = {
    ...current,
    name: input.name ?? current.name,
    description: input.description ?? current.description,
    updatedAt: new Date(),
  };

  store.set(id, updated);

  return updated;
}

export async function delete__ENTITY_NAME__(id: string): Promise<void> {
  if (!store.delete(id)) {
    throw new __ENTITY_NAME__NotFoundError(id);
  }
}
