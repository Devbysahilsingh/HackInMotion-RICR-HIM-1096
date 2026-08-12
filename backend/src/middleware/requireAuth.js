/**
 * Access-token gate.
 *
 * Every failure — missing header, malformed header, forged signature, expired
 * token, unknown user — produces exactly one response: 401 with the generic
 * key. Distinguishing them would tell an attacker which of their guesses was
 * closest.
 */
import { AUDIT_EVENTS } from '../config/constants.js';
import { User } from '../models/index.js';
import { AppError } from '../utils/errors.js';
import { verifyAccessToken } from '../services/tokenService.js';

const invalidToken = () => new AppError('AUTHENTICATION_ERROR', 'auth.invalidToken');

/** Extracts a bearer token, tolerating case but not extra parts. */
function bearerToken(req) {
  const header = req.get('Authorization');
  if (!header) return null;
  const [scheme, value, ...rest] = header.split(' ');
  if (rest.length > 0 || !value) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;
  return value;
}

export async function requireAuth(req, res, next) {
  try {
    const token = bearerToken(req);
    if (!token) return next(invalidToken());

    const claims = verifyAccessToken(token);
    if (!claims) return next(invalidToken());

    // The token proves the claim was signed; it does not prove the account
    // still exists. A deleted user must not keep API access until expiry.
    const user = await User.findById(claims.userId);
    if (!user) return next(invalidToken());

    req.user = user;
    req.auth = { userId: String(user._id), jti: claims.jti };
    next();
  } catch (err) {
    next(err);
  }
}

export { AUDIT_EVENTS };
