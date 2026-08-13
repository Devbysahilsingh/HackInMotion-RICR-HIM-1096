#!/usr/bin/env node
/**
 * en/hi parity gate for `shared/i18n`.
 *
 * docs/i18n/architecture.md rule 3: "script `scripts/check-i18n.mjs` diffs en
 * vs hi key sets — missing keys fail the check … fallbackLng 'en' is a safety
 * net, not a strategy." This is that script.
 *
 * What it enforces, and why each one is a real product failure:
 *
 *   1. **Key parity, both directions.** A key present only in `en` is a farmer
 *      reading English on a Hindi screen. A key present only in `hi` is dead
 *      weight nobody will ever see, and usually the residue of a rename.
 *   2. **No empty values.** An empty string renders as nothing at all, which
 *      is worse than a raw identifier because it is invisible.
 *   3. **No untranslated copies** (`hi` byte-identical to `en`). Reported, not
 *      failed: proper nouns, units and codes legitimately match, so this is a
 *      review list rather than a gate.
 *   4. **Interpolation-placeholder parity.** `{{amountMm}}` missing from the
 *      Hindi string means the number never reaches the farmer — the sentence
 *      still renders, so no other check would catch it. This is the one that
 *      pays for the script.
 *   5. **Verification status**, per docs/i18n/translation-strategy.md step 3:
 *      how many Hindi strings a human has signed off. Reported honestly; the
 *      script never claims sign-off it cannot see.
 *
 * Usage:
 *   node scripts/check-i18n.mjs            # full report, exits non-zero on failure
 *   node scripts/check-i18n.mjs --json     # machine-readable
 *   node scripts/check-i18n.mjs --quiet    # failures only
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const I18N_DIR = fileURLToPath(new URL('../shared/i18n/', import.meta.url));
const LANGUAGES = ['en', 'hi'];
const BASE = 'en';

const asJson = process.argv.includes('--json');
const quiet = process.argv.includes('--quiet');

/**
 * Namespaces whose Hindi side is a **known, documented gap** rather than an
 * oversight — i.e. a missing key here warns instead of failing.
 *
 * Empty, and it should stay that way. `disease` lived here while its Hindi
 * side was 0/408; that gap was closed on 2026-08-13 and the exemption went
 * with it, so a disease key that goes missing now fails the gate like any
 * other. Whether those strings have been *reviewed* is a separate question,
 * tracked in `hi/_verification.json` and reported at the bottom of this run —
 * parity and sign-off are deliberately not the same signal.
 */
const KNOWN_GAPS = {};

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*[^}]*\}\}/g;

function namespaces() {
  const dir = path.join(I18N_DIR, BASE);
  return (
    readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      // `_`-prefixed files are ledgers and manifests, not namespaces.
      .filter((file) => !file.startsWith('_'))
      .map((file) => file.replace(/\.json$/, ''))
      .sort()
  );
}

/**
 * The human-verification ledger.
 *
 * Lives beside the namespaces rather than inside them, because the backend's
 * own parity test asserts every value in a namespace is a non-empty string and
 * a `_meta` object would break that. Absent or unreadable means zero verified,
 * which is the honest default — this script never assumes sign-off.
 */
function verificationLedger() {
  const file = path.join(I18N_DIR, 'hi', '_verification.json');
  if (!existsSync(file)) return { namespaces: {} };
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { namespaces: {} };
  }
}

