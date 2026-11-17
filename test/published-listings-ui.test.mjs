import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('Published Listings has its own entry and does not include queued drafts',()=>{
 const html=read('public/admin.html');
 const ui=read('public/assets/approved-listings.js');
 assert.match(html,/id="showPublishedListings"/);
 assert.match(html,/id="publishedListingsCount"/);
 assert.match(ui,/list\.filter\(x=>x\.ebay_offer_state==='LIVE'\)/);
 assert.match(ui,/list\.filter\(x=>x\.ebay_offer_state!=='LIVE'\)/);
 assert.match(ui,/listingView='published';await load\(\)/);
 assert.match(ui,/View on eBay/);
 assert.match(ui,/eBay #/);
 assert.doesNotThrow(()=>new Script(ui,{filename:'approved-listings.js'}));
});

test('Listing route returns the saved eBay publication timestamp and ID',()=>{
 const source=read('server.mjs');
 assert.match(source,/p\.listing_id,p\.updated_at AS ebay_published_at/);
 assert.match(source,/p\.state AS ebay_offer_state/);
});

test('Financial display avoids implying processed transactions are finalized payouts',()=>{
 const html=read('public/assets/admin.js');
 const server=read('server.mjs');
 assert.match(html,/Recorded credits/);
 assert.match(html,/Provisional activity balance/);
 assert.match(html,/Funds may still be processing/);
 assert.doesNotMatch(html,/Money received/);
 assert.match(html,/Detailed eBay earnings are not authorized/);
 assert.match(server,/permissionRequired:response\.status===403/);
 assert.match(server,/item\.orderEarningsSummary/);
 assert.match(server,/summary\.orderEarnings/);
});
