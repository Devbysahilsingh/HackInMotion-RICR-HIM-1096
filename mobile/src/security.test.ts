/**
 * Mobile client security — static and behavioural [blocking].
 *
 * The web has `web/frontend/src/security.test.tsx`; until Phase 7's completion
 * pass the Android client had no equivalent, which meant the surface with the
 * *most* local state — a Keystore, a plain-text cache, a permission set, an
 * OS-registered URL scheme — was the one with no security suite at all.
 *
 * What this file can and cannot prove is worth being exact about. It runs in
 * Jest, on Node, against the stubs in `jest.setup.js`. It therefore asserts
 * **the code's behaviour and the code's shape**: which store a credential
 * reaches, what logout actually erases, that no source file logs a token, that
 * no unsafe URL scheme can be opened, that the app declares no permission it
 * does not use. It does NOT prove anything about a running APK on real
 * hardware — Keystore semantics, the release-build console strip, and Android's
 * cleartext policy are all properties of a device. Those stay
 * `PENDING — PHYSICAL DEVICE REQUIRED` in the scorecard rather than being
 * quietly implied by a green run here.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { PERSIST_KEY, clearPersistedCache, queryPersister } from './api/queryClient';
import { clearRefreshToken, setAccessToken, setRefreshToken } from './api/session';

// ── Node built-ins, declared locally ────────────────────────────────────────

/**
 * This is the only file in the app that reads the filesystem, and it does so
 * under Jest, never on a device. Adding `"node"` to the tsconfig `types` array
 * would make it typecheck — and would also make `import fs from 'node:fs'`
 * typecheck inside a screen, which is precisely the mistake a React Native
 * project should keep impossible. So the two built-ins are declared here, at
 * the narrowest scope that works.
 */
declare function require(id: string): unknown;
declare const __dirname: string;

const { readFileSync, readdirSync, statSync } = require('node:fs') as {
  readFileSync: (path: string, encoding: string) => string;
  readdirSync: (path: string) => string[];
  statSync: (path: string) => { isDirectory: () => boolean };
};
const { join } = require('node:path') as { join: (...parts: string[]) => string };

// ── Source inventory ────────────────────────────────────────────────────────

const SRC = __dirname;

/** Every shipped source file: `src/**` minus tests and type-only declarations. */
function sourceFiles(dir: string = SRC, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, found);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    found.push(path);
  }
  return found;
}

const sources = sourceFiles().map((path) => ({
  path: path.slice(SRC.length + 1).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}));

/** Strips comments, so a line *explaining* a rule is not read as breaking it. */
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('inventory', () => {
  it('found the source tree it is auditing', () => {
    // Guards the whole file: if the walk breaks, every assertion below passes
    // vacuously over an empty list.
    expect(sources.length).toBeGreaterThan(50);
  });
});

// ── §1 · Credential custody ─────────────────────────────────────────────────

describe('credential custody', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    setAccessToken(null);
    await AsyncStorage.clear();
  });

  it('writes the refresh token to SecureStore and never to AsyncStorage', async () => {
    await setRefreshToken('refresh-abc');

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'him1096.refreshToken',
      'refresh-abc',
      expect.objectContaining({ keychainAccessible: 'AFTER_FIRST_UNLOCK' }),
    );

    const everything = await AsyncStorage.getAllKeys();
    for (const key of everything) {
      const value = await AsyncStorage.getItem(key);
      expect(value ?? '').not.toContain('refresh-abc');
    }
  });

  it('names no credential store other than SecureStore for the refresh token', () => {
    // The rule is structural, not incidental: a future screen persisting the
    // token "for convenience" is exactly the regression this catches.
    const offenders = sources.filter(
      (file) =>
        file.path !== 'api/session.ts' &&
        /SecureStore\.(set|get|delete)ItemAsync/.test(code(file.text)),
    );

    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it('keeps the access token out of every persistent store', async () => {
    setAccessToken('access-xyz');

    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });
});

// ── §2 · What logout actually erases ────────────────────────────────────────

