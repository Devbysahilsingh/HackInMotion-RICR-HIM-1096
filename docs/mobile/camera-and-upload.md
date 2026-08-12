# Camera & Upload Workflow (hero flow)

```
Scan tab → crop pick (auto if single) →
permission check → granted: expo-camera full-screen (capture guidance overlay:
  "फोटो पत्ती के पास से लें" / fill frame, steady, natural light) | denied: gallery-only + settings hint
capture/gallery → preview (retake/confirm) →
expo-image-manipulator: resize ≤1600px, JPEG q85 (typ. 3–8MB → 200–500KB: low-bandwidth requirement) →
upload multipart + progress bar → Analyzing (staged honest copy) →
Result | failure: reason-classed retry (network → retry keeps image in memory; validation → guidance)
```
Details: permissions requested in-context with plain-language rationale (localized), never on app launch; camera settings: autofocus, rear camera default; EXIF stripped server-side regardless (client strip too via manipulator output); gallery path validates type client-side for UX (server remains authority); upload cancellation supported; low-storage/photo-too-dark edge messages designed. Result caching: analysis response cached by log id (offline re-view). Security: nothing persisted outside app sandbox; drafts (P3) in app-private storage.
