/**
 * Ownership middleware factory (authorization invariants AU-1..AU-4).
 *
 * The contract this exists to enforce: **no handler ever queries by a bare
 * id**. A handler that does `Model.findById(req.params.id)` is one review slip
 * away from serving another farmer's data, so ownership is applied here, once,
 * and handlers receive an already-authorized document.
 *
 * Ownership failure and non-existence are the same response — 404 — because
 * distinguishing them tells a caller that a resource they cannot see exists.
 */
import mongoose from 'mongoose';

import { notFound } from '../utils/errors.js';

/**
 * @param {object} config
 * @param {import('mongoose').Model} config.model         collection to load from
 * @param {string} [config.param='id']                    path parameter holding the id
 * @param {string} [config.as]                            request property to attach to
 * @param {{ model: import('mongoose').Model, foreignKey: string, param?: string, as?: string }} [config.parent]
 *        Verifies the full chain rather than the leaf alone (AU-3): a crop is
 *        reachable only if its farm also belongs to the caller.
 * @param {string[]} [config.select]                      fields to omit/include
 */
export function loadOwned({ model, param = 'id', as, parent, select }) {
  const attachAs = as ?? model.modelName.charAt(0).toLowerCase() + model.modelName.slice(1);

  return async function loadOwnedMiddleware(req, res, next) {
    try {
      const id = req.params[param];

      // Reject malformed ids before they reach Mongo. A CastError would
      // otherwise surface as a 500 and, worse, confirm by its shape that the
      // id was merely malformed rather than unowned.
      if (!mongoose.isValidObjectId(id)) return next(notFound());

      // userId is part of the filter, not a check performed after loading:
      // the database never returns another user's document in the first place.
      const query = model.findOne({ _id: id, userId: req.auth.userId });
      if (select) query.select(select.join(' '));

      const document = await query;
      if (!document) return next(notFound());

      if (parent) {
        const parentId = document[parent.foreignKey];
        if (!parentId) return next(notFound());

        const parentDoc = await parent.model.findOne({
          _id: parentId,
          userId: req.auth.userId,
        });
        // A leaf whose parent is not owned is unreachable even though the leaf
        // itself carried a matching userId — the denormalized field could be
        // stale or wrong, and the chain is the authority.
        if (!parentDoc) return next(notFound());

        req[parent.as ?? 'parent'] = parentDoc;
      }

      req[attachAs] = document;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Ownership check for an id that names a *container* for a create/list call
 * (e.g. POST /farms/:farmId/crops), where nothing is being loaded for the
 * handler to mutate but the parent must still belong to the caller.
 */
export function requireOwnedParent({ model, param, as }) {
  return loadOwned({ model, param, as: as ?? 'parentResource' });
}

/** Scopes every list query to the caller. Never post-filter (AU-4). */
export const ownedBy = (req) => ({ userId: req.auth.userId });
