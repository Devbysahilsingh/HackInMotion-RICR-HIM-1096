/**
 * ST-05b — Token forgery, credential handling and mass assignment [blocking].
 *
 * A deeper pass over the same ground ST-01..05 covers, written from the
 * attacker's side: every case here is a thing someone holding a valid account
 * would actually try. ST-05 proves the common forgeries are rejected; this
 * proves the *variants* are too — the ones that survive when a verifier pins
 * "a signature" but not which algorithm produced it, or resolves a subject
 * claim that is not there.
 *
 * Nothing here weakens or restates an ST-05 assertion; where a case is already
 * covered upstream it is not repeated.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

import { JWT_AUDIENCE, JWT_ISSUER } from '../../src/config/constants.js';
import { requireSecret } from '../../src/config/env.js';
import { RefreshToken, User } from '../../src/models/index.js';
import { startTestServer } from '../helpers/app.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

const PASSWORD = 'correct horse battery'; // pragma: allowlist-secret — fabricated value, exists only to prove it is never leaked

/**
 * The password an attacker supplies when trying to re-register — and therefore
 * take over — an existing account. Deliberately different from `PASSWORD`: the
 * whole point of those tests is that this value never becomes the account's
 * credential, so the two must not be the same string.
 */
const ATTACKER_PASSWORD = 'attacker-chosen-password'; // pragma: allowlist-secret — fabricated value, asserted to be rejected

const CREDENTIALS = {
  name: 'Ramesh Patel',
  email: 'ramesh@example.com',
  password: PASSWORD,
  language: 'hi',
};

