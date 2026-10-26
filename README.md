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

## eBay listing assistant — staging foundation (October 2026)

Inside **Admin → item detail**, staff can prepare an internal eBay listing draft after the customer's agreement is signed and the item's warehouse receipt, SKU and storage bin are verified.

- Staff enter verified size, color, material, measurements, wear/flaws and other facts. A confirmation checkbox is required before draft generation.
- **Create starter draft** is a local template, not AI and not a live eBay listing.
- **Generate AI draft** uses the real OpenAI Responses API with structured JSON when `OPENAI_API_KEY` is present in Railway. Optional `RESTYLE_AI_MODEL` defaults to `gpt-4.1-mini`. Only warehouse-confirmed product details are sent; photos or consignor contact data are **not transmitted** to the AI provider in this phase. Generation is disabled when unconfigured.
- Staff can edit title, plain-text description, asking price, category suggestion and numeric category ID. The local category ID is **not automatically validated against eBay yet**.
- **Mark staff-reviewed** only changes the private draft record. No eBay seller token, no eBay GraphQL integration and **no eBay publishing endpoint** exist in this stage.
- Phase B will connect the seller's eBay account using OAuth, upload warehouse photographs (after authorization), add Inventory Mapping AI suggestions, verify Taxonomy required aspects, and test unpublished offers in the Sandbox.
- Phase C can add an authenticated explicit Publish action after validating seller business policies, inventory location, photo rights and the fulfillment/inventory gates. The production API must guard against duplicate SKU/offer publication.

Track implementation at [eBay AI Listing Engine issue #2](https://github.com/yanivwpu/restyle-mvp/issues/2).

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
4. Configure environment variables securely on Railway: `NODE_ENV=production`, `ADMIN_PASSWORD` (minimum 5 characters in Railway `staging` only; 14+ in other production environments), `SESSION_SECRET` (32+ characters), `DATA_DIR=/data`, `COOKIE_SECURE=true`, `PUBLIC_BASE_URL=https://<generated-domain>`, and verified email settings. The app refuses to start without the configured minimum and a strong session secret. Five-character passwords are allowed only for the private staging pilot and are **not recommended for a public launch**. Login attempts are limited to 6 per 15 minutes per observed client IP, in memory.
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

## Transactional email + e-sign pilot flow

1. The customer submits photos. RESTYLE queues a confirmation email and a staff alert (when `ADMIN_NOTIFY_EMAIL` is configured). Delivery requires `RESEND_API_KEY` and verified `EMAIL_FROM`. Email sends are tracked in the admin outbox; `SENT` means accepted by Resend, **not** guaranteed delivered.
2. Wife selects **ACCEPTED**. If agreement settings are complete, RESTYLE creates a 14-day private signing link and queues an approval email. **No shipping address is revealed at this point.**
3. Customer opens the emailed link, reads the immutable per-item terms snapshot, enters their full legal name and matching email, consents to electronic records, expressly signs and submits. RESTYLE stores signature evidence, timestamps, IP/user-agent, a SHA-256 terms digest and signed PDF **on the same persistent volume** as the submission.
4. A signed-agreement confirmation and the separate shipping-instructions email are queued **after signing**, along with a staff notice. The admin submission detail offers an authenticated signed-PDF download. No physical shipment should be sent before receiving those instructions.
5. REJECTED sends a different customer email and invalidates unsigned signing links. RECEIVED is recordable, but listing/selling states require both an agreement and verified physical receipt.

Railway staging environment variables: `RESEND_API_KEY`, `EMAIL_FROM` (verified domain, e.g. `RESTYLE <reviews@your-domain.example>`), `ADMIN_NOTIFY_EMAIL`, `CONSIGNMENT_AGREEMENT_TEXT`, `CONSIGNMENT_SHIPPING_INSTRUCTIONS`, `AGREEMENT_PILOT_MODE=true` (test only). `AGREEMENT_LEGAL_APPROVED=true` is required outside pilot mode. **Do not use sample terms or fake shipping addresses with real customers.**

The first-party typed e-sign pilot is **not** a replacement for counsel-reviewed consignment terms or a specialized e-signature provider's stronger identity verification/audit trail. The customer link establishes email-link possession, not independently verified identity. For legal production use, confirm Florida law, retention requirements, identity protections, secondhand-dealer obligations, and provide true shipping details and fees. Back up `/data` since signatures and image records live there. Review privacy practices before external launch.
