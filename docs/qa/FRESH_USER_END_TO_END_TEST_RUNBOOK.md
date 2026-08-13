# Fresh User End-to-End Test Runbook

**Purpose.** Manually verify the whole product with a brand-new account, through the UI, in one sitting.
**Audience.** A tester following steps literally. No developer knowledge assumed.
**Prepared.** 2026-08-13, against a database cleaned to zero farms / zero crops / zero crop-health logs.

> **Read this first — two rules.**
>
> 1. **Do not skip steps.** Several later steps depend on data created earlier.
> 2. **Do not edit any Hindi text** anywhere in the app or the repo. If Hindi looks wrong, write it down in §14 and keep going.

---

## Conventions used below

| Notation | Meaning |
| --- | --- |
| `<CHOOSE>` | You pick the value. The required format is always stated. |
| **Exact** | Type this value character-for-character. It is required for a later step to work. |
| ✅ | What proves the feature genuinely works |
| ⚠️ | What to do if it fails |

---

## 0. Pre-Test Checklist

Run each check. **Do not start Step 1 until all of these pass.**

### 0.1 Start the three services

Three terminals, in this order.

**Terminal A — ML service**
```bash
cd U:\Projects\HackInMotion-RICR-HIM-1096\ml-service
.\.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --env-file .env --port 7860
```

**Terminal B — Backend**
```bash
cd U:\Projects\HackInMotion-RICR-HIM-1096\backend
npm run dev
```

**Terminal C — Frontend**
```bash
cd U:\Projects\HackInMotion-RICR-HIM-1096\web\frontend
npm run dev
```

MongoDB runs as a Windows service and needs no start. Confirm with `Get-Service MongoDB` → `Running`.

### 0.2 Verify health

```bash
curl http://localhost:4000/healthz
curl http://127.0.0.1:7860/healthz
```

| Field | Required value |
| --- | --- |
| backend `status` | `ok` |
| backend `db` | `connected` |
| `tiers.ml.configured` | `true` |
| `tiers.gemini.configured` | `true` |
| `tiers.openrouter.configured` | `true` |
| `tiers.storage.configured` | `true` |
| ml-service `modelVersion` | `model-v1.0` (**must not** start with `stub-`) |

⚠️ If `storage.configured` is `false`, Step 9 (image upload) cannot be tested at all — stop and fix `CLOUDINARY_URL` first.
⚠️ If `modelVersion` starts with `stub-`, the model file failed to load. Stop.

### 0.3 Credential sources (never print the values)

| Provider | Variable | File |
| --- | --- | --- |
| Database | `MONGODB_URI` | `backend/.env` |
| Auth signing | `JWT_SECRET` | `backend/.env` |
| Images | `CLOUDINARY_URL` | `backend/.env` |
| AI tier 2 | `GEMINI_API_KEY` | `backend/.env` |
| AI tier 3 | `OPENROUTER_API_KEY` | `backend/.env` |
| Mandi data | `DATAGOVIN_API_KEY`, `DATAGOVIN_RESOURCE_ID` | `backend/.env` |
| Weather fallback | `OPENWEATHER_API_KEY` | `backend/.env` |
| ML auth | `SERVICE_KEY` | `backend/.env` **and** `ml-service/.env` (must be byte-identical) |
| Frontend API base | `VITE_API_URL` | `web/frontend/.env` |

Primary weather (Open-Meteo) needs **no key**.

### 0.4 Expected starting state

| Item | Expected |
| --- | --- |
| Farms in database | 0 |
| Crops | 0 |
| Crop-health logs | 0 |
| Cloudinary assets under `him1096/development` | 0 |
| Market price rows | **163 — preserved on purpose** |
| Weather snapshots | **2 — preserved on purpose** |
| Crop registry entries | **10 — static knowledge, must never be deleted** |

---

## 0.5 Public Landing Page — new

**URL:** http://localhost:5173 while signed out.

**This screen is new.** `/` no longer bounces an anonymous visitor to `/login` — it is a public product landing page: hero ("Know what your farm needs — before it becomes a problem."), problem statement, a three-step "How it works", four feature cards (weather, mandi, crop health, "shows its working"), a trust list, and a final call to action. The header carries the language toggle and **Sign in**; the primary CTA **Start with my farm** goes to `/register`.

