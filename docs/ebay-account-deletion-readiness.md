# SHUKCHIC / eBay Production deletion-notification activation

Status as of 2026-10-28: **NOT READY FOR EBAY REGISTRATION**. The outage/failure-alert email has been entered in the eBay Developer portal. Production keyset is disabled until eBay verifies the endpoint. Do not submit the endpoint URL/token until backend and user-data deletion are operational.

## URL and secret
- Intended HTTPS endpoint: `https://restyle-web-staging.up.railway.app/api/ebay/account-deletion`
- `EBAY_DELETION_VERIFICATION_TOKEN` and `EBAY_DELETION_ENDPOINT` are configured privately in the Railway staging service. Do not print token in logs or GitHub.
- Code for GET challengeResponse (`SHA256(challenge_code + verification_token + exact_endpoint_URL)`) is committed.
- POST handler is **fail-closed (HTTP 503)** until eBay ECC signature verification and actual account-deletion handling exist. It must never return 2xx just because a request was received.

## Hard launch gates
- [ ] Restore GitHub → Railway deploys. The latest active Railway build was commit `232760a782`; newer code has not deployed. Railway previously returned: `Deploys have been paused temporarily`. Check provider incident/limited access. Do not attempt OAuth against routes that aren't live.
- [ ] Implement ECC signature validation using eBay's official Event Notification Node.js SDK or validated equivalent. Fetch eBay public key by keyId using application-credential OAuth; reject forged/expired/invalid signatures and fail closed when unavailable.
- [ ] Map actual eBay identifiers (buyer userId, EIAS) to future stored eBay user/transaction records. When a verified request arrives, delete or irreversibly anonymize the user's eBay-sourced personal data, including exports and cached copies, subject only to demonstrable legal retention requirements. Keep an audit receipt that contains no PII.
- [ ] Add tests: eBay sample signed notification and invalid signature; duplicate idempotency, retry behavior, deletion effect, account mapping, retention exceptions, server restart, database persistence, and zero raw PII leakage into logs.
- [ ] Confirm the live `GET` endpoint returns HTTP 200 and proper hexadecimal challengeResponse using the same token configured in Railway and eBay. Confirm `POST` handles signed eBay test notification end-to-end.
- [ ] Only then enter the endpoint and token under Production → Marketplace Account Deletion and click Save / Send Test Notification. Confirm eBay keyset is enabled.
- [ ] Only after compliance verification connect seller through OAuth and start importing real user, order, fulfillment, or financial data.
- [ ] Before attaching shukchic.com, keep the temporary callback URL unchanged while subscribed; update endpoint in eBay and reverify if hostname changes.

Official documentation: https://developer.ebay.com/develop/guides/sell/marketplace-user-account-deletion
Official Node SDK: https://github.com/eBay/event-notification-nodejs-sdk
Railway documentation (temporary deploy pauses): https://docs.railway.com/deployments/reference
