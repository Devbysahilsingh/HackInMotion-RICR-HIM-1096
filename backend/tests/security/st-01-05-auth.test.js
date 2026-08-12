/**
 * ST-01..05 — Auth suites [blocking].
 *
 * docs/security/security-testing.md, verbatim:
 *   "brute-force lockout behavior; enumeration uniformity (message+status
 *    parity); token-in-memory only (no localStorage writes — web test);
 *    refresh rotation + reuse → family revocation; JWT tamper/expiry/alg-none/
 *    audience suite."
 *
 * ST-03 is a web-client assertion (no localStorage writes) and belongs to the
 * frontend suite in Phase 5. Its server-side half — the refresh cookie being
 * unreadable by script — is asserted here instead.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

import {
  BCRYPT_COST,
  JWT_AUDIENCE,
  JWT_ISSUER,
  MAX_STORED_USER_AGENT,
  REFRESH_COOKIE_PATH,
} from '../../src/config/constants.js';
import { requireSecret } from '../../src/config/env.js';
import { AuditLog, RefreshToken, User } from '../../src/models/index.js';
import { hashRefreshToken } from '../../src/services/tokenService.js';
import { startTestServer } from '../helpers/app.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

const CREDENTIALS = {
  name: 'Ramesh Patel',
  email: 'ramesh@example.com',
  password: 'correct horse battery',
  language: 'hi',
};

describe('ST-01..05 · Authentication', () => {
  let server;

  before(async () => {
    await startTestDatabase();
    server = await startTestServer();
  });

  after(async () => {
    await server.close();
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearCollections();
    delete process.env.RATE_LIMITS_ENABLED;
  });

  const register = (overrides = {}) =>
    server.request('/api/v1/auth/register', {
      method: 'POST',
      body: { ...CREDENTIALS, ...overrides },
    });

  const login = (overrides = {}) =>
    server.request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: CREDENTIALS.email, password: CREDENTIALS.password, ...overrides },
    });

  // ── ST-01 · Brute force ────────────────────────────────────────────────────

  describe('ST-01 · brute-force lockout', () => {
    it('blocks the 6th login attempt in the window for one IP+email', async () => {
      await register();
      process.env.RATE_LIMITS_ENABLED = 'true';

      const statuses = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const res = await login({ password: 'wrong-password' });
        statuses.push(res.status);
      }

      assert.deepEqual(statuses.slice(0, 5), [401, 401, 401, 401, 401]);
      assert.equal(statuses[5], 429, 'the 6th attempt was not rate limited');
    });

    it('returns Retry-After and the canonical envelope when limited', async () => {
      await register();
      process.env.RATE_LIMITS_ENABLED = 'true';

      let res;
      for (let attempt = 0; attempt < 6; attempt += 1) res = await login({ password: 'nope' });

      assert.equal(res.status, 429);
      assert.equal(res.body.error.code, 'RATE_LIMITED');
      assert.ok(Number(res.headers.get('retry-after')) > 0);
    });

    it('keys the bucket on email as well as IP', async () => {
      await register();
      await register({ email: 'other@example.com' });
      process.env.RATE_LIMITS_ENABLED = 'true';

      for (let attempt = 0; attempt < 6; attempt += 1) await login({ password: 'wrong' });

      // Same IP, different account: must not be collateral damage.
      const other = await server.request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: 'other@example.com', password: CREDENTIALS.password },
      });
      assert.equal(other.status, 200, 'a different account was locked out by IP alone');
    });

    it('cannot be reset by a spoofed X-Forwarded-For', async () => {
      await register();
      process.env.RATE_LIMITS_ENABLED = 'true';

      // Whoever controls req.ip controls the bucket. Outside production there
      // is no proxy to trust, so a forwarding header must not be authoritative.
      const statuses = [];
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const res = await server.request('/api/v1/auth/login', {
          method: 'POST',
          body: { email: CREDENTIALS.email, password: 'wrong-password' },
          headers: { 'X-Forwarded-For': `203.0.113.${attempt}` },
        });
        statuses.push(res.status);
      }

      assert.ok(
        statuses.includes(429),
        `rotating X-Forwarded-For evaded the login bucket: ${statuses}`,
      );
    });

    it('audits the rate-limit trip itself, not only the attempts below it', async () => {
      await register();
      process.env.RATE_LIMITS_ENABLED = 'true';

      for (let attempt = 0; attempt < 7; attempt += 1) await login({ password: 'wrong' });

      const limited = await AuditLog.find({ event: 'rate_limited' });
      assert.ok(
        limited.length > 0,
        'no rate_limited audit rows — the brute-force signal is invisible past the threshold',
      );
    });

    it('bounds the stored User-Agent so it cannot be used to fill the cluster', async () => {
      const huge = 'U'.repeat(6000);
      await server.request('/api/v1/auth/register', {
        method: 'POST',
        body: { ...CREDENTIALS, email: 'bigagent@example.com' },
        headers: { 'User-Agent': huge },
      });

      const stored = await RefreshToken.findOne({}).sort({ createdAt: -1 });
      assert.ok(stored.userAgent.length <= MAX_STORED_USER_AGENT);

      const audited = await AuditLog.findOne({ event: 'register' });
      assert.ok(audited.meta.userAgent.length <= MAX_STORED_USER_AGENT);
    });

    it('records login_failed audit rows without storing the attempted email', async () => {
      await register();
      await login({ password: 'wrong' });

      const rows = await AuditLog.find({ event: 'login_failed' });
      assert.equal(rows.length, 1);
      assert.ok(!JSON.stringify(rows[0].meta).includes(CREDENTIALS.email));
    });

    it('hashes passwords with bcrypt cost 12', async () => {
      await register();
      const user = await User.findOne({ email: CREDENTIALS.email }).select('+passwordHash');
      assert.match(user.passwordHash, /^\$2[aby]\$12\$/);
      assert.equal(BCRYPT_COST, 12);
    });
  });

  // ── ST-02 · Enumeration ────────────────────────────────────────────────────

  describe('ST-02 · account-enumeration uniformity', () => {
    it('answers identically for an unknown email and a wrong password', async () => {
      await register();

      const unknownEmail = await login({ email: 'nobody@example.com', password: 'whatever' });
      const wrongPassword = await login({ password: 'definitely-wrong' });

      assert.equal(unknownEmail.status, wrongPassword.status);
      assert.equal(unknownEmail.status, 401);
      // Byte-identical apart from the per-request correlation id.
      assert.deepEqual(unknownEmail.body.error, wrongPassword.body.error);
      assert.deepEqual(unknownEmail.body.error, {
        code: 'AUTHENTICATION_ERROR',
        messageKey: 'auth.invalidCredentials',
      });
    });

    it('does not leak existence through response timing', async () => {
      await register();

      const timed = async (body) => {
        const started = process.hrtime.bigint();
        await server.request('/api/v1/auth/login', { method: 'POST', body });
        return Number(process.hrtime.bigint() - started) / 1e6;
      };

      // Both paths must run a real bcrypt comparison. Five samples, compared on
      // the median, keeps this from flaking on a noisy machine while still
      // failing loudly if the unknown-email path short-circuits.
      const known = [];
      const unknown = [];
      for (let i = 0; i < 5; i += 1) {
        known.push(await timed({ email: CREDENTIALS.email, password: 'wrong' }));
        unknown.push(await timed({ email: `ghost${i}@example.com`, password: 'wrong' }));
      }

      const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      const ratio = median(known) / median(unknown);
      assert.ok(
        ratio > 0.4 && ratio < 2.5,
        `timing differs too much between known and unknown accounts (ratio ${ratio.toFixed(2)})`,
      );
    });

    it('answers a duplicate registration with the shared non-specific key', async () => {
      await register();
      const duplicate = await register({ name: 'Someone Else' });

      assert.equal(duplicate.status, 409);
      assert.equal(duplicate.body.error.code, 'CONFLICT');
      assert.equal(duplicate.body.error.messageKey, 'auth.registerFailed');
      assert.ok(!duplicate.text.toLowerCase().includes('already'));
      assert.ok(!duplicate.text.includes(CREDENTIALS.email));
    });

    it('rejects a short password at login with 401, not 422', async () => {
      // A 422 here would reveal that the account exists but the guess was too
      // short to be its password — a free length oracle.
      await register();
      const res = await login({ password: 'x' });
      assert.equal(res.status, 401);
    });
  });

  // ── ST-03 · Token handling ─────────────────────────────────────────────────

  describe('ST-03 · token handling', () => {
    it('issues the refresh cookie httpOnly and path-scoped to the auth routes', async () => {
      const res = await register();
      const cookie = res.headers.get('set-cookie');

      assert.ok(cookie, 'no refresh cookie was set');
      assert.match(cookie, /^rt=/);
      assert.match(cookie, /HttpOnly/i, 'refresh cookie is readable by script');
      assert.match(cookie, new RegExp(`Path=${REFRESH_COOKIE_PATH}`, 'i'));
    });

    it('never serializes the password hash', async () => {
      const registered = await register();
      const me = await server.request('/api/v1/auth/me', {
        token: registered.body.data.accessToken,
      });

      assert.equal(me.status, 200);
      for (const payload of [registered.text, me.text]) {
        assert.ok(!payload.includes('passwordHash'));
        assert.ok(!payload.includes('$2b$'));
      }
      assert.deepEqual(Object.keys(me.body.data.user).sort(), [
        'communityConsent',
        'createdAt',
        'email',
        'id',
        'language',
        'name',
        'units',
        'voiceEnabled',
      ]);
    });

    it('stores only a hash of the refresh token', async () => {
      const res = await register();
      const raw = res.body.data.refreshToken;

      const stored = await RefreshToken.findOne({ tokenHash: hashRefreshToken(raw) });
      assert.ok(stored, 'refresh token was not stored under its hash');

      const byRaw = await RefreshToken.findOne({ tokenHash: raw });
      assert.equal(byRaw, null, 'the raw refresh token is stored verbatim');
    });
  });

  // ── ST-04 · Refresh rotation and reuse ─────────────────────────────────────

  describe('ST-04 · refresh rotation and reuse detection', () => {
    const refresh = (refreshToken) =>
      server.request('/api/v1/auth/refresh', { method: 'POST', body: { refreshToken } });

    it('rotates: the presented token is revoked and a successor issued in the same family', async () => {
      const first = (await register()).body.data.refreshToken;
      const rotated = await refresh(first);

      assert.equal(rotated.status, 200);
      const second = rotated.body.data.refreshToken;
      assert.notEqual(second, first);

      const oldRow = await RefreshToken.findOne({ tokenHash: hashRefreshToken(first) });
      const newRow = await RefreshToken.findOne({ tokenHash: hashRefreshToken(second) });

      assert.ok(oldRow.revokedAt, 'the presented token was not revoked');
      assert.equal(oldRow.replacedByJti, newRow.jti);
      assert.equal(oldRow.familyId, newRow.familyId, 'successor started a new family');
      assert.equal(newRow.revokedAt, undefined);
    });

    it('replaying a rotated token revokes the ENTIRE family and audits token_reuse', async () => {
      const first = (await register()).body.data.refreshToken;
      const second = (await refresh(first)).body.data.refreshToken;
      const third = (await refresh(second)).body.data.refreshToken;

      // The attacker replays the stolen, already-rotated token.
      const replay = await refresh(first);
      assert.equal(replay.status, 401);
      assert.equal(replay.body.error.code, 'AUTHENTICATION_ERROR');

      const familyId = (await RefreshToken.findOne({ tokenHash: hashRefreshToken(first) }))
        .familyId;
      const family = await RefreshToken.find({ familyId });
      assert.ok(family.length >= 3);
      for (const row of family) {
        assert.ok(row.revokedAt, `token ${row.jti} survived the family revocation`);
      }

      // The legitimate user's newest token is dead too — that is the point.
      assert.equal((await refresh(third)).status, 401);

      const audits = await AuditLog.find({ event: 'token_reuse' });
      assert.equal(audits.length, 1);
      assert.equal(audits[0].meta.familyId, familyId);
    });

    it('two concurrent presentations of one token yield exactly one new session', async () => {
      const first = (await register()).body.data.refreshToken;

      // The realistic theft window: the attacker replays the stolen token at
      // the same moment the legitimate client rotates it. A read-then-write
      // rotation lets both succeed and audits nothing.
      const [a, b] = await Promise.all([refresh(first), refresh(first)]);

      const statuses = [a.status, b.status].sort();
      assert.deepEqual(statuses, [200, 401], `one must win and one must fail, got ${statuses}`);

      const winner = a.status === 200 ? a : b;
      const successor = winner.body.data.refreshToken;

      // The loser's 401 is a replay, so the family dies — including the
      // successor the winner just received.
      assert.equal((await refresh(successor)).status, 401, 'the family survived a detected replay');

      const audits = await AuditLog.find({ event: 'token_reuse' });
      assert.equal(audits.length, 1, 'the replay was not audited exactly once');
    });

    it('does not touch other families when one is revoked', async () => {
      const sessionA = (await register()).body.data.refreshToken;
      const sessionB = (await login()).body.data.refreshToken; // separate login = separate family

      const rotatedA = (await refresh(sessionA)).body.data.refreshToken;
      await refresh(sessionA); // reuse → family A dies

      assert.equal((await refresh(rotatedA)).status, 401, 'family A survived');
      assert.equal((await refresh(sessionB)).status, 200, 'family B was wrongly revoked');
    });

    it('rejects unknown and expired refresh tokens with the same 401', async () => {
      const unknown = await refresh('not-a-real-token');
      assert.equal(unknown.status, 401);

      const issued = (await register()).body.data.refreshToken;
      await RefreshToken.updateOne(
        { tokenHash: hashRefreshToken(issued) },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );
      const expired = await refresh(issued);

      assert.equal(expired.status, 401);
      assert.deepEqual(expired.body.error, unknown.body.error);
    });

    it('logout revokes the presented token and is idempotent', async () => {
      const registered = await register();
      const { accessToken, refreshToken } = registered.body.data;

      const first = await server.request('/api/v1/auth/logout', {
        method: 'POST',
        token: accessToken,
        body: { refreshToken },
      });
      assert.equal(first.status, 204);

      const row = await RefreshToken.findOne({ tokenHash: hashRefreshToken(refreshToken) });
      assert.ok(row.revokedAt);

      // Repeating it must not error, and must not report anything different.
      const second = await server.request('/api/v1/auth/logout', {
        method: 'POST',
        token: accessToken,
        body: { refreshToken },
      });
      assert.equal(second.status, 204);

      assert.equal((await refresh(refreshToken)).status, 401);
    });
  });

  // ── ST-05 · JWT integrity ──────────────────────────────────────────────────

  describe('ST-05 · JWT tamper, expiry, alg-none and audience', () => {
    const me = (token) => server.request('/api/v1/auth/me', { token });

    it('accepts a genuine token', async () => {
      const { accessToken } = (await register()).body.data;
      assert.equal((await me(accessToken)).status, 200);
    });

    it('rejects a tampered payload', async () => {
      const { accessToken } = (await register()).body.data;
      const [header, , signature] = accessToken.split('.');
      const forgedPayload = Buffer.from(
        JSON.stringify({ sub: '000000000000000000000000', iss: JWT_ISSUER, aud: JWT_AUDIENCE }),
      ).toString('base64url');

      assert.equal((await me(`${header}.${forgedPayload}.${signature}`)).status, 401);
    });

    it('rejects an alg:none token', async () => {
      const user = await User.findOne({}).lean();
      const registered = await register();
      const subject = registered.body.data.user.id ?? user?._id;

      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          sub: String(subject),
          iss: JWT_ISSUER,
          aud: JWT_AUDIENCE,
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString('base64url');

      assert.equal((await me(`${header}.${payload}.`)).status, 401);
    });

    it('rejects a token signed with a different secret', async () => {
      const { user } = (await register()).body.data;
      const forged = jwt.sign({}, 'an-attacker-controlled-secret-value-32ch', {
        subject: user.id,
        algorithm: 'HS256',
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expiresIn: 3600,
      });

      assert.equal((await me(forged)).status, 401);
    });

    it('rejects an expired token', async () => {
      const { user } = (await register()).body.data;
      const expired = jwt.sign({}, requireSecret('JWT_SECRET'), {
        subject: user.id,
        algorithm: 'HS256',
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expiresIn: -60,
      });

      assert.equal((await me(expired)).status, 401);
    });

    it('rejects a correctly signed token with the wrong audience or issuer', async () => {
      const { user } = (await register()).body.data;
      const secret = requireSecret('JWT_SECRET');

      const wrongAudience = jwt.sign({}, secret, {
        subject: user.id,
        algorithm: 'HS256',
        issuer: JWT_ISSUER,
        audience: 'some-other-service',
        expiresIn: 3600,
      });
      assert.equal((await me(wrongAudience)).status, 401);

      const wrongIssuer = jwt.sign({}, secret, {
        subject: user.id,
        algorithm: 'HS256',
        issuer: 'https://evil.example',
        audience: JWT_AUDIENCE,
        expiresIn: 3600,
      });
      assert.equal((await me(wrongIssuer)).status, 401);
    });

    it('rejects malformed and missing Authorization headers identically', async () => {
      const cases = [
        undefined,
        '',
        'not-a-token',
        'Basic dXNlcjpwYXNz',
        'Bearer',
        'Bearer a.b.c extra',
      ];

      for (const header of cases) {
        const res = await server.request('/api/v1/auth/me', {
          headers: header === undefined ? {} : { Authorization: header },
        });
        assert.equal(res.status, 401, `header ${JSON.stringify(header)} was not rejected`);
        assert.equal(res.body.error.code, 'AUTHENTICATION_ERROR');
      }
    });

    it('rejects a token whose user no longer exists', async () => {
      const { accessToken, user } = (await register()).body.data;
      await User.deleteOne({ _id: user.id });

      assert.equal((await me(accessToken)).status, 401);
    });
  });
});