✅ The page renders with no network images — the hero illustration is inline SVG, so nothing can arrive broken.
✅ Switch the language toggle to हिंदी: the whole landing page re-renders in Hindi.
✅ **See how it works** scrolls to the three steps; **Start with my farm** lands on `/register`.
✅ While signed **in**, visiting `/` forwards you through `/home` to your dashboard (or onboarding when the account has no farm).

---

## 1. Create New Account

**URL:** http://localhost:5173 → the landing page → **Start with my farm** (or `/login` → **Create an account**)
**Path:** `/register`

| Field | Value | Rule |
| --- | --- | --- |
| Name | `<CHOOSE>` e.g. `Ramesh Patil` | 2–60 characters |
| Email | `<CHOOSE a new unique address>` e.g. `fresh.test.001@example.com` | Valid email, ≤254 chars. **Must not already exist.** |
| Password | `<CHOOSE>` e.g. `FreshTest2026` | **Minimum 8 characters.** No uppercase/digit/symbol rule is enforced. |
| Language | Leave **English** | — |

**There is no phone field. There is no OTP. There is no email verification.** Registration completes immediately.
**There is no role selector.** Every account is a farmer account.

Click **Create account**.

**Expected:** immediate redirect to **`/onboarding`** — a full-screen page showing the app name, your name, a language toggle, an **Add your first field** button, and **Skip**.

> **This was a bug and is now fixed — check it deliberately.** Registration used to land on `/dashboard` instead. Two redirects fired on the same state change (the authenticated-guard and the register screen) and the guard won. The destination is now derived from the account itself by a landing resolver (previously at `/`, now at **`/home`** since `/` became the public landing page): **no farms → onboarding, has farms → dashboard.** If you land on the dashboard here, the fix has regressed — report it.

✅ The URL bar reads `/onboarding`, **not** `/dashboard`.
✅ Open DevTools → Application → Cookies. A refresh cookie exists, marked **HttpOnly**, and its Path is scoped to the refresh route (not `/`).
✅ DevTools → Network shows `POST /api/v1/auth/register` → **201**.

**Then verify the other direction** (it must not over-correct): after you have created a farm in Step 4, log out and log back in. You must land on **`/dashboard`**, not onboarding.

⚠️ `409` / "already registered" → the email is taken; pick another.
⚠️ `429` → registration rate limit hit; wait an hour or use a different network.

---

## 2. Login

Verify the credentials actually work before building data on them.

1. Go to `/settings` → click **Log out**.
2. You land on `/login`.
3. Enter the **same email and password** from Step 1.
4. Click **Log in**.

**Expected:** redirect to `/dashboard`.

✅ `POST /api/v1/auth/login` → **200**.
✅ Reload the page with F5 — you stay logged in (the refresh cookie re-mints the access token).

⚠️ 401 → password typo. Re-register with a new email rather than guessing.

---

## 3. Dashboard (first look — before any data)

**URL:** `/dashboard`

At this point you have no farm, so this is the **designed empty state**.

**Expected:**
- Page renders. No blank screen, no spinner stuck forever, no error.
- The crops area shows an empty state with a link to add a field.
- The feed area is empty or shows an empty-state message.

✅ The empty state is *worded*, not blank. A blank white area is a bug.

⚠️ Blank screen → check Terminal B for a backend crash.

---

## 4. Farm Creation — location first

**URL:** `/farms/new` (or click **Add your first field**)

> **This screen changed.** It no longer asks for latitude and longitude. You tell it *where your farm is* in words, and the app resolves the coordinates itself. Coordinates still exist behind an **advanced** disclosure for anyone who wants them.

### 4.1 The normal path — type a place, not numbers

| Field | Value | Notes |
| --- | --- | --- |
| **Use my current location** | *optional* — see 4.3 | Skip it for this run |
| State | **`Madhya Pradesh`** | **Exact** |
| District | **`Bhopal`** | **Exact** |
| Village or area | **`Kolar`** | **Exact** — optional in general, used here |
| Farm name | **leave blank** | Deliberately |
| Size / Unit | `2` / `acre` | |
| Soil type | **`Black`** | **Exact** |
| Water source | **`Drip`** | **Exact** |

Click **Save farm**.

**Expected:**
- The farm is created. **You are not asked for coordinates at any point.**
- The farm is named **`Kolar`** — the app named it from your village because you left the name blank.
- The farm page shows Bhopal, Madhya Pradesh.

✅ **You never typed a number that identifies a place.** That is the whole point of this screen.
✅ Leaving the name blank did not block you.
✅ Within a second or two the weather section populates (see Step 8) — no job run needed.

