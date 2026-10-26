# RESTYLE search and eBay-branding plan

Status: staging implementation — domain and production launch pending.

## Marketplace disclosure
- Explain in plain text that RESTYLE's initial marketplace is eBay and that accepted items are listed through a designated seller account.
- RESTYLE is an independent consignment service, not sponsored, affiliated with or endorsed by eBay.
- The **Shop Now** button opens the public eBay seller's inventory while keeping the button label RESTYLE-controlled. Do **not** use the eBay logo as the button or hyperlink.
- eBay's official trademark guidance allows nominative text references (for example, "I sell on eBay") but requires express written authorization to use its logo and prohibits implying an official partnership. Policy: https://www.ebay.com/help/policies/member-behavior-policies/ebays-intellectual-property-policy?id=4261

## Customer-facing pages implemented
- How It Works, step 4: discloses the resale marketplace.
- Why RESTYLE: mentions how the seller account handles listings and fulfillment.
- FAQ: explains where items are sold and independent relationship.
- Footer: avoids confusing buyers about any affiliation.
- Pilot consignment agreement: discloses eBay venue, authorization, applicable selling fees, account holder's seller obligations and no endorsement.
- Approval signing email: describes proposed resale channel.

## SEO metadata implemented
- Title: RESTYLE | Designer Fashion Consignment & Resale
- Description: Consign pre-loved designer handbags, clothing and accessories with RESTYLE. Submit photos for a free review; we manage approved resale listings on eBay.
- Social-sharing previews use matching Open Graph and Twitter text.
- No eBay logo and no keyword-stuffing. Google Search **ignores** the legacy `meta keywords` tag. Source: https://developers.google.com/search/docs/fundamentals/seo-starter-guide

## Suggested content topics when the production domain is ready
1. How to consign pre-loved designer handbags
2. Selling designer clothing on eBay using a consignment service
3. How resale commissions work: gross price, net proceeds and payouts
4. Preparing designer accessories for consignment photography
5. Designer consignment in South Florida (only if local service eligibility and operational coverage are confirmed)

These are editorial targets, not a guarantee of rankings.

## Production-domain launch gates
- Purchase and connect a brand-owned RESTYLE domain; avoid eBay or other trademark names in the domain.
- Configure a canonical production homepage URL and appropriate metadata for each distinct public page; currently routes share a lightweight SPA HTML shell.
- Leave the Railway staging domain with `X-Robots-Tag: noindex, nofollow`. Remove this only if staging is intentionally promoted to the brand-owned public production environment.
- Use properly licensed website photos before promotional sharing; add appropriately licensed `og:image` at that time.
- After public production launch: connect Search Console, submit a sitemap of actual public pages, assess structured data and monitor search queries.
- Do not turn on indexing or encourage real consignor shipping while the app remains a pilot, agreement terms remain legally unreviewed or photo usage rights are unconfirmed.
