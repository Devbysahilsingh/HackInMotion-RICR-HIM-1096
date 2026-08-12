# Web Deployment (Vercel)

Build: `cd web/frontend && npm ci && npm run build` (Vite → dist/); Vercel project root `web/frontend`; SPA rewrite all→/index.html; env `VITE_API_URL=https://<render-backend>/api/v1`.
Headers (vercel.json): CSP (self + api origin connect-src + cloudinary img-src), X-Content-Type-Options, Referrer-Policy, Permissions-Policy (camera=(), geolocation=(self), microphone=(self) — web STT/GPS).
Flow: PR → preview URL (review aid) → merge main → prod. Domain: default vercel.app subdomain (custom domain out of scope). Checks post-deploy: smoke journey, bundle has no secrets (grep dist), lighthouse record.
