/**
 * Auth endpoints (docs/api/authentication.md).
 *
 * Web clients carry the refresh token in a path-scoped httpOnly cookie so
 * script running on the page cannot read it; mobile receives it in the body
 * and stores it in SecureStore. Both paths are supported on every route that
 * takes one.
 */
import { Router } from 'express';
import { z } from 'zod';

import {
  AUDIT_EVENTS,
  LANGUAGES,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  REFRESH_TOKEN_TTL_SECONDS,
} from '../config/constants.js';
import { isProd } from '../config/env.js';
import { loginLimiter, refreshLimiter, registerLimiter } from '../middleware/rateLimits.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { auditService } from '../services/auditService.js';
import * as authService from '../services/authService.js';
import {
  REFRESH_RESULT,
  issueRefreshToken,
  revokePresentedToken,
  rotateRefreshToken,
  signAccessToken,
} from '../services/tokenService.js';
import { storedUserAgent } from '../utils/clientContext.js';
import { authenticationError } from '../utils/errors.js';
import { sendData, sendNoContent } from '../utils/respond.js';

export const authRouter = Router();

// ── Validation ───────────────────────────────────────────────────────────────

const emailSchema = z.string().trim().toLowerCase().email().max(254);
/**
 * Length only. Composition rules push people toward `Passw0rd!` and are worth
 * less than the length they cost (docs/security/authentication.md: "no
 * composition theater").
 */
const passwordSchema = z.string().min(8).max(200);

const registerSchema = z.object({
  name: z.string().trim().min(2).max(60),
  email: emailSchema,
  password: passwordSchema,
  language: z.enum(LANGUAGES).optional(),
});

const loginSchema = z.object({
  email: emailSchema,
  // Not `passwordSchema`: rejecting a short password at validation would
  // answer 422 where a real attempt answers 401, and that difference is a
  // free oracle. Any string reaches the constant-time comparison.
  password: z.string().max(200),
});

const refreshSchema = z.object({ refreshToken: z.string().optional() });

// ── Cookie handling ──────────────────────────────────────────────────────────

/**
 * SameSite=None is required for the cross-origin Vercel→Render flow and browsers
 * only accept it alongside Secure, which needs HTTPS. Local development is
 * plain http, so it falls back to Lax. This changes cookie transport only — no
 * security middleware is relaxed, and production always gets the strict pair.
 */
const cookieOptions = () => ({
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'none' : 'lax',
  path: REFRESH_COOKIE_PATH,
  maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
});

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE_NAME, token, cookieOptions());
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}

/**
 * Reads the refresh token from wherever this client keeps it. Cookies are not
 * parsed by a dependency — one name, one path, and `cookie-parser` would earn
 * its place only once several cookies exist.
 */
function presentedRefreshToken(req) {
  if (typeof req.body?.refreshToken === 'string' && req.body.refreshToken) {
    return req.body.refreshToken;
  }
  const raw = req.get('Cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === REFRESH_COOKIE_NAME) {
      const value = part.slice(index + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        // A malformed percent-escape (`rt=%`) makes decodeURIComponent throw.
        // These routes need no token, so letting it propagate would hand an
        // anonymous caller a 500 that writes a full stack trace to the log on
        // every request. An undecodable cookie is simply not a valid token.
        return null;
      }
    }
  }
  return null;
}

const audit = (req, event, userId, meta = {}) =>
  auditService.record({
    event,
    userId,
    ip: req.ip,
    meta: { userAgent: storedUserAgent(req), ...meta },
  });

// ── Routes ───────────────────────────────────────────────────────────────────

authRouter.post(
  '/register',
  registerLimiter,
  validate({ body: registerSchema }),
  async (req, res, next) => {
    try {
      const user = await authService.register(req.body);

      const refresh = await issueRefreshToken({
        userId: user._id,
        userAgent: storedUserAgent(req),
        ip: req.ip,
      });

      await audit(req, AUDIT_EVENTS.REGISTER, String(user._id));
      setRefreshCookie(res, refresh.token);

      sendData(
        res,
        {
          user: user.toPublicJSON(),
          accessToken: signAccessToken(user._id),
          refreshToken: refresh.token,
        },
        { status: 201 },
      );
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post('/login', loginLimiter, validate({ body: loginSchema }), async (req, res, next) => {
  try {
    let user;
    try {
      user = await authService.login(req.body);
    } catch (err) {
      // Audited without the email, so the log cannot become the account list
      // an attacker could not obtain from the API.
      await audit(req, AUDIT_EVENTS.LOGIN_FAILED, undefined, { route: 'login' });
      throw err;
    }

    const refresh = await issueRefreshToken({
      userId: user._id,
      userAgent: storedUserAgent(req),
      ip: req.ip,
    });

    await audit(req, AUDIT_EVENTS.LOGIN, String(user._id));
    setRefreshCookie(res, refresh.token);

    sendData(res, {
      user: user.toPublicJSON(),
      accessToken: signAccessToken(user._id),
      refreshToken: refresh.token,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post(
  '/refresh',
  refreshLimiter,
  validate({ body: refreshSchema }),
  async (req, res, next) => {
    try {
      const presented = presentedRefreshToken(req);
      const outcome = await rotateRefreshToken({
        presented,
        userAgent: storedUserAgent(req),
        ip: req.ip,
      });

      if (outcome.result === REFRESH_RESULT.REUSED) {
        // The family was killed inside the rotation call. Everything here is
        // about telling the truth to the log and nothing to the caller: the
        // 401 is identical to the one an unknown token receives.
        await audit(req, AUDIT_EVENTS.TOKEN_REUSE, outcome.userId, {
          familyId: outcome.familyId,
        });
        clearRefreshCookie(res);
        throw authenticationError('auth.invalidToken');
      }

      if (outcome.result !== REFRESH_RESULT.OK) {
        clearRefreshCookie(res);
        throw authenticationError('auth.invalidToken');
      }

      await audit(req, AUDIT_EVENTS.TOKEN_REFRESH, outcome.userId);
      setRefreshCookie(res, outcome.token);

      sendData(res, {
        accessToken: signAccessToken(outcome.userId),
        refreshToken: outcome.token,
      });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  '/logout',
  requireAuth,
  validate({ body: refreshSchema }),
  async (req, res, next) => {
    try {
      await revokePresentedToken(presentedRefreshToken(req));
      await audit(req, AUDIT_EVENTS.LOGOUT, req.auth.userId);
      clearRefreshCookie(res);
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  },
);

authRouter.get('/me', requireAuth, (req, res) => {
  sendData(res, { user: req.user.toPublicJSON() });
});
