#!/usr/bin/env node
/**
 * Hardcoded user-facing string check for the web client.
 *
 * docs/i18n/architecture.md rule 1: "**Zero hardcoded user-facing strings** —
 * ESLint `i18next/no-literal-string` on web+mobile src (JSX text)". This is
 * that gate, written as a repo script rather than as a lint plugin: the plugin
 * plus its tree is new supply-chain surface for a rule this file implements in
 * a hundred lines, and dependency-security.md asks that every dependency earn
 * its place.
 *
 * ## What counts as a violation
 *
 * JSX **text content** and a small set of user-visible attributes
 * (`placeholder`, `title`, `alt`, `aria-label`) holding a literal that looks
 * like prose. A string is prose if it contains a lowercase letter followed by
 * a space and another letter — which is what separates "Add your first field"
 * from `text-sm font-medium`, `data-testid` values, enum codes and paths.
 *
 * ## What is deliberately not a violation
 *
 * - Anything inside `t(...)` — that is the point.
 * - Enum codes, i18n keys, CSS classes, URLs, and single words with no space.
 * - Engine field names in the trace table: they are deliberately untranslated
 *   so the trace can be checked against the engine that produced it.
 * - Test files and the dev-only component showcase.
 *
 * Usage:
 *   node scripts/check-ui-strings.mjs [--json]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC = fileURLToPath(new URL('../web/frontend/src/', import.meta.url));
const asJson = process.argv.includes('--json');

/** Files exempt, each for a stated reason. */
const EXEMPT = [
  { match: /\.test\.tsx?$/, why: 'test file' },
  { match: /[\\/]test[\\/]/, why: 'test harness' },
  { match: /[\\/]dev[\\/]/, why: 'dev-only surface, stripped from production builds' },
];

/** Attributes whose literal value a farmer can read. */
const VISIBLE_ATTRIBUTES = ['placeholder', 'title', 'alt', 'aria-label'];

/**
 * Prose test: a lowercase letter, a space, then a letter. `Add a crop` matches;
 * `text-sm`, `IRRIGATE_TODAY`, `data-testid`, `image/jpeg` and `/api/v1` do not.
 */
const looksLikeProse = (value) => /[a-z]\s+[A-Za-z]/.test(value.trim()) && value.trim().length > 3;

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const findings = [];
const exempted = [];

for (const file of sourceFiles(SRC)) {
  const relative = path.relative(SRC, file).replace(/\\/g, '/');

  const exemption = EXEMPT.find((rule) => rule.match.test(file));
  if (exemption) {
    exempted.push({ file: relative, why: exemption.why });
    continue;
  }

  const isTsx = file.endsWith('.tsx');
  const lines = readFileSync(file, 'utf8').split('\n');

  let inBlockComment = false;

  lines.forEach((line, index) => {
    // Comments carry prose by design and are not rendered.
    const trimmed = line.trim();
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      return;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true;
      return;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

    // ── JSX text content: `>Some words<` on one line ────────────────────────
    //
    // Only in `.tsx`. In a plain `.ts` module the same pattern matches
    // generics and comparisons — `unwrap<T>(body), meta: (body as ...` reads
    // as JSX text to a regex and is nothing of the kind.
    for (const match of isTsx ? line.matchAll(/>([^<>{}\n]+)</g) : []) {
      const text = match[1] ?? '';
      if (looksLikeProse(text)) {
        findings.push({ file: relative, line: index + 1, kind: 'jsx-text', text: text.trim() });
      }
    }

    // ── Visible attributes with a literal value ─────────────────────────────
    for (const attribute of VISIBLE_ATTRIBUTES) {
      const pattern = new RegExp(`\\b${attribute}=(?:"([^"]+)"|'([^']+)')`, 'g');
      for (const match of line.matchAll(pattern)) {
        const value = match[1] ?? match[2] ?? '';
        if (looksLikeProse(value)) {
          findings.push({
            file: relative,
            line: index + 1,
            kind: `attribute:${attribute}`,
            text: value,
          });
        }
      }
    }
  });
}

if (asJson) {
  console.log(JSON.stringify({ ok: findings.length === 0, findings, exempted }, null, 2));
} else {
  console.log('UI string check — web/frontend/src\n');

  if (findings.length === 0) {
    console.log(`No hardcoded user-facing strings found.`);
    console.log(`${exempted.length} file(s) exempt (tests and the dev-only showcase).`);
  } else {
    for (const finding of findings) {
      console.error(`FAIL  ${finding.file}:${finding.line}  [${finding.kind}]  "${finding.text}"`);
    }
    console.error(`\n${findings.length} hardcoded user-facing string(s).`);
  }
}

process.exit(findings.length === 0 ? 0 : 1);
