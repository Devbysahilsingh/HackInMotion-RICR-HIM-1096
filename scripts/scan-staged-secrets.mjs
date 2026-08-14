#!/usr/bin/env node
/**
 * Portable staged-secret scanner (pre-commit gate).
 *
 * Runs on every machine with no external install, so the secret gate is never
 * silently absent. Gitleaks, when installed, runs additionally for depth
 * (see .githooks/pre-commit) — it is a second layer, not a replacement.
 *
 * Exit codes: 0 = clean, 1 = potential secret found (commit blocked).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const MAX_BYTES = 1_000_000; // skip large/binary blobs
const ALLOWLIST_MARK = 'pragma: allowlist-secret';
const NUL = String.fromCharCode(0);

/**
 * Filenames that must never be committed regardless of content.
 *
 * Extension rules matter more than they look: a DER-encoded key is binary, so
 * the content rules below skip it entirely (see the NUL check) and the filename
 * is the only thing standing in the way. The list previously stopped at `.pem`
 * and `.p12`, which left Android release signing material — the highest-value
 * secret this project produces — resting on `.gitignore` alone.
 */
const FORBIDDEN_PATHS = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example)[\w.-]+$/,
  /\.pem$/,
  /\.p12$/,
  /\.pfx$/,
  /\.p8$/,
  /\.key$/,
  /\.jks$/,
  /\.keystore$/,
  /(^|\/)id_rsa(\.|$)/,
  /(^|\/)id_ed25519(\.|$)/,
  /(^|\/)\.npmrc$/,
  /(^|\/)google-services\.json$/,
  /(^|\/)GoogleService-Info\.plist$/,
  /(^|\/)service-?account[\w.-]*\.json$/i,
  /(^|\/)credentials\.json$/,
];

const RULES = [
  // Length is deliberately {20,} rather than the exact {35}: a truncated or
  // partially-pasted key is still a credential fragment worth blocking.
  { id: 'google-api-key', re: /AIza[0-9A-Za-z_-]{20,}/ },
  { id: 'anthropic-key', re: /sk-ant-[0-9A-Za-z_-]{20,}/ },
  { id: 'openai-key', re: /\bsk-(?:proj-)?[0-9A-Za-z]{32,}/ },
  { id: 'openrouter-key', re: /sk-or-v1-[0-9a-f]{32,}/ },
  { id: 'groq-key', re: /\bgsk_[0-9A-Za-z]{40,}/ },
  { id: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'github-token', re: /\bgh[pousr]_[0-9A-Za-z]{36,}/ },
  { id: 'slack-token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/ },
  { id: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: 'mongodb-uri-with-password', re: /mongodb(?:\+srv)?:\/\/[^:\s/]+:[^@\s]+@/ },
  { id: 'cloudinary-uri-with-secret', re: /cloudinary:\/\/\d+:[^@\s]+@/ },
  // Generic assignment of a long opaque value to a secret-ish name.
  // Quotes are optional: .env / .ini / .yaml style assignments are unquoted,
  // and requiring quotes left that whole class of files uncovered.
  {
    id: 'generic-secret-assignment',
    // No leading \b: underscore is a word character, so \b never matches inside
    // names like aws_access_key_id — which silently exempted that whole family.
    re: /(?:access[_-]?key(?:[_-]?id)?|api[_-]?key|secret(?:[_-]?key)?|client[_-]?secret|passwd|password|token|private[_-]?key)\s*[:=]\s*['"]?([A-Za-z0-9_\-/+=]{20,})['"]?/i,
  },
];

/**
 * Documentation placeholders, kept deliberately narrow.
 * A loose rule here hides real findings: matching the bare word "example"
 * suppresses AWS's own published test access key (its value ends in that
 * word), and would equally suppress a genuine credential containing it.
 */
const PLACEHOLDER = /<[^>]{2,}>|your[_-]|placeholder|changeme/i;

function stagedFiles() {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

/**
 * Everything git tracks.
 *
 * For CI, where there is no staged set — running the pre-commit form there
 * would scan zero files and report "clean", which is worse than not running it
 * at all. The rules are identical; only the file list is wider, so a secret
 * that reached a branch before the hook was installed on someone's clone is
 * still caught.
 */
function trackedFiles() {
  const out = execFileSync('git', ['ls-files'], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

const scanAll = process.argv.includes('--all');
const targets = scanAll ? trackedFiles() : stagedFiles();

const findings = [];

for (const file of targets) {
  if (FORBIDDEN_PATHS.some((re) => re.test(file))) {
    findings.push({ file, line: 0, rule: 'forbidden-file', text: 'file must never be committed' });
    continue;
  }

  let size;
  try {
    size = statSync(file).size;
  } catch {
    continue; // staged deletion or unreadable path
  }
  if (size > MAX_BYTES) continue;

  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (content.includes(NUL)) continue; // binary

  content.split('\n').forEach((line, i) => {
    if (line.includes(ALLOWLIST_MARK)) return;
    for (const rule of RULES) {
      const match = line.match(rule.re);
      if (!match) continue;
      if (PLACEHOLDER.test(match[0])) continue;
      findings.push({
        file,
        line: i + 1,
        rule: rule.id,
        // Never print the full match — redact all but a short prefix.
        text: `${match[0].slice(0, 6)}…(${match[0].length} chars redacted)`,
      });
      break;
    }
  });
}

if (findings.length > 0) {
  console.error('\n✖ Potential secret(s) detected — commit blocked.\n');
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.rule}]  ${f.text}`);
  }
  console.error(
    `\nMove the value into an environment variable (see docs/security/secrets-management.md).` +
      `\nIf this is a genuine false positive, append "${ALLOWLIST_MARK}" to that line.\n`,
  );
  process.exit(1);
}

console.log('✔ secret scan: clean');
