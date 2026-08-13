# Mobile Deployment

- **Demo primary: Expo Go** — instant, free, on-device; requires dev machine + phone network path (same Wi-Fi or `--tunnel`); demo phone pre-loaded. Setup, LAN-IP discovery, the two verification URLs and the Windows firewall rules are in `mobile/README.md` — that file is the runbook, this one is the decision record.
- **⚠ The project's SDK and the handset's Expo Go must match.** Expo Go loads only projects built for its own SDK; a mismatch is refused outright with "this project requires a newer version of Expo Go", before any of this app's code runs. That is not a warning to work around — it is the whole reason **this project is pinned to SDK 54** (the demo phone runs Expo Go 54.0.8). **Upgrading the SDK without upgrading the handset's Expo Go breaks the only device available for testing**, and upgrading the handset invalidates every device-matrix row already run against the old build. If the pin ever moves, it moves *because the device moved*, and the matrix is re-run. Rationale and cost: technology-decision.md.
- **Backup/deliverable: EAS Build Android APK** (free tier; queue can be slow — trigger early). APK sideloaded on demo phone + link in README (Drive/GitHub release).
- **Config:** `app.config.ts` (TypeScript, not `app.json` — the API base URL has to be read from the environment at build time and defaulted, which static JSON cannot do); name `KrishiSaarthi` (OD-4), slug `him-1096-krishisaarthi`, scheme `krishisaarthi`, icon/adaptive icon in `mobile/assets/`, Android package id `in.him1096.krishisaarthi`, `versionCode` 1, `userInterfaceStyle: 'light'` (single light theme on purpose — the stated field context is bright sunlight). Permissions minimal: `CAMERA` + `ACCESS_FINE_LOCATION` declared, `RECORD_AUDIO` in `blockedPermissions`.
- **No `locales` block** — and that is deliberate, not an omission. See i18n.md: Expo's `locales` compiles to iOS `InfoPlist.strings` only, and Android's permission-sheet text cannot be overridden by an app, so the block would have been inert on the only shipped target.
- **STT dev-build decision (voice doc): CLOSED — not pursued.** Intents-only ships; TTS unaffected. See technology-decision.md.
- **Not in scope (stated):** Play Store submission (review timelines >72h), iOS (future).
- **Env:** `EXPO_PUBLIC_API_URL` only; no secrets (mobile/security.md). `EXPO_PUBLIC_*` values are compiled into the JS bundle and are public by definition.

## EAS profiles as built (`mobile/eas.json`)

| Profile | distribution | buildType | `EXPO_PUBLIC_API_URL` |
|---|---|---|---|
| `development` | internal (`developmentClient: true`) | apk | `http://10.0.2.2:4000/api/v1` |
| `preview` | internal | apk | `http://10.0.2.2:4000/api/v1` |
| `production` | internal | apk | **none — passed at build time** |

`cli.appVersionSource` is `local`; `submit.production` is empty because store submission is out of scope.

**Why `production` deliberately carries no `EXPO_PUBLIC_API_URL`.** The staging/production backend host does not exist yet — the Render deploy is still an open external item in `docs/development/MASTER-TODO.md`. Baking in a default would ship an APK that talks to a domain nobody owns; leaving the variable out means the build either receives a real host or falls back to `app.config.ts`'s emulator alias (`10.0.2.2`), which cannot leave the machine. So it is passed explicitly:

```bash
EXPO_PUBLIC_API_URL=https://<api-host>/api/v1 eas build -p android --profile production
```

**Cleartext.** The two internal profiles point at plain HTTP because they are emulator profiles. A release APK will refuse cleartext — Android blocks it by default and the app does not opt out — so a production build must be given an HTTPS host. That is the intended shape, not a limitation to work around.

**`extra.eas` is omitted entirely until `eas init` links the project to an Expo account.** It was briefly written as `projectId: process.env.EAS_PROJECT_ID ?? null`, which is a trap worth recording: Expo's config normalisation turns that `null` into `{}`, so the resolved manifest carried `extra.eas.projectId` as an *object* where tooling expects a string id. Spreading the key in only when the variable is set is the honest representation of "not linked yet".

## Status

⚠ **BLOCKED / not done.** `eas init` has not been run (no Expo account is linked), **no APK has been built, and no APK has been installed on any phone.** Nothing in this document claims otherwise. The post-build steps below are written for whoever does it:

1. `eas build -p android --profile production` with the API host passed in.
2. `npm run scan:apk <file.apk>` from the repo root — the ST-60 secret scan (`scripts/scan-apk-strings.mjs`), which reads the archive with Node's zlib, searches the decompressed members for credential *shapes*, and reports member + offset + pattern name **without printing the matched value**. It has never been run against a real APK, because none exists.
3. Install and run the scripted manual matrix in testing.md.
