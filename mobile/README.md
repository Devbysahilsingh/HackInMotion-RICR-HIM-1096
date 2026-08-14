# Khetri — Android app (Phase 6)

The farmer-facing Android client. It consumes the **same `/api/v1` contract as
the web app** and duplicates none of its business logic: engines stay on the
server, translations come from `shared/i18n`, wire types come from
`shared/types/api.ts` (ADR-018, docs/mobile/technology-decision.md).

Stack: Expo SDK 54 · React Native 0.81 · React 19 · TypeScript · React
Navigation 7 · TanStack Query 5 (+ AsyncStorage persistence) · i18next · axios.

> **⚠️ The SDK version is pinned to the demo handset — do not upgrade it.**
> The app was first written on Expo SDK 57 and migrated down to **SDK 54** on
> 2026-08-14, because the demo phone runs **Expo Go 54.0.8** and will not be
> upgraded. Expo Go loads only projects matching its own SDK, so bumping this
> project breaks the only device available for testing. Every version in
> `package.json` was taken from `expo@54.0.36`'s `bundledNativeModules.json`,
> so `npx expo install --check` and `npx expo-doctor` both pass; run them after
> touching any dependency. If the handset's Expo Go ever changes, the pin moves
> with it — and the app has to be re-tested on whatever that build is. Rationale
> and cost: `docs/mobile/technology-decision.md`.

---

## Setup

```bash
cd mobile
npm install
```

The app needs a reachable backend. Start one from the repo root:

```bash
cd backend && npm run dev          # listens on :4000
npm run seed:dev -- --reset        # demo farmer + farm + 3 crops
npm run jobs -- weatherRefresh     # real Open-Meteo data (no key needed)
npm run jobs -- feedRefresh        # engines over that weather → dashboard feed
```

### API base URL — the one thing you must get right

`localhost` on a phone or emulator means *that device*, not your laptop. The
app therefore has to be told the development machine's address explicitly.

| Target | `EXPO_PUBLIC_API_URL` |
|---|---|
| Physical phone, same Wi-Fi (**the supported workflow**) | `http://<LAN-IP>:4000/api/v1` |
| Android emulator | `http://10.0.2.2:4000/api/v1` (the built-in default) |
| Physical phone, `--tunnel` | the tunnelled host, `https://…/api/v1` |

#### Physical phone over LAN

Find the machine's actual LAN IPv4 — do not guess, and do not use a
host-only/virtual adapter (`192.168.56.x` is usually VirtualBox; `169.254.x.x`
is a link-local address that means DHCP failed):

```powershell
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -ne '127.0.0.1' } |
  Select-Object IPAddress, InterfaceAlias, PrefixOrigin
```

Then start Metro bound to that address, with the API URL pointing at the same
machine:

```bash
cd mobile
EXPO_PUBLIC_API_URL="http://<LAN-IP>:4000/api/v1" \
REACT_NATIVE_PACKAGER_HOSTNAME="<LAN-IP>" \
npx expo start --lan
```

Scan the QR with Expo Go, or open `exp://<LAN-IP>:8081` from Expo Go's
"Enter URL manually".

Verify the wiring before blaming the app — from the **phone's browser**:

- `http://<LAN-IP>:8081/status` → `packager-status:running`
- `http://<LAN-IP>:4000/healthz` → the backend's JSON health payload

If either times out on the phone but works on the laptop, it is the host
firewall, not the app. Windows blocks inbound connections on networks
classified **Public**, which is what most Wi-Fi is. Either set the network to
Private, or add inbound rules (elevated PowerShell, dev machines only):

```powershell
New-NetFirewallRule -DisplayName "HIM1096 Metro"   -Direction Inbound -Protocol TCP -LocalPort 8081 -Action Allow
New-NetFirewallRule -DisplayName "HIM1096 Backend" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow
```

Both ports are already bound to `0.0.0.0` by the dev server and by Express, so
nothing in the app or the backend needs changing — and nothing about the
production security configuration is relaxed to make this work.

**Cleartext HTTP.** This LAN setup is plain HTTP. That is fine in Expo Go,
which permits cleartext, and it is fine for a backend that never leaves the
local network. A **release APK will refuse it** — Android blocks cleartext by
default and the app does not opt out — so a built APK must point at an HTTPS
host. That is the intended production shape, not a limitation to work around.

`EXPO_PUBLIC_*` values are compiled into the JS bundle and are **public by
definition**. The API base URL is the only one this app has, and it is the only
one it may ever have — see *Security* below.

---

## Commands

| Command | What it does |
|---|---|
| `npm start` | Metro bundler |
| **`npm run lan:auto`** | **Detects this laptop's current LAN IP, verifies the API, then starts Metro. Use this for a physical phone.** |
| `npm run lan:check` | Same detection and diagnosis, starts nothing |
| `npm run android` | Metro + launch on a connected device/emulator |
| `npm run tunnel` | Metro over a tunnel, for a phone on another network |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Jest unit suite (`jest-expo`) |
| `npm run doctor` | `expo-doctor` dependency/version check |

