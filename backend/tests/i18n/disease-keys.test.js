/**
 * The disease KB's i18n coverage.
 *
 * Kept out of `message-keys.test.js` deliberately. That suite governs keys the
 * *source* emits and enforces strict en/hi parity, which is right for system
 * strings we author. Disease text is different: it is transcribed from TNAU,
 * ICAR and NIPHM extension material published in English, and CLAUDE.md rule 8
 * forbids translating agronomic terms without human verification. Enforcing
 * parity here would leave only two ways to go green — delete the sourced
 * English KB, or invent Hindi disease text — and both are worse than an honest
 * gap.
 *
 * So this suite enforces the properties that *are* unconditionally true, and
 * measures the one that is not:
 *
 *   - every key a registry document references must resolve in English, or a
 *     farmer sees a raw identifier where guidance should be;
 *   - Hindi may be incomplete, but every Hindi key present must correspond to
 *     an English one and must not be empty — an orphan or a blank is a
 *     mistake, not a pending translation;
 *   - the shortfall is reported, so it cannot quietly grow.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { composeRegistry } from '../../src/services/registrySeedService.js';

const I18N = fileURLToPath(new URL('../../../shared/i18n/', import.meta.url));
const load = (language) => JSON.parse(readFileSync(`${I18N}${language}/disease.json`, 'utf8'));

/** Registry documents store `disease.<CODE>.<field>.<n>`; the file is flat. */
const stripNamespace = (key) => (key.startsWith('disease.') ? key.slice('disease.'.length) : key);

function referencedKeys() {
  const { documents } = composeRegistry();
  const keys = new Set();

  for (const document of documents) {
    for (const disease of document.diseases ?? []) {
      for (const field of ['symptoms', 'inspect', 'nextSteps', 'prevention']) {
        for (const key of disease[field] ?? []) keys.add(stripNamespace(key));
      }
    }
  }
  return keys;
}

describe('i18n · disease knowledge base', () => {
  const en = load('en');
  const hi = load('hi');
  const referenced = referencedKeys();

  it('references at least one key — the KB is actually wired into the registry', () => {
    assert.ok(referenced.size > 0, 'no disease KB keys reached the composed registry');
  });

  it('resolves every referenced key in English', () => {
    const missing = [...referenced].filter((key) => typeof en[key] !== 'string');

    assert.deepEqual(
      missing.sort(),
      [],
      `disease keys with no English text would render as raw identifiers: ${missing.join(', ')}`,
    );
  });

  it('ships no English text that nothing references', () => {
    // Dead strings are how a KB drifts out of step with the registry it
    // describes: the file grows, the guidance does not.
    const orphans = Object.keys(en).filter((key) => !referenced.has(key));

    assert.deepEqual(orphans.sort(), [], `unreferenced disease strings: ${orphans.join(', ')}`);
  });

  it('never ships an empty English string', () => {
    for (const [key, value] of Object.entries(en)) {
      assert.ok(typeof value === 'string' && value.trim().length > 0, `en/disease.${key} is empty`);
    }
  });

  it('keeps every Hindi key anchored to an English one', () => {
    // Hindi is allowed to be a subset. It is not allowed to be a *different*
    // set — an orphaned Hindi key means a rename went half-applied.
    const orphans = Object.keys(hi).filter((key) => !(key in en));

    assert.deepEqual(orphans.sort(), [], `Hindi keys with no English counterpart: ${orphans}`);
  });

  it('never ships an empty or placeholder Hindi string', () => {
    for (const [key, value] of Object.entries(hi)) {
      assert.ok(
        typeof value === 'string' && value.trim().length > 0,
        `hi/disease.${key} is present but empty — absent is honest, blank is a bug`,
      );
    }
  });

  it('reports the Hindi shortfall rather than hiding it', () => {
    const translated = Object.keys(hi).length;
    const total = referenced.size;

    // Not an assertion that Hindi is missing — that would fail the moment a
    // reviewer starts filling it in. The check is that the count is knowable
    // and consistent, and the number is printed so the gap stays visible in
    // every run.
    assert.ok(translated <= total, 'more Hindi strings than referenced keys');

    // `console.error` is the allowed channel in this repo's lint config, and the
    // number is the point of the test — it belongs in the run output.
    console.error(
      `      · disease KB Hindi coverage: ${translated}/${total} ` +
        `(rule 8 — agronomic Hindi requires human verification before demo)`,
    );
  });
});
