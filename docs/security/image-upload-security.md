# Image Upload Security

Attack surface ranked highest among inputs (binary parsing + external storage + AI forwarding).

## Pipeline (every upload, no exceptions)
1. **Transport caps:** multipart only on the two upload routes; hard size limit 8MB (multer limits + reverse-proxy limit); single file; field allowlist.
2. **Identity checks:** ignore client filename/Content-Type entirely for decisions; **magic-byte sniff** (file-type) ∈ {jpeg, png, webp, heic}; extension irrelevant (we assign our own).
3. **Bomb guards:** header-parsed dimensions ≤6000×6000 AND megapixels ≤36 BEFORE full decode (sharp `limitInputPixels`); animated formats rejected.
4. **Decode + re-encode:** sharp → decode (failure = reject) → auto-orient → strip ALL metadata (EXIF GPS = privacy leak) → re-encode JPEG q85 max 1600px long edge. **Re-encoding is the polyglot killer** — embedded PHP/JS/zip payloads do not survive pixel-level re-encode.
5. **Naming/storage:** random UUID name; Cloudinary upload (authenticated API, unsigned uploads disabled); folder per env; original bytes discarded; only re-encoded asset persists. Local disk: temp file in isolated tmp dir, deleted in finally-block.
6. **Access:** URLs delivered only through ownership-checked endpoints (AU-5).
7. **Abuse:** 3/min burst + 10/day/user + per-IP layer; repeated rejects audited (`upload_rejected`).
8. **Downstream:** ml-service + Gemini receive the SANITIZED re-encoded image only.

## Failure UX
Reason-classed messages (too large / not an image / unclear photo) localized; never a blank failure; retry guidance. Tests: polyglot fixture (JPEG+ZIP), decompression bomb PNG, 9MB file, .exe renamed .jpg, EXIF-GPS image (assert stripped output), HEIC path, corrupt truncated JPEG — all in security-testing.md ST-30 suite.