From the repo root: `npm run test:mobile`, `npm run typecheck:mobile`,
`npm run check:i18n`, `npm run check:ui-strings` (scans `mobile/src` too), and
`npm run scan:apk <file.apk>` for the ST-60 secret scan.

---

## Running on a physical phone

Use `npm run lan:auto`. It resolves the laptop's current LAN address on every
start, so nothing is pinned to an IP that DHCP will change.

### Why a hardcoded IP fails

The phone needs two things from the laptop, and both are reached by IP:

| | Port | Set by |
|---|---|---|
| Metro bundler (the JS) | 8081 | `REACT_NATIVE_PACKAGER_HOSTNAME` |
| The API (the data) | 4000 | `EXPO_PUBLIC_API_URL` |

Set only one and you get an app that loads but cannot talk, or one that never
loads. Pin either to a literal address and it works until the laptop's IP
changes — which happens on joining a different network *and* on an ordinary
DHCP lease renewal. The symptom is confusing: the app works on a personal
hotspot and not on the shared network, which looks like a Wi-Fi problem rather
than a stale address.

### How the address is chosen

A dev laptop typically has several IPv4 addresses and most are useless to a
phone — WSL's vEthernet, VirtualBox host-only, and `169.254.x.x` link-local on
an interface with no lease. Picking by adapter name is fragile, so the script
asks the OS which source address it *would* use to reach the internet (a UDP
`connect`, which sends no packet), and falls back to filtering the interface
list. Skipped interfaces are printed with the reason, so a wrong pick is
visible rather than silent.

### If the phone still cannot connect

Work through these in order.

**1. Confirm from the phone.** On the same Wi-Fi, open
`http://<laptop-ip>:4000/healthz` in the phone's browser. JSON means the path
is clear and Expo will work. The script prints this URL.

**2. Windows Firewall.** `npm run lan` checks this and prints the fix if it is
missing. The failure mode is worth understanding, because it recurs:

Windows writes its "allow node" rules against the **full path** of the
`node.exe` that was running when you clicked Allow. Switch node versions - nvm,
nvm4w, a fresh installer - and the running binary lives at a different path, so
every one of those rules silently stops applying. Nothing in the project
changed; the phone just stops reaching the API. A real example from this repo:

```
rules allowed : C:\program files\nodejs\node.exe
                C:\users\<you>\appdata\local\nvm\v20.20.2\node.exe
actually ran  : C:\nvm4w\nodejs\node.exe        <- covered by neither
```

Fix it once, from an **admin** PowerShell. Use **port** rules, not program
rules, so they survive the next version switch:

```powershell
New-NetFirewallRule -DisplayName "Khetri dev API 4000"  -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow -Profile Any
New-NetFirewallRule -DisplayName "Khetri dev Metro 8081" -Direction Inbound -Protocol TCP -LocalPort 8081 -Action Allow -Profile Any
```

`-Profile Any` matters: Windows classifies most shared and institutional
networks as **Public**, and a rule scoped to Private alone will not apply
there. This is the second most common cause after the stale IP.

**3. AP / client isolation.** Many institutional, hotel and guest networks
block device-to-device traffic outright. **No laptop setting fixes this** — it
is enforced by the access point, and it is the real reason a personal hotspot
succeeds where a campus network fails. Use `npm run tunnel`, which routes Metro
through Expo's servers.

Note that `--tunnel` covers **Metro only**. The API still needs a route the
phone can reach, so on an isolating network either expose port 4000 through a
tunnel of its own and pass it as `EXPO_PUBLIC_API_URL`, or fall back to a
hotspot.

---

## How the pieces fit

```
src/
├── api/          axios instance + interceptors, typed endpoints, query client
├── components/   ui/ primitives · domain/ cards · error boundary · offline banner
├── config/       env.ts — the API base URL, and nothing else
├── hooks/        useAnalyze (upload state machine), network, prefetch, errors
├── i18n/         init + messageKey resolution (resources come from shared/i18n)
├── navigation/   RootNavigator → AuthStack | MainTabs → four feature stacks
├── screens/      one directory per tab, plus intro/ and settings/
├── services/     image compression, text-to-speech
├── store/        AuthContext, LanguageContext
└── theme/        design tokens (palette transcribed from the web app)
```

**Metro and `shared/`.** The canonical translations and wire types live above
this package root, so `metro.config.js` adds `../shared` to `watchFolders` and
maps `@shared/*` through `resolver.extraNodeModules`. `tsconfig.json` declares
the same alias so the editor and the bundler agree.

**Auth.** Access token in memory; refresh token in `expo-secure-store` (Android
Keystore). There is no cookie on this platform, so the refresh token travels in
the request body — a shape the API supports on every route that takes one. A
401 triggers a single-flight refresh and one replay; concurrent 401s share that
one refresh, because presenting a rotated token twice is what the server's
reuse detector correctly treats as theft.