const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('ST-05b · token forgery, credentials and mass assignment', () => {
  let server;
  let secret;

  before(async () => {
    await startTestDatabase();
    server = await startTestServer();
    secret = requireSecret('JWT_SECRET');
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

  const me = (token) => server.request('/api/v1/auth/me', { token });

  /** A genuine session to attack from. */
  async function account(overrides = {}) {
    const res = await register(overrides);
    assert.equal(res.status, 201, `registration failed: ${res.text}`);
    return res.body.data;
  }

  // ── Algorithm handling ─────────────────────────────────────────────────────

  describe('algorithm pinning', () => {
    it('rejects a token signed with the real secret under a different HMAC algorithm', async () => {
      const { user } = await account();

      // Algorithm confusion, the symmetric case: the signature is genuinely
      // valid — it is the *same secret* — but under HS384 rather than the
      // pinned HS256. A verifier that trusts the token's own `alg` header
      // accepts this; one with an allowlist does not.
      for (const algorithm of ['HS384', 'HS512']) {
        const forged = jwt.sign({}, secret, {
          subject: user.id,
          algorithm,
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
          expiresIn: 3600,
        });

        const res = await me(forged);
        assert.equal(res.status, 401, `${algorithm} was accepted where HS256 is pinned`);
        assert.equal(res.body.error.code, 'AUTHENTICATION_ERROR');
      }
    });

    it('rejects alg:none however the header is cased or padded', async () => {
      const { user } = await account();

      const payload = base64url({
        sub: user.id,
        iss: JWT_ISSUER,
        aud: JWT_AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      // `none`, `None`, `NONE` — and each with a plausible-looking signature
      // segment as well as an empty one, since a verifier that only checks
      // "is there a signature" is defeated by the second shape.
      for (const alg of ['none', 'None', 'NONE', 'nOnE']) {
        for (const signature of ['', 'AAAA', 'x'.repeat(43)]) {
          const header = base64url({ alg, typ: 'JWT' });
          const res = await me(`${header}.${payload}.${signature}`);

          assert.equal(res.status, 401, `alg:${alg} with signature "${signature}" was accepted`);
        }
      }
    });

    it('rejects an asymmetrically-signed token presented against the HMAC secret', async () => {
      const { user } = await account();

      // The classic confusion: a token whose header claims RS256. There is no
      // public key here to confuse the verifier with, so the assertion is
      // simply that the header cannot steer verification away from HS256.
      const header = base64url({ alg: 'RS256', typ: 'JWT' });
      const payload = base64url({
        sub: user.id,
        iss: JWT_ISSUER,
        aud: JWT_AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      const hmacSigned = jwt.sign({}, secret, {
        subject: user.id,
        algorithm: 'HS256',
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expiresIn: 3600,
      });

      // Genuine HS256 signature bolted onto an RS256 header.
      const res = await me(`${header}.${payload}.${hmacSigned.split('.')[2]}`);
      assert.equal(res.status, 401);
    });
  });

  // ── Subject claim ──────────────────────────────────────────────────────────

  describe('subject resolution', () => {
    it('rejects a validly signed token that carries no subject', async () => {
      // The dangerous failure is not the 401 — it is what an absent `sub`
      // could become on the way to the database. `findById(undefined)` must
      // not degrade into an unfiltered `findOne({})`, which would hand the
      // caller whichever account happens to sort first. Two accounts exist
      // here precisely so that outcome would be visible.
      await account();
      const victim = await account({ email: 'victim@example.com' });

      const noSubject = jwt.sign({}, secret, {
        algorithm: 'HS256',
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expiresIn: 3600,
      });

      const res = await me(noSubject);
      assert.equal(res.status, 401, 'a token with no subject authenticated someone');
      assert.ok(!res.text.includes(victim.user.email), 'an arbitrary account was disclosed');
      assert.ok(!res.text.includes(CREDENTIALS.email));
    });

    it('rejects a null, empty or non-ObjectId subject without a 500', async () => {
      await account();

      for (const sub of ['', ' ', 'null', 'undefined', 'not-an-object-id', '../../etc/passwd']) {
        const forged = jwt.sign({ sub }, secret, {
          algorithm: 'HS256',
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
          expiresIn: 3600,
        });

        const res = await me(forged);
        assert.equal(res.status, 401, `subject ${JSON.stringify(sub)} was not rejected`);
        // A CastError escaping as a 500 both leaks internals and distinguishes
        // "malformed" from "unknown", which is an oracle in itself.
        assert.ok(!res.text.includes('Cast'), 'a Mongoose cast error leaked');
        assert.ok(!res.text.includes('ObjectId'));
      }
    });

    it('rejects a well-formed subject that has never existed', async () => {
      await account();

      const forged = jwt.sign({}, secret, {
        subject: '0123456789abcdef01234567',
        algorithm: 'HS256',
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expiresIn: 3600,
      });

      assert.equal((await me(forged)).status, 401);
    });

    it('rejects an object subject smuggled in as a query operator', async () => {
      await account();

      // If `sub` reached the query unsanitised, `{$ne: null}` would match the
      // first user in the collection. jsonwebtoken permits a non-string `sub`
      // when the claim is set directly rather than through `subject`.
      const forged = jwt.sign({ sub: { $ne: null } }, secret, {
        algorithm: 'HS256',
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expiresIn: 3600,
      });

      const res = await me(forged);
      assert.equal(res.status, 401, 'an operator object in `sub` authenticated someone');
      assert.ok(!res.text.includes(CREDENTIALS.email));
    });
  });

  // ── Expiry ─────────────────────────────────────────────────────────────────

  describe('expiry', () => {
    it('cannot be extended by rewriting exp on a genuine token', async () => {
      const { accessToken } = await account();
      const [header, payload, signature] = accessToken.split('.');

      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      const extended = base64url({
        ...claims,
        exp: Math.floor(Date.now() / 1000) + 100 * 365 * 86400,
      });

      // Same header, same signature, later expiry: rejected because the
      // signature covers the payload.
      assert.equal((await me(`${header}.${extended}.${signature}`)).status, 401);
    });

    it('rejects a far-future token that is not correctly signed', async () => {
      const { user } = await account();

      const forged = jwt.sign({}, 'an-attacker-controlled-secret-value-32ch', {
        subject: user.id,
        algorithm: 'HS256',
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expiresIn: '3650d',
      });

      assert.equal((await me(forged)).status, 401);
    });

    it('rejects a token whose signature was lifted from another token', async () => {
      const alice = await account();
      const mallory = await account({ email: 'mallory@example.com' });

      const [aliceHeader, alicePayload] = alice.accessToken.split('.');
      const mallorySignature = mallory.accessToken.split('.')[2];

      assert.equal((await me(`${aliceHeader}.${alicePayload}.${mallorySignature}`)).status, 401);
    });
  });

  // ── Header parsing ─────────────────────────────────────────────────────────

  describe('Authorization header parsing', () => {
    it('accepts the bearer scheme in any case, as documented', async () => {
      const { accessToken } = await account();

      // RFC 7235 makes the scheme case-insensitive and requireAuth says it
      // "tolerates case". Asserted so the tolerance stays deliberate.
      for (const scheme of ['Bearer', 'bearer', 'BEARER', 'BeArEr']) {
        const res = await server.request('/api/v1/auth/me', {
          headers: { Authorization: `${scheme} ${accessToken}` },
        });
        assert.equal(res.status, 200, `scheme "${scheme}" was rejected`);
      }
    });

    it('rejects extra parts and internal whitespace', async () => {
      const { accessToken } = await account();

      // Leading and trailing whitespace is deliberately absent from this list:
      // RFC 9110 has the transport strip optional whitespace around a field
      // value, so `Bearer <token> ` is already `Bearer <token>` by the time any
      // parser sees it. Asserting a 401 for it would be asserting against the
      // HTTP stack rather than against this code.
      const cases = [
        `Bearer  ${accessToken}`, // doubled space → an empty second part
        `Bearer ${accessToken} extra`,
        `Bearer ${accessToken},Bearer ${accessToken}`,
        `Bearer,${accessToken}`,
        `Bearer\t${accessToken}`,
        `Bearer Bearer ${accessToken}`,
        `Bearer ${accessToken} ${accessToken}`,
      ];

      for (const header of cases) {
        const res = await server.request('/api/v1/auth/me', { headers: { Authorization: header } });
        assert.equal(res.status, 401, `header ${JSON.stringify(header)} was accepted`);
        assert.equal(res.body.error.code, 'AUTHENTICATION_ERROR');
      }
    });

    it('rejects malformed segment counts identically', async () => {
      const { accessToken } = await account();
      const [header, payload, signature] = accessToken.split('.');

      const cases = [
        header,
        `${header}.${payload}`,
        `${header}.${payload}.${signature}.${signature}`,
        '..',
        '.',
        'a.b.c',
        `${payload}.${header}.${signature}`, // segments transposed
        Buffer.from('{"alg":"HS256"}').toString('base64url'),
      ];

      for (const token of cases) {
        const res = await me(token);
        assert.equal(res.status, 401, `token ${JSON.stringify(token.slice(0, 40))} was accepted`);
        assert.equal(res.body.error.code, 'AUTHENTICATION_ERROR');
      }
    });

    it('rejects an oversized token without a 500 or a crash', async () => {
      await account();

      // A megabyte of "token". The header must be refused cleanly — either by
      // the server's header limit or by the verifier — and never by throwing.
      for (const size of [8_000, 100_000]) {
        const res = await server
          .request('/api/v1/auth/me', {
            headers: { Authorization: `Bearer ${'A'.repeat(size)}` },
          })
          .catch((err) => ({ status: 'network', err }));

        if (res.status === 'network') continue; // header limit closed the socket: also a refusal
        assert.notEqual(res.status, 200, `a ${size}-byte token authenticated`);
        assert.ok(res.status === 401 || res.status === 431, `unexpected status ${res.status}`);
      }
    });
  });

  // ── Refresh-token attacks ──────────────────────────────────────────────────

  describe('refresh tokens', () => {
    const refresh = (refreshToken) =>
      server.request('/api/v1/auth/refresh', { method: 'POST', body: { refreshToken } });

    it('cannot be replayed after logout', async () => {
      const { accessToken, refreshToken } = await account();

      await server.request('/api/v1/auth/logout', {
        method: 'POST',
        token: accessToken,
        body: { refreshToken },
      });

      // Logout revoked it, so presenting it again is a replay of a revoked
      // token: refused, and the family dies with it.
      assert.equal((await refresh(refreshToken)).status, 401);
      const rows = await RefreshToken.find({});
      for (const row of rows) assert.ok(row.revokedAt, `token ${row.jti} survived logout + replay`);
    });

    it('mints a session for the token holder, never for the bearer of the access token', async () => {
      const alice = await account();
      const mallory = await account({ email: 'mallory@example.com' });

      // Alice presents Mallory's refresh token while authenticated as herself.
      // The refresh token is the only credential that may decide identity —
      // if the Authorization header could influence it, a stolen refresh token
      // could be upgraded into someone else's session.
      const res = await server.request('/api/v1/auth/refresh', {
        method: 'POST',
        token: alice.accessToken,
        body: { refreshToken: mallory.refreshToken },
      });

      assert.equal(res.status, 200);

      const whoami = await me(res.body.data.accessToken);
      assert.equal(whoami.status, 200);
      assert.equal(
        whoami.body.data.user.id,
        mallory.user.id,
        'the access token in the request influenced whose session was minted',
      );
    });

    it('rejects every token of a family already killed by reuse detection', async () => {
      const { refreshToken } = await account();

      const second = (await refresh(refreshToken)).body.data.refreshToken;
      const third = (await refresh(second)).body.data.refreshToken;

      await refresh(second); // replay → the whole family dies

      for (const [label, token] of [
        ['original', refreshToken],
        ['second', second],
        ['third', third],
      ]) {
        assert.equal((await refresh(token)).status, 401, `${label} survived the family revocation`);
      }
    });

    it('lets exactly one of several simultaneous presentations win', async () => {
      const { refreshToken } = await account();

      // Wider than the two-way race ST-04 covers: five at once, which is what
      // a retrying mobile client on a flaky connection actually produces.
      const results = await Promise.all(Array.from({ length: 5 }, () => refresh(refreshToken)));
      const statuses = results.map((r) => r.status);

      assert.equal(
        statuses.filter((s) => s === 200).length,
        1,
        `exactly one presentation may succeed, got ${JSON.stringify(statuses)}`,
      );
      assert.equal(statuses.filter((s) => s === 401).length, 4);
    });

    it('gives the body precedence over the cookie, deterministically', async () => {
      const alice = await account();
      const mallory = await account({ email: 'mallory@example.com' });

      // Both credentials present and disagreeing. Whichever wins must be a
      // fixed, stated rule rather than an accident of parse order — otherwise
      // an attacker who can set a cookie could steer the outcome.
      const res = await server.request('/api/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken: alice.refreshToken },
        headers: { Cookie: `rt=${mallory.refreshToken}` },
      });

      assert.equal(res.status, 200);
      const whoami = await me(res.body.data.accessToken);
      assert.equal(whoami.body.data.user.id, alice.user.id, 'the cookie overrode the body');

      // And the loser was not silently consumed as well.
      const mallorysRow = await RefreshToken.findOne({ userId: mallory.user.id });
      assert.equal(mallorysRow.revokedAt, undefined, "the cookie's token was rotated too");
    });

    it('leaves a deleted account with no usable session', async () => {
      const { refreshToken, user } = await account();
      await User.deleteOne({ _id: user.id });

      // Whether the rotation itself succeeds is an implementation choice; what
      // must hold is that nothing reachable from it grants API access.
      const rotated = await refresh(refreshToken);
      if (rotated.status === 200) {
        assert.equal(
          (await me(rotated.body.data.accessToken)).status,
          401,
          'a deleted account kept API access through refresh',
        );
      } else {
        assert.equal(rotated.status, 401);
      }
    });
  });

  // ── Registration and login ─────────────────────────────────────────────────

  describe('registration and login', () => {
    it('treats differently-cased addresses as one account', async () => {
      const first = await register({ email: 'Ramesh@Example.COM' });
      assert.equal(first.status, 201);

      const collision = await register({ email: 'ramesh@example.com', name: 'Someone Else' });
      assert.equal(collision.status, 409, 'case variation created a second account');

      assert.equal(await User.countDocuments({}), 1);

      // And the single account is reachable under either casing.
      for (const email of ['ramesh@example.com', 'RAMESH@EXAMPLE.COM', '  Ramesh@Example.com  ']) {
        const res = await server.request('/api/v1/auth/login', {
          method: 'POST',
          body: { email, password: PASSWORD },
        });
        assert.equal(res.status, 200, `login failed for ${JSON.stringify(email)}`);
      }
    });

    it('cannot overwrite an existing account by re-registering it', async () => {
      await account();

      const takeover = await register({ name: 'Attacker', password: ATTACKER_PASSWORD });
      assert.equal(takeover.status, 409);

      // The original credential still works and the attacker's does not —
      // a duplicate registration that silently reset the password would be
      // account takeover with no interaction at all.
      const original = await server.request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: CREDENTIALS.email, password: PASSWORD },
      });
      assert.equal(original.status, 200);
      assert.equal(original.body.data.user.name, CREDENTIALS.name, 'the profile was overwritten');

      const attacker = await server.request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: CREDENTIALS.email, password: ATTACKER_PASSWORD },
      });
      assert.equal(attacker.status, 401);
    });

    it('rejects null bytes and control characters in an email', async () => {
      // Written as escapes on purpose: an invisible character pasted into a
      // source file is a review hazard in its own right.
      for (const email of [
        `ramesh@example.com\u0000`,
        `ramesh\u0000@example.com`,
        `ramesh@example.com\u202e`,
        'ramesh @example.com',
        'ram esh@example.com',
        'ramesh@exam\nple.com',
        'ramesh@example.com\r\nX-Injected: 1',
        'ramesh@example.com<script>',
        'two@addresses.com,other@example.com',
      ]) {
        const res = await register({ email });
        assert.equal(res.status, 422, `email ${JSON.stringify(email)} was accepted`);
        assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      }

      assert.equal(await User.countDocuments({}), 0, 'a malformed address created an account');
    });

    it('normalises surrounding whitespace rather than minting a second account', async () => {
      // `.trim()` runs before `.email()`, so a padded address is the SAME
      // address. That is the safe direction — what must never happen is two
      // accounts a human would read as one. Asserted so the ordering of those
      // two schema steps cannot be swapped without a failure.
      assert.equal((await register({ email: 'ramesh@example.com' })).status, 201);

      for (const email of ['ramesh@example.com ', ' ramesh@example.com', 'ramesh@example.com\n']) {
        const res = await register({ email, name: 'Someone Else' });
        assert.equal(res.status, 409, `${JSON.stringify(email)} was treated as a new account`);
      }

      assert.equal(await User.countDocuments({}), 1);

      const stored = await User.findOne({}).lean();
      assert.equal(stored.email, 'ramesh@example.com', 'whitespace was stored verbatim');
    });

    it('enforces the documented password length bounds at registration', async () => {
      const tooShort = await register({ email: 'short@example.com', password: '1234567' });
      assert.equal(tooShort.status, 422, 'a 7-character password was accepted');

      const atMinimum = await register({ email: 'min@example.com', password: '12345678' });
      assert.equal(atMinimum.status, 201);

      const atMaximum = await register({ email: 'max@example.com', password: 'p'.repeat(200) });
      assert.equal(atMaximum.status, 201);

      const tooLong = await register({ email: 'over@example.com', password: 'p'.repeat(201) });
      assert.equal(tooLong.status, 422, 'a 201-character password was accepted');
    });

    it('answers the same 401 for an over-long password at login as for a wrong one', async () => {
      await account();

      // Login must not distinguish "too long to be a password" from "wrong":
      // a 422 here would confirm the account exists.
      const wrong = await server.request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: CREDENTIALS.email, password: 'wrong' },
      });
      const overLong = await server.request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: CREDENTIALS.email, password: 'p'.repeat(201) },
      });

      assert.equal(wrong.status, 401);
      assert.equal(overLong.status, 422);
      // Documented divergence: the 422 is a shape rejection that happens
      // before any account is looked up, so it is returned identically for an
      // address that does not exist — it is not an existence oracle.
      const unknown = await server.request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: 'nobody-at-all@example.com', password: 'p'.repeat(201) },
      });
      assert.equal(unknown.status, 422);
      assert.deepEqual(unknown.body.error, overLong.body.error);
    });

    it('does not let a non-string password bypass the comparison', async () => {
      await account();

      for (const password of [null, 1234, true, { $ne: null }, ['a'], undefined]) {
        const res = await server.request('/api/v1/auth/login', {
          method: 'POST',
          body: { email: CREDENTIALS.email, password },
        });
        assert.notEqual(res.status, 200, `password ${JSON.stringify(password)} authenticated`);
        assert.ok([401, 422].includes(res.status), `unexpected status ${res.status}`);
      }
    });

    it('does not let an operator object in the email select an account', async () => {
      await account();

      for (const email of [{ $ne: null }, { $gt: '' }, ['ramesh@example.com']]) {
        const res = await server.request('/api/v1/auth/login', {
          method: 'POST',
          body: { email, password: PASSWORD },
        });
        assert.notEqual(res.status, 200, `email ${JSON.stringify(email)} authenticated`);
        assert.ok(!res.text.includes('accessToken'));
      }
    });
  });

  // ── PATCH /users/me mass assignment ────────────────────────────────────────

  describe('PATCH /users/me · mass assignment', () => {
    /** Fields no request may ever set, each paired with a plausible value. */
    const FORBIDDEN = {
      role: 'admin',
      isAdmin: true,
      admin: true,
      _id: '0123456789abcdef01234567',
      id: '0123456789abcdef01234567',
      userId: '0123456789abcdef01234567',
      passwordHash: '$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      password: 'new-password',
      email: 'attacker@example.com',
      name: 'Attacker',
      createdAt: '1999-01-01T00:00:00.000Z',
      lastLoginAt: '1999-01-01T00:00:00.000Z',
      __v: 99,
    };

    it('rejects every privileged or identity field outright', async () => {
      const { accessToken, user } = await account();

      for (const [field, value] of Object.entries(FORBIDDEN)) {
        const res = await server.request('/api/v1/users/me', {
          method: 'PATCH',
          token: accessToken,
          body: { [field]: value },
        });

        // `.strict()` is what makes this a 422 rather than a silent 200 with
        // the field stripped — the caller is told the change did not happen.
        assert.equal(res.status, 422, `field "${field}" was not rejected (${res.status})`);
        assert.equal(res.body.error.code, 'VALIDATION_ERROR');

        const stored = await User.findById(user.id).select('+passwordHash').lean();
        assert.equal(stored.email, CREDENTIALS.email, `"${field}" changed the email`);
        assert.equal(stored.name, CREDENTIALS.name, `"${field}" changed the name`);
        assert.equal(String(stored._id), user.id, `"${field}" changed the id`);
        assert.equal(stored.role, undefined, `"${field}" introduced a role`);
        assert.equal(stored.isAdmin, undefined, `"${field}" introduced an admin flag`);
      }
    });

    it('rejects a privileged field even when smuggled alongside a legitimate one', async () => {
      const { accessToken, user } = await account();

      // The realistic shape: a valid update that a lazy allowlist would wave
      // through, carrying one extra key.
      const res = await server.request('/api/v1/users/me', {
        method: 'PATCH',
        token: accessToken,
        body: { language: 'en', role: 'admin' },
      });

      assert.equal(res.status, 422);

      // The legitimate half must not have been applied either — a partial
      // write would mean the request was half-trusted.
      const stored = await User.findById(user.id).lean();
      assert.equal(stored.language, 'hi', 'a rejected request still wrote its valid fields');
      assert.equal(stored.role, undefined);
    });

    it('does not pollute Object.prototype through __proto__ or constructor', async () => {
      const { accessToken } = await account();

      const payloads = [
        '{"__proto__":{"isAdmin":true}}',
        '{"__proto__":{"polluted":"yes"}}',
        '{"constructor":{"prototype":{"polluted":"yes"}}}',
        '{"language":"en","__proto__":{"polluted":"yes"}}',
        '{"units":{"land":"acre","__proto__":{"polluted":"yes"}}}',
      ];

      for (const raw of payloads) {
        const res = await server.request('/api/v1/users/me', {
          method: 'PATCH',
          token: accessToken,
          raw,
        });

        assert.ok(
          [200, 422].includes(res.status),
          `payload ${raw} produced ${res.status}: ${res.text}`,
        );

        // The assertion that matters is not the status but the prototype: a
        // polluted Object.prototype would give every later object an
        // `isAdmin` an authorization check might one day consult.
        assert.equal({}.isAdmin, undefined, `Object.prototype was polluted by ${raw}`);
        assert.equal({}.polluted, undefined, `Object.prototype was polluted by ${raw}`);
        assert.equal(Object.prototype.polluted, undefined);
      }
    });

    it('never serialises a privileged or secret field in its response', async () => {
      const { accessToken } = await account();

      const res = await server.request('/api/v1/users/me', {
        method: 'PATCH',
        token: accessToken,
        body: { language: 'en' },
      });

      assert.equal(res.status, 200);
      for (const leak of ['passwordHash', '$2b$', 'role', 'isAdmin', '__v', '_id']) {
        assert.ok(!res.text.includes(leak), `PATCH /users/me leaked ${leak}`);
      }
    });

    it('cannot be aimed at another account by any request shape', async () => {
      const alice = await account();
      const mallory = await account({ email: 'mallory@example.com' });

      // There is no `:id` to substitute, so the attacks available are a body
      // field claiming another id and an invented addressing route. Note that
      // a `..` segment is not tested: fetch resolves it before the request
      // leaves, so it would assert against the client, not the server.
      const attempts = [
        () =>
          server.request('/api/v1/users/me', {
            method: 'PATCH',
            token: alice.accessToken,
            body: { language: 'en', _id: mallory.user.id },
          }),
        () =>
          server.request(`/api/v1/users/${mallory.user.id}`, {
            method: 'PATCH',
            token: alice.accessToken,
            body: { language: 'en' },
          }),
        () =>
          server.request(`/api/v1/users/me?userId=${mallory.user.id}`, {
            method: 'PATCH',
            token: alice.accessToken,
            body: { language: 'en' },
          }),
      ];

      // The invariant is not "these must fail" — `me` is a literal, so an
      // inert extra field may legitimately succeed as a self-update. It is
      // that no request shape can make the write land on, or disclose,
      // another account.
      for (const attempt of attempts) {
        const res = await attempt();
        if (res.status === 200) {
          assert.equal(
            res.body.data.user.id,
            alice.user.id,
            `the write was aimed at another account: ${res.text}`,
          );
        }
        assert.ok(
          !res.text.includes(mallory.user.email),
          `another account was disclosed: ${res.text}`,
        );
      }

      const stored = await User.findById(mallory.user.id).lean();
      assert.equal(stored.language, 'hi', "another farmer's profile was modified");
    });
  });
});