describe('logout erases local state', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('deletes the persisted query cache from disk rather than waiting on a throttle', async () => {
    // The persister writes on a 2s throttle. A logout that only empties the
    // in-memory cache leaves the previous farmer's dashboard, farms, prices and
    // health history readable in AsyncStorage for as long as the process
    // survives — which on a handed-over phone is exactly the window that
    // matters.
    await queryPersister.persistClient({
      buster: '',
      timestamp: Date.now(),
      clientState: { mutations: [], queries: [] },
    });

    expect(await AsyncStorage.getItem(PERSIST_KEY)).not.toBeNull();

    await clearPersistedCache();

    expect(await AsyncStorage.getItem(PERSIST_KEY)).toBeNull();
  });

  it('survives a storage failure without throwing', async () => {
    // Logout must always end signed out; a broken store is not grounds for
    // stranding a farmer inside an account on a shared handset.
    const spy = jest
      .spyOn(queryPersister, 'removeClient')
      .mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(clearPersistedCache()).resolves.toBeUndefined();

    spy.mockRestore();
  });

  it('pairs every in-memory cache clear with an on-disk one', () => {
    /**
     * Structural rather than behavioural, deliberately: the three call sites are
     * a logout, an interceptor callback and a NetInfo listener, and rendering
     * the provider three ways to reach them would test the harness more than the
     * rule. The rule itself is simple and total — a `queryClient.clear()` that
     * is not followed by `clearPersistedCache()` leaves the previous farmer's
     * data on disk — so it is asserted as written.
     */
    const auth = sources.find((file) => file.path === 'store/AuthContext.tsx');
    expect(auth).toBeDefined();

    const body = code(auth!.text);
    const clears = (body.match(/queryClient\.clear\(\)/g) ?? []).length;
    const purges = (body.match(/clearPersistedCache\(\)/g) ?? []).length;

    expect(clears).toBeGreaterThan(0);
    expect(purges).toBe(clears);
  });

  it('deletes the refresh token from SecureStore', async () => {
    await setRefreshToken('refresh-abc');
    await clearRefreshToken();

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('him1096.refreshToken');
  });
});

// ── §3 · Logging ────────────────────────────────────────────────────────────

