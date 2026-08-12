/**
 * Every messageKey the API can emit must exist in both languages.
 *
 * The API deliberately returns keys rather than prose, which means a key with
 * no translation surfaces to the farmer as a raw identifier — or, with a
 * fallback configured, as English text on a Hindi screen. Both are product
 * failures that no other test would catch, so the check is mechanical: scan
 * the source for keys, then look each one up.
 *
 * Canonical resources: shared/i18n/{en,hi}/{namespace}.json (ADR-018).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const I18N = fileURLToPath(new URL('../../../shared/i18n/', import.meta.url));

/** Namespaces the backend emits keys into (docs/i18n/architecture.md). */
const NAMESPACES = ['errors', 'auth', 'farm', 'crop'];

/** Matches the quoted dotted keys passed to AppError/messageKey helpers. */
const KEY_PATTERN = new RegExp(`'((?:${NAMESPACES.join('|')})\\.[a-zA-Z0-9]+)'`, 'g');

/**
 * Near-miss namespaces. A key written `farms.limitReached` would simply not be
 * seen by the scanner above, so the guard would pass while the farmer got a
 * raw identifier — the exact failure this file exists to prevent. These are
 * matched explicitly and rejected.
 */
const WRONG_NAMESPACES = ['farms', 'crops', 'error', 'auths'];
const WRONG_KEY_PATTERN = new RegExp(`'((?:${WRONG_NAMESPACES.join('|')})\\.[a-zA-Z0-9]+)'`, 'g');

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

function emittedKeys() {
  const keys = new Set();
  for (const file of sourceFiles(SRC)) {
    const contents = readFileSync(file, 'utf8');
    for (const match of contents.matchAll(KEY_PATTERN)) keys.add(match[1]);
  }
  return [...keys].sort();
}

const loadNamespace = (language, namespace) => {
  const file = path.join(I18N, language, `${namespace}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
};

describe('i18n · message keys', () => {
  const keys = emittedKeys();

  it('finds the keys the API emits', () => {
    assert.ok(keys.length > 0, 'no message keys were discovered — the scanner is broken');
  });

  it('uses no near-miss namespace that the scanner would silently skip', () => {
    const offenders = [];
    for (const file of sourceFiles(SRC)) {
      for (const match of readFileSync(file, 'utf8').matchAll(WRONG_KEY_PATTERN)) {
        offenders.push(`${path.relative(SRC, file)}: ${match[1]}`);
      }
    }
    assert.deepEqual(offenders, [], `keys use a non-canonical namespace: ${offenders.join(', ')}`);
  });

  for (const language of ['en', 'hi']) {
    it(`resolves every emitted key in ${language}`, () => {
      const missing = [];

      for (const key of keys) {
        const [namespace, name] = key.split('.');
        const resources = loadNamespace(language, namespace);
        if (!resources || resources[name] === undefined) missing.push(key);
      }

      assert.deepEqual(missing, [], `missing ${language} translations: ${missing.join(', ')}`);
    });
  }

  it('keeps en and hi at full key parity', () => {
    // Parity in both directions: an orphaned Hindi key is dead weight, and an
    // English-only key is a farmer seeing the wrong language.
    for (const namespace of NAMESPACES) {
      const en = loadNamespace('en', namespace);
      const hi = loadNamespace('hi', namespace);
      if (!en && !hi) continue;

      assert.ok(en, `${namespace}: en resources missing`);
      assert.ok(hi, `${namespace}: hi resources missing`);
      assert.deepEqual(
        Object.keys(en).sort(),
        Object.keys(hi).sort(),
        `${namespace}: en/hi key sets differ`,
      );
    }
  });

  it('never ships an empty string as a translation', () => {
    for (const language of ['en', 'hi']) {
      for (const namespace of NAMESPACES) {
        const resources = loadNamespace(language, namespace);
        if (!resources) continue;
        for (const [name, value] of Object.entries(resources)) {
          assert.ok(
            typeof value === 'string' && value.trim().length > 0,
            `${language}/${namespace}.${name} is empty`,
          );
        }
      }
    }
  });
});
