/**
 * Nothing here catches. Express 5 forwards a throw and a rejected promise to the error
 * middleware, which is the one place a ZodError or a not-found should turn into a response.
 */
import type { Request, Response } from 'express';

import {
  create__ENTITY_NAME__Schema,
  list__ENTITY_PLURAL__QuerySchema,
  update__ENTITY_NAME__Schema,
} from '../models/__ENTITY_KEBAB__.model__IMPORT_SUFFIX__';
import {
  create__ENTITY_NAME__,
  delete__ENTITY_NAME__,
  get__ENTITY_NAME__,
  list__ENTITY_PLURAL__,
  update__ENTITY_NAME__,
} from '../services/__ENTITY_KEBAB__.service__IMPORT_SUFFIX__';

/** Typed params, so `req.params.id` is a `string` and not `string | undefined`. */
type IdRequest = Request<{ id: string }>;

export const __ENTITY_CAMEL__Controller = {
  create: async (req: Request, res: Response): Promise<void> => {
    const input = create__ENTITY_NAME__Schema.parse(req.body);
    const created = await create__ENTITY_NAME__(input);

    res.status(201).json(created);
  },

  list: async (req: Request, res: Response): Promise<void> => {
    const query = list__ENTITY_PLURAL__QuerySchema.parse(req.query);
    const page = await list__ENTITY_PLURAL__(query);

    res.status(200).json(page);
  },

  get: async (req: IdRequest, res: Response): Promise<void> => {
    const found = await get__ENTITY_NAME__(req.params.id);

    res.status(200).json(found);
  },

  update: async (req: IdRequest, res: Response): Promise<void> => {
    const input = update__ENTITY_NAME__Schema.parse(req.body);
    const updated = await update__ENTITY_NAME__(req.params.id, input);

    res.status(200).json(updated);
  },

  remove: async (req: IdRequest, res: Response): Promise<void> => {
    await delete__ENTITY_NAME__(req.params.id);

    res.status(204).end();
  },
};