⚠️ If the form still shows Latitude and Longitude as ordinary required fields, you are on an old build. Restart the frontend.

### 4.2 Verify the app resolved the location

Open the farm page. It should show your district and state as **you typed them** — "Bhopal", not "Bhopal District". The app fills in gaps; it never renames your place.

Measured on 2026-08-13: `Madhya Pradesh / Bhopal / Kolar` resolved to **23.1648, 77.4189**, recorded with source `geocoded` (meaning looked up, not measured by your phone).

### 4.3 GPS path — test it once

Create a second farm and click **Use my current location**.
- **Allow** → coordinates are captured from your device and are *never* overwritten by the lookup. Source is `gps`.
- **Block** → a friendly message appears and the State/District/Village fields remain fully usable. **This is the important case** — refusing the permission must cost you nothing.

### 4.4 Advanced coordinates — only if you want them

Expand **Exact location (optional)**. Latitude/Longitude are there for anyone who has them. Enter `51.5` / `-0.12` (London) to confirm it is rejected as outside India, then clear both.

## 5. Crop Creation

**URL:** on the farm page, click **Add a crop**

| Field | Value | Notes |
| --- | --- | --- |
| Which crop? | **`Cotton`** | **Exact** — the only crop strong across *every* later step |
| Variety | `<CHOOSE>` e.g. `Suraj` | ≤60 chars, optional |
| Sowing date | **`2026-06-14`** | **Exact.** Must be between 400 days ago and 180 days ahead |
| Area | **`1`** | optional in general — but use `1` here so the three crops below fit the 2-acre farm (see §5.2, the land ledger) |
| Area unit | `acre` | required whenever an area is given |

Click **Save crop**.

**Expected:** the crop page opens showing Cotton, variety, days since sowing, and growth stage **`Growing`** (internally `DEVELOPMENT`).

✅ `POST /api/v1/farms/<id>/crops` → **201**.
✅ Status is **In the ground** (active), because the sowing date is in the past.

> **Why Cotton.** It is the only crop that is simultaneously: top-ranked with a perfect score in Step 7, fully FAO-56 costed for Step 10, backed by a sourced TNAU fertilizer table in Step 11, and `SPECIALIZED` tier so Step 9 routes to the real ML model.

### 5.1 Add two more crops — required, not optional

A farm must carry several crops without them interfering. Add both:

| Crop | Sowing date | Area |
| --- | --- | --- |
| **`Maize`** | **`2026-06-20`** | `0.5` acre |
| **`Chilli`** | **`2026-06-25`** | `0.5` acre |

Then go back to the farm page (`/farms/<id>`).

**Expected:** all **three** crops listed, each showing its own name, sowing date, status badge and growth-stage badge.

> **This was a bug and is now fixed — check it deliberately.** The farm detail page used to go **completely blank** (caught by the error boundary) as soon as the farm had any crop. `GET /farms/:id` returned bare crop rows while the page reads `crop.registry.names` and `crop.stage.stage`, so it threw a TypeError on first render. If this page is blank or shows an error card, the fix has regressed — report it.

✅ Three crop cards render, each with a **stage badge** (e.g. *Growing*). A missing stage badge means the decoration is missing again.
✅ Click **Cotton** → the crop page shows Cotton. Go back, click **Maize** → it shows Maize. They must not show the same crop.
✅ Edit Cotton's variety, save, then open Maize — Maize's variety must be unchanged.
✅ Refresh the browser on the farm page — all three crops survive.

⚠️ Blank page or error card → open DevTools → Console. A `Cannot read properties of undefined` error means the crop decoration regressed.

### 5.2 The land ledger — crop area may not exceed the farm

**This rule is new. Test it deliberately, in both places it is enforced.**

Your farm is **2 acres** (Step 4) and the three crops occupy exactly 2: Cotton 1 + Maize 0.5 + Chilli 0.5. The farm is now **exactly full**, which makes the refusals easy to trigger:

1. Open **Add a crop** on the farm. Under the area field you see: *"You have N acre available for crops."*
2. Enter an area **larger than N** → the form refuses on the spot: *"Crop area cannot be greater than your farm's remaining area."* No request is sent.
3. Bypass check — prove the server enforces it too. In DevTools console, replay the create with an oversized area (or use curl with your bearer token):
   `POST /api/v1/farms/<id>/crops` with `{"cropCode":"ONION","sowingDate":"2026-06-14","areaValue":999,"areaUnit":"acre"}`
   **Expected: 422** with `error.messageKey = "crop.areaExceedsFarm"` and `details[0].rule = "exceeds_farm_area"` carrying `availableAcres`.