function load(language, namespace) {
  const file = path.join(I18N_DIR, language, `${namespace}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

const placeholders = (value) =>
  new Set([...String(value).matchAll(PLACEHOLDER)].map((match) => match[1]));

const ledger = verificationLedger();

const failures = [];
const warnings = [];
const report = [];

for (const namespace of namespaces()) {
  const resources = Object.fromEntries(
    LANGUAGES.map((language) => [language, load(language, namespace)]),
  );

  const missingFile = LANGUAGES.filter((language) => resources[language] === null);
  if (missingFile.length > 0) {
    failures.push(`${namespace}: no resource file for ${missingFile.join(', ')}`);
    continue;
  }

  const base = resources[BASE];
  const isKnownGap = Object.hasOwn(KNOWN_GAPS, namespace);

  const row = {
    namespace,
    total: Object.keys(base).length,
    missingHi: [],
    orphanHi: [],
    empty: [],
    untranslated: [],
    placeholderMismatch: [],
    knownGap: isKnownGap ? KNOWN_GAPS[namespace] : null,
    verified: 0,
  };

  for (const language of LANGUAGES) {
    const target = resources[language];

    for (const [key, value] of Object.entries(target)) {
      if (typeof value !== 'string') {
        failures.push(`${language}/${namespace}.${key}: value is not a string`);
        continue;
      }
      if (value.trim().length === 0) row.empty.push(`${language}/${key}`);
    }

    if (language === BASE) continue;

    for (const key of Object.keys(base)) {
      if (!Object.hasOwn(target, key)) row.missingHi.push(key);
    }
    for (const key of Object.keys(target)) {
      if (!Object.hasOwn(base, key)) row.orphanHi.push(key);
    }

    for (const [key, value] of Object.entries(base)) {
      const translated = target[key];
      if (typeof translated !== 'string') continue;

      if (translated === value) row.untranslated.push(key);

      const expected = placeholders(value);
      const actual = placeholders(translated);
      const missing = [...expected].filter((name) => !actual.has(name));
      const extra = [...actual].filter((name) => !expected.has(name));

      if (missing.length > 0 || extra.length > 0) {
        row.placeholderMismatch.push(
          `${key} (${missing.length ? `missing ${missing.join(',')}` : ''}${
            missing.length && extra.length ? '; ' : ''
          }${extra.length ? `unexpected ${extra.join(',')}` : ''})`,
        );
      }
    }
  }

  const entry = ledger.namespaces?.[namespace];
  const marks = Array.isArray(entry?.verified) ? entry.verified : [];
  // '*' means the whole namespace was signed off, rather than listing 400 keys.
  row.verified = marks.includes('*') ? row.total : marks.length;
  row.verifiedBy = entry?.verifiedBy ?? null;

  if (row.empty.length > 0) {
    failures.push(`${namespace}: ${row.empty.length} empty value(s) — ${row.empty.join(', ')}`);
  }
  if (row.placeholderMismatch.length > 0) {
    failures.push(`${namespace}: interpolation mismatch — ${row.placeholderMismatch.join(' · ')}`);
  }

  if (row.missingHi.length > 0) {
    const message = `${namespace}: ${row.missingHi.length} key(s) missing in hi`;
    if (isKnownGap) warnings.push(`${message} — ${KNOWN_GAPS[namespace]}`);
    else failures.push(`${message} — ${row.missingHi.slice(0, 10).join(', ')}`);
  }
  if (row.orphanHi.length > 0) {
    failures.push(
      `${namespace}: ${row.orphanHi.length} key(s) present only in hi — ${row.orphanHi.slice(0, 10).join(', ')}`,
    );
  }
  if (row.untranslated.length > 0 && !isKnownGap) {
    warnings.push(
      `${namespace}: ${row.untranslated.length} hi value(s) identical to en — ${row.untranslated.slice(0, 6).join(', ')}`,
    );
  }

  report.push(row);
}

// ── Output ──────────────────────────────────────────────────────────────────

const totalKeys = report.reduce((sum, row) => sum + row.total, 0);
const totalVerified = report.reduce((sum, row) => sum + row.verified, 0);
const totalMissing = report.reduce((sum, row) => sum + row.missingHi.length, 0);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        ok: failures.length === 0,
        totalKeys,
        totalVerified,
        totalMissing,
        report,
        failures,
        warnings,
      },
      null,
      2,
    ),
  );
} else {
  if (!quiet) {
    console.log('i18n parity — shared/i18n (en ↔ hi)\n');
    const width = Math.max(...report.map((row) => row.namespace.length), 9);

    console.log(
      `${'namespace'.padEnd(width)}  ${'keys'.padStart(5)}  ${'missing hi'.padStart(10)}  ${'verified'.padStart(8)}`,
    );
    for (const row of report) {
      const flag =
        row.verifiedBy === 'claude'
          ? '  ← machine-translated, awaiting human review'
          : row.knownGap
            ? '  ← known gap'
            : '';
      console.log(
        `${row.namespace.padEnd(width)}  ${String(row.total).padStart(5)}  ${String(row.missingHi.length).padStart(10)}  ${String(row.verified).padStart(8)}${flag}`,
      );
    }

    console.log(
      `\n${totalKeys} keys · ${totalMissing} missing in hi · ${totalVerified} human-verified`,
    );
  }

  for (const warning of warnings) console.log(`\nWARN  ${warning}`);
  for (const failure of failures) console.error(`\nFAIL  ${failure}`);

  if (failures.length === 0) {
    console.log('\nParity check passed.');
    if (totalVerified < totalKeys) {
      // Stated plainly rather than implied by silence: parity is not sign-off.
      console.log(
        `\nVERIFICATION  ${ledger.status ?? 'UNKNOWN'} — ${totalVerified}/${totalKeys} Hindi` +
          ' strings human-verified.\n' +
          '  Parity is a key-set check. It proves every key exists in both\n' +
          '  languages; it proves nothing about whether the Hindi is correct.\n' +
          '  The review in docs/i18n/translation-strategy.md is still owed, and\n' +
          '  shared/i18n/hi/_verification.json is where its outcome is recorded.',
      );
    }
  }
}

process.exit(failures.length === 0 ? 0 : 1);
