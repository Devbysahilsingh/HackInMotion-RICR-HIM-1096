import { randomUUID } from 'node:crypto';

/**
 * Assigns a correlation id to every request and echoes it back, so client
 * reports, backend logs and ml-service calls can be tied together.
 */
export function requestId(req, res, next) {
  const incoming = req.get('X-Request-Id');
  // Accept only well-formed inbound ids; otherwise mint our own (no header injection).
  const id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.set('X-Request-Id', id);
  next();
}