4. Mirror rule: edit the **farm** and set its size below the planted total → refused with *"Farm size cannot be smaller than the area already given to crops."* (server: `farm.sizeBelowCropArea`).
5. Mark a crop **harvested** → its ground frees up; the available figure on the crop form grows accordingly.

✅ Units are reconciled: a `hectare` crop counts as 2.47 acres against an `acre` farm.
✅ A crop saved **without** an area occupies nothing and is never blocked.

---

## 6. Populate Weather, Market and Feed

The background jobs build their work list from farms that exist. Your farm did not exist when they last ran, so run them once now.

```bash
cd U:\Projects\HackInMotion-RICR-HIM-1096\backend
npm run jobs -- weatherRefresh
npm run jobs -- feedRefresh
npm run jobs -- marketRefresh --json
```

**Expected from `marketRefresh --json`:**
- `"ok": true`
- `"aborted": false`
- `"fetched"` in the low hundreds
- `"dropRate"` below `0.3`

✅ `dropRate` under 0.30 means the schema-drift guard did not trip.
⚠️ `"skipped": "no_work"` → your farm was not saved. Redo Step 4.
⚠️ `"skipped": "not_configured"` → the report names the missing variable.

---

## 7. Crop Recommendation

**URL:** `/crop-recommendation` — reachable from the **Farms** page header (**What should I plant?**), or type the URL.

| Field | Value |
| --- | --- |
| Farm | `North Field` |
| Season | **`Kharif`** |
| Preference | `Cash crop` |

Click the run/submit button.

**Expected — exactly this ranking:**

| Rank | Crop | Score | Evidence |
| --- | --- | --- | --- |
| 1 | **Cotton** | **1.0** | **0.85** |
| 2 | Soybean | 0.975 | 0.60 |
| 3 | Chilli | 0.9 | 0.60 |
| 4 | Maize | 0.9 | 0.60 |
| 5 | Onion | 0.9 | 0.60 |

**Also expected:**
- **Wheat** and **Potato** listed as *excluded*, reason **season mismatch** (both are Rabi crops).
- A **limitations** note saying temperature could not be scored (no district climate normals exist) and soil data was not sourced for most crops.
- A caution that your *preference* was **not scored**.

✅ These numbers are produced by a deterministic engine. If you re-run with the same inputs you must get byte-identical results.
✅ **Contrast test:** re-run with Season = **`Rabi`**. Cotton must now be *excluded* and **Wheat** must top the list at 0.975. Same farm, different season, fully explained.

⚠️ Different numbers → the crop registry seed is missing. Run `npm run seed:registry`.

---

## 8. Weather

> **Fixed since the last revision — check deliberately.** A newly-created farm used to show **"Not fetched yet"** for up to **3 hours**, because the refresh job runs on a 3-hourly tick over farms that already exist. Creating a farm now warms its grid cell in the background, *after* the response is sent. Weather should appear within a second or two of creating a field, with no job run.