**Offline.** The Query cache is persisted to AsyncStorage (24h; registry 7d) and
rehydrated on cold start, so last session's dashboard, weather, market and
history render with a ● Cached (age) label when there is no signal. NetInfo
drives React Query's online manager and the global banner. Writes are blocked
and explained while offline. What does *not* work offline is stated in-app:
login, new photo analysis, and fresh data.

---

## Camera and permissions

Permissions are requested **in context**, never on launch, each with a
localized rationale, and every feature degrades when denied:

| Permission | Used for | When denied |
|---|---|---|
| `CAMERA` | photographing a leaf | gallery picker, plus a link to system settings |
| `ACCESS_FINE_LOCATION` | placing a farm once | manual state/district entry |

`RECORD_AUDIO` is **blocked** in `app.config.ts`: the shipped voice feature is
text-to-speech only (see below).

Photos are resized to ≤1600px and re-encoded at JPEG q85 before upload
(`services/image.ts`) — typically 3–8MB down to 200–500KB, which is the
difference between a scan that completes on a rural connection and one that
times out. The server re-reads magic bytes, re-encodes and strips EXIF
regardless; the client copy is a bandwidth optimisation, never the authority.

---

## Voice — the STT decision

**Shipped: text-to-speech only, no microphone.** `docs/voice/voice-interface.md`
offered three paths for speech *input* on Android; this app takes none of them,
deliberately:

- **Dev build** (`expo-speech-recognition`) would forfeit the Expo Go demo route
  that docs/mobile/deployment.md names as primary.
- **Groq proxy** needs `POST /api/v1/voice/transcribe`, which does not exist in
  `backend/src/routes/` — building it is a server feature nobody has approved.
- **Intents-only** is what ships. The voice doc's intent layer is
  input-agnostic by design ("voice, tap, or typed text"), so the intents stay
  reachable as large tappable targets — a genuine accessibility feature for a
  low-literacy user, not a consolation prize.

Text-to-speech (`expo-speech`) works in Expo Go on the device's own engine,
including offline, and is offered on the irrigation verdict, weather risk and
crop-health recommendation. The button hides itself when the handset has no
voice pack for the active language rather than presenting a control that
silently does nothing.

---

## Localization

Every user-facing string comes from `shared/i18n` — there are no literals in
`src/`, and `npm run check:ui-strings` fails the build if one appears
(`accessibilityLabel` counts: a screen reader speaks it verbatim). Namespaces
are the web's sixteen plus `mobile`, which holds the copy that has no web
counterpart (permission rationales, camera guidance, the offline banner).

Language is chosen on first run, stored on the device, and mirrored to the
account via `PATCH /users/me` so the next handset opens the same way. It is
resolved *before* the first render, so a Hindi speaker never sees a frame of
English.

⚠️ The Hindi in the `mobile` namespace is **machine-authored and awaiting a
Hindi-literate reviewer** — recorded in `shared/i18n/hi/_verification.json`
under `unverifiedAdditions`. The same caveat applies to the 408-string disease
knowledge base.

---

## Security

- Refresh token: SecureStore only. Access token: memory only. Neither is ever
  logged, displayed, or written to AsyncStorage.
- The Query cache (AsyncStorage) holds ordinary user data and is cleared on
  logout — a shared handset is the assumed case.
- No secrets in the bundle. `npm run scan:apk <apk>` (ST-60) searches a built
  APK for credential shapes and reports the member and offset **without
  printing the matched value**.
- Release builds strip `console.*` except `console.error` (`babel.config.js`).
- HTTPS everywhere in production; the emulator default is plain HTTP to
  `10.0.2.2`, which cannot leave the machine.
- The demo build runs production security behaviour. There are no debug
  bypasses, and the only `__DEV__`-gated affordance is showing the API URL on
  the settings screen.

---

## Building an APK (EAS)

```bash
npm install -g eas-cli
eas login                 # needs a free Expo account
eas init                  # writes the projectId
EXPO_PUBLIC_API_URL=https://<api-host>/api/v1 eas build -p android --profile production
```

`eas.json`'s `production` profile carries **no** `EXPO_PUBLIC_API_URL` on
purpose: the staging/production backend host does not exist yet (the Render
deploy is an open item in `docs/development/MASTER-TODO.md`), and defaulting it
to a domain nobody owns would ship an APK that talks to a stranger. Pass it at
build time.

After a build: install it, then run the ST-60 scan on the artefact
(`npm run scan:apk path/to.apk`) before it goes near a demo phone.

---

## Testing

Unit scope only, as docs/mobile/testing.md commits to — no Detox in this
timeframe. The suite covers the axios interceptors and token custody, the
upload state machine, network detection and the offline hooks. Device coverage
is the scripted manual matrix in `docs/mobile/testing.md`.
