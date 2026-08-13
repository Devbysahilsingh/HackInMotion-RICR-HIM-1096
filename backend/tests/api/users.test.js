/**
 * Users API — the preference patch (docs/api/users.md).
 *
 * Two things this suite exists to prove, beyond the field mechanics: that a
 * strict body cannot be used to write something the schema does not name, and
 * that the route touches nobody but `req.auth.userId` — `me` is a literal, so
 * the only way a farmer could reach another account is if the handler took an
 * identity from the request, and the assertions below are what say it does not.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from 'express';

import { API_PREFIX, createApp } from '../../src/app.js';
import { AUDIT_EVENTS } from '../../src/config/constants.js';
import { AuditLog, User } from '../../src/models/index.js';
import { usersRouter } from '../../src/routes/users.js';
import { registerUser } from '../factories/index.js';
import { startTestServer } from '../helpers/app.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

/**
 * Mounted through the app's composition seam so the suite is independent of
 * when the router is wired into app.js; the mount path is the documented one.
 */
const mountUsers = Router();
mountUsers.use(`${API_PREFIX}/users`, usersRouter);

const ME = `${API_PREFIX}/users/me`;

describe('Users API', () => {
  let server;
  /** @type {{ user: object, accessToken: string }} */
  let alice;
  let bob;

  before(async () => {
    await startTestDatabase();
    server = await startTestServer(createApp({ extraRouters: [mountUsers] }));
  });

  after(async () => {
    await server.close();
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearCollections();
    alice = await registerUser(server);
    bob = await registerUser(server);
  });

  const patch = (token, body) => server.request(ME, { method: 'PATCH', token, body });

  // ── Authentication ─────────────────────────────────────────────────────────

  it('rejects an anonymous caller with 401', async () => {
    const res = await server.request(ME, { method: 'PATCH', body: { language: 'hi' } });

    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'AUTHENTICATION_ERROR');

    // Nothing was written on the way to the refusal.
    const stored = await User.findById(alice.user.id);
    assert.equal(stored.language, 'en');
  });

  it('rejects a forged token with 401', async () => {
    const res = await patch('not.a.jwt', { language: 'hi' });
    assert.equal(res.status, 401);
  });

  // ── Each field ─────────────────────────────────────────────────────────────

  it('updates the language and persists it', async () => {
    const res = await patch(alice.accessToken, { language: 'hi' });

    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.data.user.language, 'hi');

    const stored = await User.findById(alice.user.id);
    assert.equal(stored.language, 'hi');
  });

  it('updates the land unit and persists it', async () => {
    const res = await patch(alice.accessToken, { units: { land: 'hectare' } });

    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.data.user.units.land, 'hectare');

    const stored = await User.findById(alice.user.id);
    assert.equal(stored.units.land, 'hectare');
  });

  it('updates the voice toggle and persists it', async () => {
    const res = await patch(alice.accessToken, { voiceEnabled: true });

    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.data.user.voiceEnabled, true);

    const stored = await User.findById(alice.user.id);
    assert.equal(stored.voiceEnabled, true);
  });

  it('updates community consent and persists it', async () => {
    // The schema default is false and registration cannot set it, so this
    // endpoint is the only way the flag can ever become true.
    const before = await User.findById(alice.user.id);
    assert.equal(before.communityConsent, false);

    const res = await patch(alice.accessToken, { communityConsent: true });

    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.data.user.communityConsent, true);

    const stored = await User.findById(alice.user.id);
    assert.equal(stored.communityConsent, true);
  });

  it('withdraws community consent again', async () => {
    await patch(alice.accessToken, { communityConsent: true });
    const res = await patch(alice.accessToken, { communityConsent: false });

    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.data.user.communityConsent, false);

    const stored = await User.findById(alice.user.id);
    assert.equal(stored.communityConsent, false);
  });

  it('applies several fields in one request', async () => {
    const res = await patch(alice.accessToken, {
      language: 'hi',
      units: { land: 'bigha' },
      voiceEnabled: true,
      communityConsent: true,
    });

    assert.equal(res.status, 200, res.text);

    const stored = await User.findById(alice.user.id);
    assert.equal(stored.language, 'hi');
    assert.equal(stored.units.land, 'bigha');
    assert.equal(stored.voiceEnabled, true);
    assert.equal(stored.communityConsent, true);
  });

  it('leaves the fields it was not given alone', async () => {
    await patch(alice.accessToken, { language: 'hi', voiceEnabled: true });
    const res = await patch(alice.accessToken, { units: { land: 'hectare' } });

    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.data.user.language, 'hi');
    assert.equal(res.body.data.user.voiceEnabled, true);
    assert.equal(res.body.data.user.units.land, 'hectare');
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  it('rejects an empty body with 422', async () => {
    const res = await patch(alice.accessToken, {});

    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('rejects an unknown field with 422 rather than stripping it', async () => {
    const res = await patch(alice.accessToken, { language: 'hi', nickname: 'Ali' });

    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');

    // Strict means the whole request failed: the declared field alongside the
    // unknown one must not have been applied either.
    const stored = await User.findById(alice.user.id);
    assert.equal(stored.language, 'en');
  });

  it('refuses the fields this endpoint deliberately does not own', async () => {
    // Each of these has its own flow (or deliberately none). A 200 for any of
    // them — even one that silently stripped the field — would be the bug.
    for (const body of [
      { name: 'Renamed' },
      { email: 'someone-else@example.com' },
      { password: 'hunter2-hunter2' }, // pragma: allowlist-secret — fabricated value, asserted to be rejected
      { passwordHash: 'x' }, // pragma: allowlist-secret — fabricated value, asserted to be rejected
      { id: bob.user.id },
      { userId: bob.user.id },
      { createdAt: '2020-01-01T00:00:00.000Z' },
    ]) {
      const res = await patch(alice.accessToken, body);
      assert.equal(res.status, 422, `${Object.keys(body)[0]} was accepted: ${res.text}`);
    }

    const stored = await User.findById(alice.user.id);
    assert.equal(stored.name, 'Test Farmer');
  });

  it('rejects a value outside an enum with 422', async () => {
    const cases = [
      [{ language: 'fr' }, 'language'],
      [{ units: { land: 'furlong' } }, 'units.land'],
      [{ voiceEnabled: 'yes' }, 'voiceEnabled'],
      [{ communityConsent: 'true' }, 'communityConsent'],
    ];

    for (const [body, field] of cases) {
      const res = await patch(alice.accessToken, body);

      assert.equal(res.status, 422, `${field} was accepted: ${res.text}`);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.ok(
        res.body.error.details.some((detail) => detail.field === field),
        `expected a detail for ${field}, got ${JSON.stringify(res.body.error.details)}`,
      );
    }
  });

  // ── The account written is always the caller's ─────────────────────────────

  it('never writes another account, whatever the body claims', async () => {
    const res = await patch(alice.accessToken, {
      language: 'hi',
      units: { land: 'bigha' },
      voiceEnabled: true,
      communityConsent: true,
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.data.user.id, alice.user.id);

    // Bob is untouched: same defaults he registered with.
    const stored = await User.findById(bob.user.id);
    assert.equal(stored.language, 'en');
    assert.equal(stored.units.land, 'acre');
    assert.equal(stored.voiceEnabled, false);
    assert.equal(stored.communityConsent, false);

    // And Bob's own token still sees his own account, not Alice's.
    const bobsView = await server.request(`${API_PREFIX}/auth/me`, { token: bob.accessToken });
    assert.equal(bobsView.body.data.user.id, bob.user.id);
    assert.equal(bobsView.body.data.user.communityConsent, false);
  });

  // ── Projection ─────────────────────────────────────────────────────────────

  it('returns exactly the toPublicJSON projection', async () => {
    const res = await patch(alice.accessToken, { language: 'hi' });
    const me = await server.request(`${API_PREFIX}/auth/me`, { token: alice.accessToken });

    assert.deepEqual(Object.keys(res.body.data.user).sort(), [
      'communityConsent',
      'createdAt',
      'email',
      'id',
      'language',
      'name',
      'units',
      'voiceEnabled',
    ]);

    // Byte-for-byte the same shape `/auth/me` serves — one serializer.
    assert.deepEqual(res.body.data.user, me.body.data.user);

    assert.ok(!res.text.includes('passwordHash'));
    assert.ok(!res.text.includes('$2b$'));
    assert.ok(!res.text.includes('phone'));
  });

  // ── Audit ──────────────────────────────────────────────────────────────────

  it('audits a consent change', async () => {
    await patch(alice.accessToken, { communityConsent: true });

    const granted = await AuditLog.find({
      event: AUDIT_EVENTS.CONSENT_CHANGED,
      userId: alice.user.id,
    }).lean();

    assert.equal(granted.length, 1);
    assert.equal(granted[0].meta.communityConsent, true);

    await patch(alice.accessToken, { communityConsent: false });

    const both = await AuditLog.find({
      event: AUDIT_EVENTS.CONSENT_CHANGED,
      userId: alice.user.id,
    })
      .sort({ createdAt: 1 })
      .lean();

    assert.equal(both.length, 2);
    assert.equal(both[1].meta.communityConsent, false);

    // The row records the account and the new value — never a credential.
    for (const row of both) {
      assert.ok(!('password' in row.meta));
      assert.ok(!('passwordHash' in row.meta));
    }
  });

  it('does not audit a consent write that changes nothing', async () => {
    // Re-sending the value already held is not a transition, and a row for it
    // would dilute the record of when consent actually moved.
    await patch(alice.accessToken, { communityConsent: false });

    const rows = await AuditLog.countDocuments({ event: AUDIT_EVENTS.CONSENT_CHANGED });
    assert.equal(rows, 0);
  });

  it('does not audit a change to the other preferences', async () => {
    await patch(alice.accessToken, { language: 'hi', voiceEnabled: true });

    const rows = await AuditLog.countDocuments({ event: AUDIT_EVENTS.CONSENT_CHANGED });
    assert.equal(rows, 0);
  });
});
