#!/usr/bin/env node
/**
 * ST-60, client half: prove no secret travels inside the Android app.
 *
 * docs/security/security-testing.md — "Gemini key absent from all client
 * bundles (grep dist/APK)"; docs/mobile/security.md — "no secrets anywhere in
 * bundle (policy: EXPO_PUBLIC_* = public by definition; only API base URL
 * lives there; verified by strings-scan of built APK)".
 *
 * ## What it scans
 *
 * An APK is a zip. Rather than shelling out to `strings` (absent on Windows)
 * or `unzip`, this reads the archive with Node's zlib and searches the
 * decompressed members — in practice `assets/index.android.bundle`, which is
 * where a leaked `EXPO_PUBLIC_*` value or an accidentally-imported `.env`
 * would end up, plus `resources.arsc` and any other text member.
 *
 * ## What counts as a finding
 *
 * Provider key *shapes*, not a list of this project's actual keys — the point
 * is to catch a secret nobody thought to add to a denylist, and a scanner that
 * needs to be told each secret cannot do that. The real values are never read
 * by this script and never printed: a match reports the member, the offset and
 * the matched *pattern name*, never the matched text.
 *
 * Usage:
 *   node scripts/scan-apk-strings.mjs <path-to.apk>
 *   node scripts/scan-apk-strings.mjs --bundle <path-to.bundle>
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/**
 * Credential shapes. Each is a published prefix or a structural signature, so
 * a new key of that provider matches without anyone updating this file.
 */
const PATTERNS = [
  { name: 'google-api-key', re: /AIza[0-9A-Za-z_-]{35}/g },
  { name: 'openrouter-key', re: /sk-or-v1-[0-9a-f]{16,}/g },
  { name: 'openai-style-key', re: /\bsk-[A-Za-z0-9]{32,}\b/g },
  { name: 'groq-key', re: /\bgsk_[A-Za-z0-9]{40,}\b/g },
  { name: 'cloudinary-url', re: /cloudinary:\/\/[0-9]+:[^@\s"']+@[a-z0-9-]+/gi },
  { name: 'mongodb-srv-uri', re: /mongodb(?:\+srv)?:\/\/[^\s"']*:[^\s"']*@/gi },
  { name: 'aws-access-key-id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'jwt-with-payload', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./g },
  /**
   * The project's own server-side variable *names*. Their presence in a client
   * bundle means a server module was imported into the app, which is a leak
   * even if the value is undefined at build time.
   */
  {
    name: 'server-env-var-name',
    re: /\b(?:GEMINI_API_KEY|OPENROUTER_API_KEY|GROQ_API_KEY|DATAGOVIN_API_KEY|OPENWEATHER_API_KEY|CLOUDINARY_URL|MONGODB_URI|JWT_SECRET|SERVICE_KEY)\b/g,
  },
];

/** Minimal zip reader: yields `{name, bytes}` for every member. */
function* zipMembers(buffer) {
  // Walk local file headers. Enough for an APK, which is a plain zip.
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;

    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;

    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
    const data = buffer.subarray(dataStart, dataStart + compressedSize);

    // A streamed entry (bit 3) has its sizes in a trailing descriptor, so the
    // local header cannot be trusted; those members are skipped and reported
    // rather than silently treated as clean.
    const streamed = (buffer.readUInt16LE(offset + 6) & 0x08) !== 0;

    if (!streamed && compressedSize > 0) {
      try {
        yield { name, bytes: method === 8 ? inflateRawSync(data) : data };
      } catch {
        yield { name, bytes: null };
      }
    } else if (streamed) {
      yield { name, bytes: null };
    }

    offset = dataStart + compressedSize;
  }
}

function scan(name, bytes, findings) {
  const text = bytes.toString('latin1');
  for (const { name: pattern, re } of PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      // The matched text is deliberately NOT recorded — printing a leaked
      // credential into CI output would leak it a second time.
      findings.push({ member: name, pattern, offset: match.index });
    }
  }
}

const args = process.argv.slice(2);
const bundleMode = args.includes('--bundle');
const target = args.find((arg) => !arg.startsWith('--'));

if (!target) {
  console.error('Usage: node scripts/scan-apk-strings.mjs <path-to.apk|--bundle path.bundle>');
  process.exit(2);
}
if (!existsSync(target)) {
  console.error(`No such file: ${target}`);
  process.exit(2);
}

const findings = [];
const skipped = [];
const buffer = readFileSync(target);
let membersScanned = 0;

if (bundleMode) {
  scan(target, buffer, findings);
  membersScanned = 1;
} else {
  for (const { name, bytes } of zipMembers(buffer)) {
    if (!bytes) {
      skipped.push(name);
      continue;
    }
    membersScanned += 1;
    scan(name, bytes, findings);
  }
}

console.log(
  `APK/bundle secret scan — ${target} (${(statSync(target).size / 1048576).toFixed(1)} MB)`,
);
console.log(`${membersScanned} member(s) scanned, ${skipped.length} skipped.\n`);

if (membersScanned === 0) {
  console.error('FAIL  nothing was scanned — the file is not a readable zip or bundle.');
  process.exit(1);
}

if (findings.length === 0) {
  console.log('PASS  no credential-shaped string found.');
  if (skipped.length > 0) {
    console.log(`NOTE  ${skipped.length} member(s) could not be read: ${skipped.join(', ')}`);
  }
  process.exit(0);
}

for (const finding of findings) {
  console.error(`FAIL  ${finding.member} @${finding.offset}  [${finding.pattern}]`);
}
console.error(`\n${findings.length} credential-shaped string(s). Values withheld by design.`);
process.exit(1);
