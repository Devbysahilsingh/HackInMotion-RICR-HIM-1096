/**
 * ST-70 — Secrets: log-redaction spot checks [blocking].
 *
 * docs/security/security-testing.md: "Gitleaks clean on full history; .env
 * absent from git; log-redaction spot checks."
 *
 * Gitleaks and the .env check run outside the suite. This file covers the
 * third: that a credential passing through the API cannot reach the log
 * stream. It asserts against the real `redactPaths` the application uses, so
 * the test cannot drift from the configuration it is verifying.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import pino from 'pino';

import { redactPaths } from '../../src/utils/logger.js';
import { record } from '../../src/services/auditService.js';

/** A logger with the production redaction config, writing into a buffer. */
function captureLogger() {
  const lines = [];
  const stream = new Writable({
    write(chunk, encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });

  const logger = pino(
    { level: 'trace', redact: { paths: redactPaths, censor: '[redacted]' } },
    stream,
  );

  return { logger, output: () => lines.join('\n') };
}

const SECRET = 'sup3r-s3cret-value-that-must-never-appear'; // pragma: allowlist-secret — fabricated value, exists only to prove it is never leaked

describe('ST-70 · log redaction', () => {
  it('redacts credentials in a request body, however they are named', () => {
    const { logger, output } = captureLogger();

    logger.info({
      password: SECRET,
      currentPassword: SECRET,
      newPassword: SECRET,
      passwordHash: SECRET,
      accessToken: SECRET,
      refreshToken: SECRET,
      tokenHash: SECRET,
      token: SECRET,
      rt: SECRET,
    });

    assert.ok(!output().includes(SECRET), `a credential reached the log stream: ${output()}`);
  });

  it('redacts credentials nested one and two levels deep', () => {
    const { logger, output } = captureLogger();

    logger.info({ body: { password: SECRET, refreshToken: SECRET } });
    logger.info({ req: { body: { password: SECRET } } });

    assert.ok(!output().includes(SECRET), `a nested credential leaked: ${output()}`);
  });

  it('redacts credential-bearing headers in both directions', () => {
    const { logger, output } = captureLogger();

    logger.info({
      req: {
        headers: {
          authorization: `Bearer ${SECRET}`,
          cookie: `rt=${SECRET}`,
          'x-service-key': SECRET,
        },
      },
      res: { headers: { 'set-cookie': [`rt=${SECRET}; HttpOnly`] } },
    });

    assert.ok(!output().includes(SECRET), `a header credential leaked: ${output()}`);
  });

  it('redacts configuration secrets', () => {
    const { logger, output } = captureLogger();

    logger.info({
      MONGODB_URI: `mongodb+srv://user:${SECRET}@cluster.example`, // pragma: allowlist-secret — fabricated value, exists only to prove it is never leaked
      JWT_SECRET: SECRET,
      SERVICE_KEY: SECRET,
      CLOUDINARY_URL: `cloudinary://key:${SECRET}@cloud`,
    });

    assert.ok(!output().includes(SECRET), `a configuration secret leaked: ${output()}`);
  });

  it('still logs the non-sensitive context that makes a line useful', () => {
    const { logger, output } = captureLogger();

    logger.info({ requestId: 'abc-123', event: 'login', password: SECRET });

    const logged = output();
    assert.ok(!logged.includes(SECRET));
    // Redaction that removed everything would be useless for debugging.
    assert.ok(logged.includes('abc-123'));
    assert.ok(logged.includes('login'));
  });

  it('the audit scrubber refuses to persist credentials handed to it', async () => {
    // The audit writer takes a `meta` object from call sites; a careless caller
    // passing `req.body` wholesale must not be able to persist a password.
    // Exercised without a database: the scrub happens before any write, and a
    // failed write is swallowed by design.
    const captured = [];
    const originalCreate = (await import('../../src/models/index.js')).AuditLog.create;

    const { AuditLog } = await import('../../src/models/index.js');
    AuditLog.create = async (doc) => {
      captured.push(doc);
      return doc;
    };

    try {
      await record({
        event: 'login',
        ip: '203.0.113.5',
        meta: {
          userAgent: 'test-agent',
          password: SECRET,
          refreshToken: SECRET,
          nested: { tokenHash: SECRET, keep: 'visible' },
        },
      });
    } finally {
      AuditLog.create = originalCreate;
    }

    assert.equal(captured.length, 1);
    const serialized = JSON.stringify(captured[0]);
    assert.ok(!serialized.includes(SECRET), `audit row carried a credential: ${serialized}`);
    assert.equal(captured[0].meta.userAgent, 'test-agent');
    assert.equal(captured[0].meta.nested.keep, 'visible');
  });
});
