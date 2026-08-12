/**
 * Canonical success envelope (docs/api/error-codes.md).
 * The error side lives in middleware/errorHandler.js so that every failure
 * path — thrown, rejected or raised by Express itself — converges on one
 * writer rather than being re-implemented per controller.
 */

/**
 * @param {import('express').Response} res
 * @param {unknown} data
 * @param {{ status?: number, meta?: Record<string, unknown> }} [options]
 */
export function sendData(res, data, options = {}) {
  const { status = 200, meta } = options;
  res.status(status).json({
    success: true,
    data,
    ...(meta ? { meta } : {}),
  });
}

/** 204 carries no envelope — there is no body to wrap. */
export function sendNoContent(res) {
  res.status(204).end();
}

/**
 * Pagination meta (docs/api/error-codes.md: `meta: {page, limit, total}`).
 * @param {{ page: number, limit: number, total: number }} paging
 */
export const pageMeta = ({ page, limit, total }) => ({ page, limit, total });
