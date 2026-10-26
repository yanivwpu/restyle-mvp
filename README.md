# RESTYLE — Consignment intake MVP

Independent, **working** mobile-first consignment lead intake and warehouse review application. Designed from the supplied RESTYLE Figma screenshot. Includes real image storage, SQLite records, authentication-protected admin dashboard, preliminary approvals, receipt verification gate, and transactional confirmation email integration.

## What's implemented

- RESTYLE customer-facing landing page with phone-friendly styling. The top-right **Shop Now** button opens eBay listings for seller `ssammikat99u2` in a new tab; the hero and bottom **Upload Your Item for Review** buttons open `/submit`. Confirm the eBay seller URL and the store identity before public launch.
- `/submit`: mobile camera/gallery upload, drag-and-drop, preview and removal; browser-side JPEG re-encoding to reduce filesize and strip normal EXIF metadata; up to six photos per item.
- Data collection: category, brand, condition, description, first name, email, optional phone, ownership statement and consent; required validation, honeypot, per-IP rate limit.
- **Durable local** SQLite data and private image files within `DATA_DIR`; do NOT deploy without a persistent storage volume.
- Automatic unique receipt references (`RS-XXXXXXXXXX`), confirmation email queue, optional staff notification; uses **Resend** when API key and sender identity are configured.
- `/admin`: password login with signed HttpOnly cookie; review queue, photos, status changes, internal notes, provisional price, tracking, SKU/bin and audit trail.
- Protection: cannot mark as ready to list / listed / sold without marking physical inventory received and verified.
- Confirmation and status emails for submit, accepted / needs-info / rejected. Retry action for pending emails.
- Preliminary privacy and submission terms. These **must be legally reviewed before public launch**.
- No eBay automation or direct seller payouts in this first MVP; no fake customer accounts.

## Run locally

Requires **Node.js 22.13+** (includes the built-in `node:sqlite` module). No NPM packages or API keys are needed for the demo/test server.

1. Extract the folder; open Terminal/PowerShell in the `restyle-mvp` directory.
2. Create your own strong credentials (do not reuse WhachatCRM secrets):

   **PowerShell:**

   ```powershell
   $env:ADMIN_PASSWORD = 'your-own-long-random-password'
   $env:SESSION_SECRET = 'replace-with-at-least-32-random-characters'
   $env:PORT = '3000'
   npm start
   ```

   **macOS/Linux:**

   ```bash
   ADMIN_PASSWORD='your-own-long-random-password' SESSION_SECRET='replace-with-at-least-32-random-characters' npm start
   ```

3. Open `http://localhost:3000/` for the site; `http://localhost:3000/submit` for customer photo submissions; `http://localhost:3000/admin` for private review.
4. All data persists under `./data` unless `DATA_DIR` is configured. This folder is excluded from Git.

**Tests:** `npm test` (uses Node's built-in test runner; no downloads). Tests cover saving a photo, email outbox pending, admin login, private images and physical receipt listing protection.

## Email confirmation setup

1. Set up a transactional sender with [Resend](https://resend.com), verify a domain you control and create an API key.
2. On your hosting service set:

   ```env
   RESEND_API_KEY=re_... # secret, never commit
   EMAIL_FROM=RESTYLE <hello@yourverifieddomain.com>
   ADMIN_NOTIFY_EMAIL=you@yourdomain.com
   PUBLIC_BASE_URL=https://your-restyle-domain.com
   ```

3. Test with your own email first. Only after `EMAIL_FROM` + `RESEND_API_KEY` are configured will the service actually call the email provider. Without them, submissions are still saved and messages are marked **SETUP_REQUIRED**, not SENT. Admin can use “Retry unsent emails” after credentials are configured. Failed provider calls are logged in the private email outbox.
4. Resend delivery, sender domain and DNS verification have **not** been performed as part of this packaged MVP.

## Deployment on Railway (recommended pilot route)

Use a **new RESTYLE GitHub repository and new Railway project**. Keep this totally separate from WhachatCRM/Shopify systems.

1. Push the extracted source into the new private GitHub repo.
2. On Railway create a new project from this GitHub repo (Railway should detect the root `package.json`). Run `npm start`.
3. **Attach persistent volume** to the service, mounted at `/data` and set `DATA_DIR=/data`. Otherwise photos and database can disappear when a container is replaced.
4. Configure environment variables securely on Railway: `NODE_ENV=production`, `ADMIN_PASSWORD` (14+ characters), `SESSION_SECRET` (32+ characters), `DATA_DIR=/data`, `COOKIE_SECURE=true`, `PUBLIC_BASE_URL=https://<generated-domain>`, and verified email settings. Production app **refuses to start** without strong admin credentials.
5. Generate HTTPS service domain. Verify `/api/health`, homepage, upload with a test item, `/admin` login, customer photo privacy (401 without staff login), and confirmation email delivery.
6. Protect admin credentials, back up the SQLite DB and private image files, configure monitoring and a documented retention/deletion policy. Keep the service unadvertised until these checks pass.

### Important scope and launch cautions

- This MVP is designed for a **small, single-operator pilot**, not a high-scale marketplace. SQLite/local volume is fine for one instance; upgrading to managed Postgres + object storage is appropriate when moving to multiple replicas.
- Client-side resizing strips usual image metadata in modern browsers; server-side APIs accept real supported image bytes and apply size/signature checks. For adversarial public traffic, add server-side image decoding and malware scanning, plus a CAPTCHA such as Cloudflare Turnstile and request-rate controls beyond per-IP memory limits.
- If behind a trusted proxy, you may configure `TRUST_PROXY=true` to use the first trusted forwarded client IP for rate limiting. Otherwise leave `false`.
- Before publishing: review Florida consignment / secondhand dealer requirements, written consignment agreements, authenticity checks, insured shipping, customer notices, privacy policy, storage retention, and payout procedures with qualified professionals.
- The **hero image is cropped from the user-provided Figma screenshot** for visual fidelity; verify you have rights to the original image and template before publishing commercially. Replace with properly licensed product photography if needed.
- This code is an independent implementation inspired by the screenshot, **not a live synchronization or direct edit of the user's Figma document**.
- A separate contract, pricing structure, marketplace integration, and payout ledger should be added only after a validated pilot.
