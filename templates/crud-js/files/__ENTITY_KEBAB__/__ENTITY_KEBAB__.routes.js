/**
 * The __ENTITY_TITLE__ router.
 *
 * Mount it with `app.use('/__ENTITY_PLURAL_KEBAB__', __ENTITY_CAMEL__Router)`.
 */
import { json, Router } from 'express';

import { __ENTITY_CAMEL__Controller } from './__ENTITY_KEBAB__.controller__IMPORT_SUFFIX__';

export const __ENTITY_CAMEL__Router = Router();

// A __ENTITY_TITLE__ body is small, so cap it here rather than letting a huge POST be buffered in
// full before any handler gets to reject it.
__ENTITY_CAMEL__Router.use(json({ limit: '64kb' }));

__ENTITY_CAMEL__Router.post('/', __ENTITY_CAMEL__Controller.create);
__ENTITY_CAMEL__Router.get('/', __ENTITY_CAMEL__Controller.list);
__ENTITY_CAMEL__Router.get('/:id', __ENTITY_CAMEL__Controller.get);
__ENTITY_CAMEL__Router.patch('/:id', __ENTITY_CAMEL__Controller.update);
__ENTITY_CAMEL__Router.delete('/:id', __ENTITY_CAMEL__Controller.remove);

export default __ENTITY_CAMEL__Router;