**URL:** sidebar → **Weather** (`/weather` — with one farm it forwards straight to that farm's page; with several it asks which field), or on the farm page click **Weather** → `/farms/<farmId>/weather`

**Expected:**
- The header names **your farm and district** — you always know whose sky this is.
- A freshness indicator reading **Live** (or **Cached** with an age).
- **Risks first**: what this weather means for your crops sits above the charts ("no risks" is stated just as plainly), then the forecast strip and the temperature/rain charts.

✅ Open the **Why** control on the risk strip. It must show the actual numbers behind the verdict — consecutive days, humidity percentages, temperature band. Real numbers, not prose.
✅ The freshness label is set by the server, never guessed by the browser.

**Do not expect specific temperatures.** This is live data; read what is shown.

⚠️ "Not fetched yet" → wait ~2 seconds and reload once (the warm is asynchronous). If it persists, your coordinates differ from Step 4, or the provider is unreachable — run `npm run jobs -- weatherRefresh` and read the report.

### 8.1 Two farms must never share weather — do this, it is the important one

Weather is stored per **0.1° grid cell**, not per farm, so the farm→snapshot lookup is the only thing keeping two fields apart. A leak would still show *real* weather, just the wrong field's — which is why it must be checked with two genuinely distant locations.

**Create a second farm** (`/farms/new`) with deliberately different coordinates:

| Field | Value |
| --- | --- |
| Farm name | `South Field` |
| State | **`Maharashtra`** |
| District | **`Nagpur`** |
| Latitude | **`21.1458`** |
| Longitude | **`79.0882`** |
| Size / Unit | `2` / `acre` |
| Soil | `Black` · Water source | `Drip` |

Now do exactly this, writing the numbers down:

1. Open **North Field → Weather**. Record **max temperature**, **humidity**, **rainfall** for the first day.
2. Open **South Field → Weather**. Record the same three numbers.
3. **They must be different.** Nagpur runs hotter and drier than Nashik in August.
4. Reload North Field's weather (F5) — its numbers are unchanged.
5. Reload South Field's weather — its numbers are unchanged.
6. **Log out**, log back in.
7. Open North Field → Weather. Same numbers as step 1.
8. Open South Field → Weather. Same numbers as step 2.

✅ Neither farm ever shows the other's readings, before or after logout.
✅ Each farm shows a forecast (**14 days**) of its own.

**Reference values measured on 2026-08-13** — yours will differ, since this is live data. What must hold is the *pattern*: two distinct sets, Nagpur warmer and drier.

| | North Field (Nashik) | South Field (Nagpur) |
| --- | --- | --- |
| Grid cell | `20.0,73.8` | `21.1,79.1` |
| Max temp | 28.1 °C | 32.4 °C |
| Humidity | 85 % | 71 % |
| Rain | 2.1 mm (94 %) | 1.3 mm (41 %) |

⚠️ **If the two farms show identical readings, stop and report it.** That is a cross-farm leak, and it is the single most misleading failure this product can have — the weather would look perfectly real while belonging to the wrong field.

---

## 9. Market / Mandi — nearby first

**URL:** `/market` (sidebar → **Market**)

> **This screen changed.** It opens with **what your local mandis are actually trading**, not with "pick one of your crops". A mandi is not a crop — one mandi trades several — and the crop dropdown is now a *filter*, not the opening question.

### 9.1 Nearby mandis

**Expected, without you selecting a location:**
- A heading naming **your farm**.
- Your village/district/state underneath.
- **In your district** — mandis in your own district.
- **Elsewhere in your state** — the rest.
- Each mandi card lists **every commodity that mandi trades**, each with modal price, the min–max range and the date.
- A freshness indicator.
- A footnote explaining that mandi locations are not published, so results are grouped by district.

✅ **You never selected a state, district or mandi.** The farm already knew.
✅ At least one mandi card shows **more than one commodity**. If every card shows exactly one, the "mandi is not a crop" model has regressed — report it.
✅ **No card claims a distance in kilometres.** Agmarknet publishes no mandi coordinates, so any "12 km away" would be invented. Grouping by district is the honest form.

Measured for the Bhopal farm on 2026-08-13: **228 mandis, 2 in district, 6 commodities**; top card **Bhopal APMC** → Onion ₹1550, Wheat ₹2723.

✅ **Commodity names are display names, not codes.** The rows and the crop dropdown must read *Onion* / *Wheat* (or *प्याज* / *गेहूँ* in Hindi) — a raw `ONION`/`WHEAT` code on screen is a regression of the localization fix.

### 9.2 Crop as a filter

Change the crop dropdown from **All crops** to any listed commodity.

**Expected:** the same place, fewer results — only mandis trading that crop, showing only that crop.

✅ You were **not** asked to re-select your state, district or mandi. The location is unchanged; only the contents narrowed.
✅ The list only offers commodities that are genuinely traded near you — the dropdown is built from real data, not a fixed menu.

### 9.3 Honest empty state

Pick a crop with no nearby trade (cotton is out of season in August). You should get a written empty state, **never** a fabricated price.

### 9.4 Per-crop signal (unchanged)

Below the nearby section, the older per-crop view still shows the sell/hold signal and the price-trend chart for your own crops. The trend chart may be a single point — see the caveat in §12.2.

## 10. Crop Health, Image Upload and the AI Chain

Rate limits: **10 analyses per day, 3 per minute.** Steps 10.1–10.4 use four. Pause 60 seconds between the third and fourth.

### 10.1 Confident ML result

**URL:** `/scan` (sidebar → **Scan**)

| Field | Value |
| --- | --- |
| Crop | `Cotton — North Field` |
| Description | optional, e.g. `Angular water-soaked spots after rain` |
| Share to community | **leave unticked** |

**Image to upload — exact path:**
```
U:\Projects\HackInMotion-RICR-HIM-1096\datasets\raw\cotton_sarcld2024\SAR-CLD-2024 A Comprehensive Dataset for Cotton Leaf Disease Detection\Original Dataset\Original Dataset\Bacterial Blight\BBC00122.jpg
```

This is a **held-out test image the model never trained on**.

Click **Analyze**.

**Expected:**
- Result page at `/health/<id>`.
- Disease: **Bacterial blight (angular leaf spot / black arm)**
- Confidence bar showing **~100%**
- Your uploaded photo displayed
- Sections: **What we saw** (7 items), **What to do next** (4), **Prevention** (3), and **Sources** with real TNAU/ICAR citations

✅ Right-click the displayed photo → **Open image in new tab**. The URL host must be `res.cloudinary.com` and must start with `https://`. It must load. *This proves the Cloudinary round-trip, not merely a database row.*
✅ The advice text comes from the sourced knowledge base — the AI never writes treatment text.
✅ **No dosages are given anywhere.** The app refers you to a KVK / Kisan Call Centre instead. That is deliberate.

⚠️ "Storage unavailable" → `CLOUDINARY_URL` key lacks upload permission. Stop; this needs a Cloudinary dashboard fix.

### 10.2 Image-hash cache (no duplicate upload)

Upload **the exact same file again** for the **same crop**.

**Expected:** result returns almost instantly with a *cached* notice.

✅ It takes well under a second versus ~3 seconds the first time.
✅ **History does not gain a second entry**, and Cloudinary does not gain a second asset. Quota is not spent twice.

### 10.3 ML uncertain → escalation to Gemini

Requires the **Maize** crop from Step 5.

| Field | Value |
| --- | --- |
| Crop | `Maize — North Field` |

**Image — exact path:**
```
U:\Projects\HackInMotion-RICR-HIM-1096\datasets\raw\plantdoc\PlantDoc-Dataset-master\test\Corn leaf blight\1321189.jpg
```

This is a real *field* photograph. The model's own published field accuracy is low (0.126), so it correctly abstains.

**Expected:** the local model declines, the request escalates, and a result comes back **labelled as AI-assisted** rather than from the local model.

✅ Open the **Why / escalation** section. It must show the ML tier reporting *uncertain*, followed by the tier that answered.
✅ The returned disease name must be one of the app's known maize diseases. **A disease name outside the app's own list is a serious bug — report it.**

### 10.4 Crop mismatch — the model refuses

| Field | Value |
| --- | --- |
| Crop | **`Cotton`** (deliberately wrong for this photo) |

**Image — exact path:**
```
U:\Projects\HackInMotion-RICR-HIM-1096\datasets\raw\plantvillage\Plant_leave_diseases_dataset_without_augmentation\Tomato___Tomato_Yellow_Leaf_Curl_Virus\image (3652).JPG
```

**Expected:** the app does **not** diagnose a cotton disease. It reports that it could not identify the problem and offers a retake and the symptom checker.

✅ The model recognises this tomato leaf with ~99.8% certainty in isolation, yet still refuses because you declared cotton. **A confident cotton diagnosis here is a serious bug.**

### 10.5 Severity (engine-assessed, never model-invented)

Return to the Step 10.1 result. Enter:

| Field | Value |
| --- | --- |
| Affected area | `35` (%) |
| Spread rate | `Spreading fast` |

**Expected:** a severity badge (**Severe** for these inputs) plus a severity explanation trace.

✅ The trace shows *your* inputs driving the result. Severity is computed by the rules engine from farmer observation — the AI never assigns it.

### 10.6 Symptom checker (no image, no external provider)

**URL:** `/scan/symptoms`

| Field | Value |
| --- | --- |
| Crop | `Cotton — North Field` |
| Affected part | `Leaf` |
| Pattern | `Spots` |
| Colour | `Brown` |
| Distribution | `Along the veins` |
| Spread rate | `Spreading fast` |

**Expected:** ranked candidate diseases with match scores, a **Why** trace naming which answers matched, and possibly an expert-referral prompt.

✅ This works with **zero** external credentials — it is the final fallback tier.

---

## 11. Fertilizer

**URL:** crop page → **Fertilizer** tab

**Expected for Cotton:**
- Total NPK **32 : 16 : 16**
- Unit **kg per acre**
- A split schedule (basal + top dressings)
- A **disclaimer**, always shown
- A **soil-test** recommendation
- Source citation (TNAU)

✅ The unit is **per acre** and is **never silently converted to hectares**. The source published it per acre; the app preserves that.

---

## 12. History, Charts and Logout

### 12.1 History
**URL:** `/history` — sidebar → **History** on desktop; on mobile, the **History** button in the dashboard header. The advice tab is labelled **Advice** (सलाह), not "Home".

**Expected:** two tabs — advice and scans. The scans tab lists your analyses from Step 10.

✅ The number of scan entries equals the number of **distinct** images you uploaded. The repeat upload in 10.2 must **not** appear twice.

### 12.2 Charts — complete inventory, verify each is backed by real data

The application has exactly **three** chart surfaces. There are no others — do not go hunting.

| # | Chart | Page | Data source | What must be true |
| --- | --- | --- | --- | --- |
| 1 | Forecast chart(s) | `/farms/<id>/weather` | `GET /farms/:id/weather` → `weatherSnapshots` (Open-Meteo) | Axis labels present; plotted values match the numbers shown in the risk **Why** trace |
| 2 | Forecast strip | `/farms/<id>` (farm detail) | same snapshot | Same days as the full weather page — the two must agree |
| 3 | Price trend | `/market`, crop = Onion | `GET /market/prices` → `marketPrices` (data.gov.in) | See the caveat below |

**For each chart:**

✅ **Cross-check one number.** On the weather page, read a temperature off the chart and confirm the same figure appears in the risk **Why** trace. A chart that disagrees with its own trace is rendering stale or wrong data.
✅ **Filters change it.** On `/market`, switch the range 30 → 7 days. The request in DevTools → Network must change (`days=7`) and the rendered series must respond.
✅ **Empty state is worded.** Select **Cotton** on `/market`. You must get a written empty state — **not** an empty chart frame with axes and no message.
✅ **Hindi labels.** Switch to Hindi (Step 13) and re-check: axis and legend labels translate; numerals stay numerals.
✅ **Responsive.** In device mode (Step 18) charts must not overflow their card horizontally.

**Price-trend caveat — expected, not a bug.** All current market rows share **one arrival date**, so the trend is a single point across ~40 mandis rather than a line, and the signal card reads *guidance unavailable*. That is honest behaviour; it fills in as the nightly job accumulates days.

⚠️ A chart with axes but **no plotted series and no empty-state message** is a genuine bug — record it.

### 12.3 Irrigation
**URL:** crop page → **Irrigation** tab

**Expected:** a verdict plus a **Why** trace containing real FAO-56 numbers.

Now log an irrigation: date **today**, **leave the amount blank**.

✅ Leaving the amount blank means "refilled to field capacity" — the water-deficit figure must reset to 0 and the verdict must change.
✅ Log it a second time → the result must **not** change. The calculation is replay-safe.

### 12.4 Logout / re-login
`/settings` → **Log out** → log back in with the same credentials.

✅ Your farm, crops and scan history are all still there.

---

## 13. Hindi and Voice

### 13.1 Hindi
Use the language toggle in the header. Switch to **हिंदी**.

**Expected:** navigation, form labels, buttons, validation messages, freshness labels, irrigation verdicts, weather risk titles, the fertilizer disclaimer and severity bands all render in Devanagari.

✅ **Layout is left-to-right.** Hindi is not a right-to-left language — do not expect mirrored layout.
✅ **Crop and commodity names localize everywhere**: crop picker, crop cards, market rows and dropdown, community alerts. `Onion` must read `प्याज` — a raw `ONION` code anywhere is a regression.
✅ Reload the page: the language survives. Log out and back in on the same browser: still Hindi (the device's choice wins; a fresh device adopts the account's registration language).
✅ On a crop-health result, the *disease name* may still appear in **English with a visible "Hindi name not yet verified" label**, while the surrounding advice is in Hindi. **This is deliberate and correct** — no official Hindi source has been published for those names, so the app refuses to invent one.

> **Do not edit any Hindi string.** Record concerns in §14.

### 13.2 Voice
**URL:** `/settings` — the voice panel exists **only here**.

Use **Chrome or Edge**. Click **Speak**, allow the microphone, and say: **"mandi price"**

**Expected:** the panel echoes what it heard and navigates to `/market`.

Supported phrases only: home/dashboard, water/irrigate, weather/rain, market/price/mandi, scan/photo/disease — and their Hindi equivalents (मंडी, भाव, मौसम, सिंचाई, फोटो).

⚠️ **"Which crop should I grow?" is NOT a supported voice command.** It will correctly say it did not understand. That is not a bug.
⚠️ In Firefox the panel shows an unsupported message and the buttons still work. Correct.

**Read-aloud:** click a 🔊 button on a dashboard or result card.
⚠️ Hindi read-aloud needs a `hi-IN` voice installed in Windows. If absent, it degrades gracefully. Not a bug.

---

## 14. Error, Empty and Failure States

| # | Test | Action | Expected |
| --- | --- | --- | --- |
| 1 | Wrong password | Log out, log in with a wrong password | Generic failure message. **Must not** reveal whether the email exists |
| 2 | Short password | Register with a 5-character password | Inline "at least 8 characters" |
| 3 | Outside India | Farm form: latitude `51.5`, longitude `-0.12` | "Outside India" validation error |
| 4 | Half a coordinate | Enter latitude, clear longitude | The missing field is flagged required |
| 5 | GPS denied | Farm form → **Use GPS** → **Block** | Friendly message; manual fields remain usable |
| 6 | Not an image | Rename a `.txt` to `.jpg`, upload it | Rejected. Rejection is by file content, not extension |
| 7 | Oversized image | Upload a file larger than 8 MB | Rejected |
| 8 | Rate limit | 4 analyses inside one minute | The 4th is throttled |
| 9 | Empty market | Select **Cotton** on `/market` | Clean empty state, **no invented prices** |
| 10 | Someone else's farm | Note a farm id, register a second account, open `/farms/<that-id>` | **404** — not 403 |
| 10b | Someone else's crop | As the second account, open `/crops/<a-crop-id-from-the-first>` | **404** |
| 10c | Someone else's scan | As the second account, open `/health/<a-log-id-from-the-first>` | **404** |
| 11 | Backend down | Stop Terminal B, click around | Error states with a **Retry** button; no blank screen |
| 12 | Offline | DevTools → Network → **Offline**, then reload | "Could not reach the server. Check your connection" + Retry. On a page with cached data: data shown with an **offline** banner |

✅ For every failure above: no stack trace, no file path, no API key, no database string is ever shown to the user.

---

## 15. Deletion and Cleanup Verification

Do this **last** — it destroys the data you created.

1. Go to the farm page → **Delete farm** → confirm.

**Expected:** returns to the farms list, which is now empty.

✅ The crops are gone.
✅ `/history` shows no scans.
✅ **Critical:** the Cloudinary image URL you opened in Step 10.1 — the asset is removed from the account. Verify with:
```bash
cd U:\Projects\HackInMotion-RICR-HIM-1096\backend
node --env-file=.env -e "const{createRequire}=require('module');const r=createRequire('./package.json');const{v2:c}=r('cloudinary');c.config({secure:true});c.api.resources({type:'upload',prefix:'him1096/development',max_results:100}).then(x=>console.log('assets remaining:',x.resources.length))"
```
Expected output: `assets remaining: 0`

> The delivery URL may still serve the image briefly afterwards — that is Cloudinary's CDN edge cache, not the account. The command above is the authoritative check.

⚠️ Assets remaining > 0 after deleting every farm is a **storage-leak and privacy bug**. Report it immediately.

---

## 16. Hindi Content Concerns — record here, do not fix

| File | Key | Current Hindi | Your concern |
| --- | --- | --- | --- |
| | | | |

Hand this table to a Hindi-literate reviewer. **Do not edit the JSON files.**

---

## 17. Reset for another run

```bash
cd U:\Projects\HackInMotion-RICR-HIM-1096\backend
npm run seed:dev          # recreates the standard demo account
npm run seed:dev -- --reset   # wipes that demo account first, then recreates
```

Your manually-created account is separate and is not touched by these commands.

> **Before any Playwright E2E run, use the `--reset` form** (then `weatherRefresh` + `feedRefresh`). The suite's ack tests permanently acknowledge the demo feed, the feed dedup key is per-day, and the plain seed keeps the same user id — so without `--reset` a same-day re-run starts with an empty feed and fails everything feed-dependent. Also leave the login route quiet for 15 minutes beforehand: the suite budgets four of the limiter's five logins per window.
