/**
 * Token issue, verification and rotation.
 *
 * Two very different credentials live here:
 *   - the ACCESS token: a short-lived signed JWT the client sends on every call
 *   - the REFRESH token: a long-lived opaque random string, stored only as a
 *     sha256 hash, that can be exchanged for a new pair exactly once
 *
 * The refresh token is not a JWT on purpose. It has to be revocable, and a
 * self-contained signed token cannot be revoked without a server-side list —
 * at which point the signature is doing no work.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

import {
  ACCESS_TOKEN_TTL_SECONDS,
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
  REFRESH_TOKEN_TTL_SECONDS,
} from '../config/constants.js';
import { requireSecret } from '../config/env.js';
import { RefreshToken } from '../models/index.js';

const secret = () => requireSecret('JWT_SECRET');

// ── Access tokens ────────────────────────────────────────────────────────────

/**
 * Claims carry no PII and no roles — only who, which token, and when.
 * @param {string} userId
 */
export function signAccessToken(userId) {
  return jwt.sign({}, secret(), {
    subject: String(userId),
    jwtid: randomUUID(),
    algorithm: JWT_ALGORITHM,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

/**
 * Verification pins the algorithm, issuer and audience.
 *
 * `algorithms` is the important one: without an explicit allowlist, a token
 * presenting `alg: none` — or one signed with the public half of an asymmetric
 * pair — can be accepted. Every failure mode returns null; the caller turns
 * that into one generic 401 so nothing distinguishes expired from forged.
 *
 * @returns {{ userId: string, jti: string } | null}
 */
export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, secret(), {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return { userId: payload.sub, jti: payload.jti };
  } catch {
    return null;
  }
}

// ── Refresh tokens ───────────────────────────────────────────────────────────

/** 256 bits of entropy; the raw value is shown to the client exactly once. */
const mintRefreshValue = () => randomBytes(32).toString('base64url');

/** Only the digest is ever persisted, so a database leak yields nothing usable. */
export const hashRefreshToken = (token) => createHash('sha256').update(token).digest('hex');

const expiryFromNow = () => new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);

/**
 * Issues a refresh token into a family. A fresh login starts a new family; a
 * rotation continues the existing one, which is what lets reuse detection kill
 * a whole compromised lineage rather than a single token.
 *
 * @param {{ userId: string, familyId?: string, userAgent?: string, ip?: string }} params
 * @returns {Promise<{ token: string, jti: string, familyId: string, expiresAt: Date }>}
 */
export async function issueRefreshToken({ userId, familyId, userAgent, ip }) {
  const token = mintRefreshValue();
  const jti = randomUUID();
  const family = familyId ?? randomUUID();
  const expiresAt = expiryFromNow();

  await RefreshToken.create({
    userId,
    tokenHash: hashRefreshToken(token),
    familyId: family,
    jti,
    expiresAt,
    userAgent,
    ip,
  });

  return { token, jti, familyId: family, expiresAt };
}

/** Outcomes of presenting a refresh token, so callers never guess from nulls. */
export const REFRESH_RESULT = {
  OK: 'ok',
  UNKNOWN: 'unknown',
  EXPIRED: 'expired',
  /** First detection of a replay: this is the compromise signal. */
  REUSED: 'reused',
  /** A token from a family that was already killed — no new information. */
  DEAD_FAMILY: 'dead_family',
};

/**
 * Rotates a presented refresh token.
 *
 * The security-critical branch is REUSED: a token that was already rotated
 * being presented again means either the client replayed it or an attacker
 * stole it. We cannot tell which, so we assume theft and revoke the entire
 * family — killing the attacker's session and forcing the real user to log in
 * again. Revoked rows are left in place until their TTL so this stays
 * detectable.
 *
 * Note the deliberate ordering trade-off: the presented token is revoked
 * *before* its successor is minted. That means a crash between the two writes
 * logs the client out, where revoking last would have kept them signed in. The
 * atomic claim is worth that, because revoking last is exactly what allows two
 * concurrent presentations of one token to both succeed — which would defeat
 * reuse detection entirely.
 *
 * @returns {Promise<{ result: string, userId?: string, token?: string, familyId?: string }>}
 */
export async function rotateRefreshToken({ presented, userAgent, ip }) {
  if (!presented || typeof presented !== 'string') return { result: REFRESH_RESULT.UNKNOWN };

  const tokenHash = hashRefreshToken(presented);

  /**
   * Claim the token by revoking it, and treat the revocation itself as the
   * guard. `findOneAndUpdate` is a single atomic document operation, so of two
   * concurrent requests presenting the same token exactly one can match
   * `revokedAt: {$exists: false}` — the loser gets null and is handled as a
   * replay.
   *
   * A read-then-write here would let both requests pass the revoked check
   * before either wrote, minting two live lineages from one token and firing
   * no reuse audit at all: precisely the theft the family mechanism exists to
   * catch. ADR-002 rules out transactions, so the atomicity has to come from
   * the single-document update.
   */
  const claimed = await RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
    { new: false },
  );

  if (claimed) {
    if (claimed.expiresAt.getTime() <= Date.now()) {
      return { result: REFRESH_RESULT.EXPIRED, userId: String(claimed.userId) };
    }

    const successor = await issueRefreshToken({
      userId: claimed.userId,
      familyId: claimed.familyId,
      userAgent,
      ip,
    });

    await RefreshToken.updateOne({ _id: claimed._id }, { $set: { replacedByJti: successor.jti } });

    return {
      result: REFRESH_RESULT.OK,
      userId: String(claimed.userId),
      token: successor.token,
      familyId: successor.familyId,
    };
  }

  // Nothing claimable: either the token does not exist, or it was already
  // revoked — by a previous rotation, a logout, or the request that won the
  // race above.
  const existing = await RefreshToken.findOne({ tokenHash });
  if (!existing) return { result: REFRESH_RESULT.UNKNOWN };

  if (existing.revokedAt) {
    // Killing the family is what makes a stolen token worthless. The count
    // tells us whether this is the *first* detection: once the family is
    // already dead, further presentations are the legitimate client retrying
    // with a token it does not yet know is invalid. Auditing those as fresh
    // compromises would flood the very metric used to spot a real theft.
    const revokedNow = await revokeFamily(existing.familyId);

    return {
      result: revokedNow > 0 ? REFRESH_RESULT.REUSED : REFRESH_RESULT.DEAD_FAMILY,
      userId: String(existing.userId),
      familyId: existing.familyId,
    };
  }

  // Unreachable in practice: a row that exists, is not revoked, and still
  // failed to be claimed. Refusing is the safe direction.
  return { result: REFRESH_RESULT.UNKNOWN, userId: String(existing.userId) };
}

/**
 * Revokes every still-live token descended from one login.
 * @returns {Promise<number>} how many were revoked by this call — 0 means the
 *   family was already dead.
 */
export async function revokeFamily(familyId) {
  const result = await RefreshToken.updateMany(
    { familyId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
  return result.modifiedCount ?? 0;
}

/**
 * Logout. Idempotent by design: presenting an unknown or already-revoked
 * token still succeeds, because the caller's intent — "end this session" — is
 * satisfied either way, and reporting the difference would leak whether a
 * token was ever valid.
 */
export async function revokePresentedToken(presented) {
  if (!presented || typeof presented !== 'string') return;
  await RefreshToken.updateOne(
    { tokenHash: hashRefreshToken(presented), revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
}

/** Used by password change and account deletion. */
export async function revokeAllForUser(userId) {
  await RefreshToken.updateMany(
    { userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
}