describe('logging', () => {
  it('ships no console call that could carry a credential', () => {
    /**
     * `transform-remove-console` strips everything except `console.error` in a
     * production build, so `console.error` is the one that has to be safe by
     * content rather than by removal. The audit is therefore: only
     * AppErrorBoundary may call it, and no console call anywhere may name a
     * credential.
     */
    const credential = /\b(token|refreshToken|password|secret|apiKey|authorization|bearer)\b/i;

    const offenders: string[] = [];

    for (const file of sources) {
      const body = code(file.text);
      const calls = body.match(/console\.\w+\([^)]*\)/g) ?? [];

      for (const call of calls) {
        if (credential.test(call)) offenders.push(`${file.path}: ${call}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps console.error to the error boundary', () => {
    const callers = sources
      .filter((file) => /console\.error\(/.test(code(file.text)))
      .map((file) => file.path);

    expect(callers).toEqual(['components/AppErrorBoundary.tsx']);
  });

  it('never interpolates the Authorization header into a message', () => {
    const offenders = sources.filter((file) =>
      /`[^`]*\$\{[^}]*(token|Authorization)[^}]*\}[^`]*`/i.test(
        code(file.text).replace(/headers\.set\([^)]*\)/g, ''),
      ),
    );

    expect(offenders.map((f) => f.path)).toEqual([]);
  });
});

// ── §4 · URL handling and deep links ────────────────────────────────────────

describe('URL handling', () => {
  it('opens no URL the app did not construct', () => {
    /**
     * `Linking.openURL` with anything derived from a server response or a
     * navigation param is how a `javascript:`, `file:` or `intent:` URL gets
     * executed. The app deliberately uses only `Linking.openSettings()`, which
     * takes no argument at all — so the safe assertion is the absence of the
     * dangerous call, not a filter on its input.
     */
    const offenders = sources.filter((file) => /Linking\.openURL\s*\(/.test(code(file.text)));

    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it('registers no deep-link router for the declared scheme', () => {
    /**
     * `app.config.ts` declares `scheme: 'khetri'`, so Android registers
     * an intent filter and any installed app can launch this one. That is only
     * a *routing* surface if React Navigation is given a `linking` config —
     * without one, an incoming URL opens the app and is otherwise inert, and no
     * attacker-supplied parameter reaches a screen.
     *
     * If a linking config is ever added, this fails, and whoever adds it has to
     * come back and write the parameter-validation tests that would then be
     * required.
     */
    const offenders = sources.filter((file) =>
      /<NavigationContainer[^>]*\slinking=/.test(file.text),
    );

    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it('embeds no WebView', () => {
    const offenders = sources.filter((file) =>
      /\bWebView\b|react-native-webview/.test(code(file.text)),
    );

    expect(offenders.map((f) => f.path)).toEqual([]);
  });
});

// ── §5 · Network configuration ──────────────────────────────────────────────

describe('network configuration', () => {
  it('hard-codes no API host outside the config module', () => {
    // One place resolves the base URL; a screen that reached a host directly
    // would bypass the interceptor, and with it the bearer header, the refresh
    // and the error normalisation.
    const offenders = sources.filter(
      (file) =>
        file.path !== 'config/env.ts' && /https?:\/\/(?!res\.cloudinary)/.test(code(file.text)),
    );

    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it('sends the bearer token only through the shared client', () => {
    const offenders = sources.filter(
      (file) => file.path !== 'api/client.ts' && /Authorization/.test(code(file.text)),
    );

    expect(offenders.map((f) => f.path)).toEqual([]);
  });
});

// ── §6 · Build configuration ────────────────────────────────────────────────

describe('build configuration', () => {
  const repoRoot = join(__dirname, '..');
  const read = (name: string) => readFileSync(join(repoRoot, name), 'utf8');

  it('requests no permission the app does not use', () => {
    const config = read('app.config.ts');

    // RECORD_AUDIO is the one to watch: expo-camera adds it by default for
    // video sound, and this app photographs leaves. It is declined at source
    // AND blocked, so a plugin default cannot reintroduce it.
    expect(config).toMatch(/recordAudioAndroid:\s*false/);
    expect(config).toMatch(/blockedPermissions:\s*\['android\.permission\.RECORD_AUDIO'\]/);

    // And it must not appear in the *granted* list, which is a different array
    // in the same object — matching on the file as a whole would be satisfied
    // by the `blockedPermissions` line above.
    const granted = /(?<!blocked)[Pp]ermissions:\s*\[([^\]]*)\]/.exec(config);
    expect(granted).not.toBeNull();
    expect(granted?.[1]).toContain('android.permission.CAMERA');
    expect(granted?.[1]).not.toContain('RECORD_AUDIO');
  });

  it('strips console output from production builds', () => {
    const babel = read('babel.config.js');

    expect(babel).toMatch(/transform-remove-console/);
    // `error` is the deliberate exception — see §3.
    expect(babel).toMatch(/exclude:\s*\['error'\]/);
  });

  it('does not enable cleartext HTTP for release builds', () => {
    /**
     * Android blocks cleartext by default from API 28, and this config does
     * nothing to re-enable it. That is the correct posture and is asserted so
     * it stays that way — an `usesCleartextTraffic: true` added to make a LAN
     * demo work would silently apply to every build.
     *
     * The consequence is deliberate and documented in docs/mobile/deployment.md:
     * a release APK cannot talk to an `http://` LAN backend. Expo Go can,
     * because Expo Go carries its own permissive manifest.
     */
    const config = read('app.config.ts');

    expect(config).not.toMatch(/usesCleartextTraffic/);
    expect(config).not.toMatch(/networkSecurityConfig/);
  });

  it('carries no secret in the build profiles', () => {
    // `EXPO_PUBLIC_*` values are compiled into the bundle and are readable by
    // anyone holding the APK, so a key here is a published key.
    const eas = read('eas.json');
    const config = read('app.config.ts');

    for (const source of [eas, config]) {
      expect(source).not.toMatch(/EXPO_PUBLIC_[A-Z_]*(KEY|SECRET|TOKEN|PASSWORD)/);
      expect(source).not.toMatch(/(api[-_]?key|secret|password)\s*[:=]\s*['"][^'"]{8,}/i);
    }
  });
});
