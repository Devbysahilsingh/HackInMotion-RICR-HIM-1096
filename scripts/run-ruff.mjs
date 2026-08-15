#!/usr/bin/env node
/**
 * Runs Ruff the way CI runs it, against the version this repository pins.
 *
 * Why this script exists. `npm run lint:py` used to be a bare
 * `ruff check ml-service scripts/ml`, which resolves whatever `ruff` happens to
 * be on `PATH`. On a machine with an older global Ruff that is not the gate CI
 * enforces: Ruff 0.12 flagged `UP038` in `ml-service/training/models.py`, a rule
 * later Ruff versions removed, so `npm run lint:py` failed locally on code the
 * pinned linter — and therefore CI — considers correct. A lint gate that
 * disagrees with itself by machine is a gate people learn to ignore.
 *
 * CI (`.github/workflows/ci.yml`, job `ml`) installs `requirements-dev.txt` and
 * then runs `python -m ruff`, so the pin in that file is the single source of
 * truth for the version. This script resolves an interpreter that actually has
 * that version and refuses to run against any other, rather than silently
 * linting with the wrong one.
 *
 * Config resolution is Ruff's own and is deliberately not overridden here:
 * files under `ml-service/` resolve `ml-service/pyproject.toml`, and
 * `scripts/ml/` resolves the root `ruff.toml`. The two configs are kept
 * identical on purpose (see the comment at the top of `ruff.toml`), but they
 * are separate files and Ruff picks the nearest one per file.
 *
 * Usage:
 *   node scripts/run-ruff.mjs           # check   — the CI gate
 *   node scripts/run-ruff.mjs --format  # format --check, which CI does not yet run
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mlService = join(repoRoot, 'ml-service');

/** The pin in requirements-dev.txt is the source of truth CI installs from. */
function pinnedVersion() {
  const requirements = join(mlService, 'requirements-dev.txt');
  const match = readFileSync(requirements, 'utf8').match(/^ruff==(\S+)$/m);
  if (!match) {
    throw new Error(`no pinned "ruff==" line found in ${requirements}`);
  }
  return match[1];
}

/**
 * Candidate interpreters, project-local first. The venv layout differs by
 * platform, and a developer who has activated the venv gets `python` for free.
 */
function candidateInterpreters() {
  return [
    join(mlService, '.venv', 'Scripts', 'python.exe'),
    join(mlService, '.venv', 'bin', 'python'),
    'python',
    'python3',
  ];
}

function ruffVersion(interpreter) {
  const probe = spawnSync(interpreter, ['-m', 'ruff', '--version'], { encoding: 'utf8' });
  if (probe.status !== 0) return null;
  return (probe.stdout.match(/ruff\s+(\S+)/) ?? [])[1] ?? null;
}

function resolveInterpreter(wanted) {
  const seen = [];
  for (const candidate of candidateInterpreters()) {
    if (candidate.includes('.venv') && !existsSync(candidate)) continue;
    const found = ruffVersion(candidate);
    if (found === wanted) return candidate;
    if (found) seen.push(`${candidate} -> ruff ${found}`);
  }
  const detail = seen.length ? `\nFound instead:\n  ${seen.join('\n  ')}` : '';
  throw new Error(
    `no interpreter with the pinned ruff ${wanted}.${detail}\n` +
      `Install it: cd ml-service && python -m venv .venv && ` +
      `./.venv/Scripts/pip install -r requirements.txt -r requirements-dev.txt`,
  );
}

/** Mirrors the two CI steps: `.` from ml-service, then `scripts/ml` from root. */
function targets(mode) {
  const args = mode === 'format' ? ['format', '--check'] : ['check'];
  return [
    { label: 'ml-service', cwd: mlService, args: [...args, '.'] },
    { label: 'scripts/ml', cwd: repoRoot, args: [...args, 'scripts/ml'] },
  ];
}

const mode = process.argv.includes('--format') ? 'format' : 'check';
const wanted = pinnedVersion();

let interpreter;
try {
  interpreter = resolveInterpreter(wanted);
} catch (error) {
  console.error(`ruff: ${error.message}`);
  process.exit(1);
}

console.log(`ruff ${wanted} (${mode === 'format' ? 'format --check' : 'check'}) via ${interpreter}\n`);

let failed = false;
for (const target of targets(mode)) {
  const run = spawnSync(interpreter, ['-m', 'ruff', ...target.args], {
    cwd: target.cwd,
    stdio: 'inherit',
  });
  if (run.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
