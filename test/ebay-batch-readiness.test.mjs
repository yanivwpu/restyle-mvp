import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateListingForBatch} from '../ebay-batch-readiness.mjs';
const item={id:'RS-A1B2C3D4E5',sku:'001',bin_location:'A1',received_verified:1};
const draft={status:'REVIEWED',title:'Aurelie Bidermann Ear Cuff',description:'White with gold accent, new without tags.',price_cents:4500,category_id:'50647',verifiedFacts:{color:'White and Gold'}};
test('reviewed, physically received listing passes local checks but never enables publishing',()=>{
 const row=evaluateListingForBatch({item,draft,photos:[{id:'photo'}]});
 assert.equal(row.localReady,true);
 assert.equal(row.livePublishEnabled,false);
 assert.equal(row.ebayOfferPrepared,false);
});
test('staff reviewed description is accepted without AI phrasing heuristics',()=>{
 const approved=evaluateListingForBatch({item,draft:{...draft,description:'White gold accents. High-quality materials and fine craftsmanship.'},photos:[{id:'photo'}]});
 assert.equal(approved.localReady,true);
 assert.deepEqual(approved.blockers,[]);
});
test('unreviewed description is still blocked by staff review requirement',()=>{
 const pending=evaluateListingForBatch({item,draft:{...draft,status:'DRAFT',description:'High-quality materials.'},photos:[{id:'photo'}]});
 assert.equal(pending.localReady,false);
 assert.ok(pending.blockers.includes('Staff review required'));
});
test('missing verified warehouse, category, photographs, price, and duplicate SKU all block batch',()=>{
 const row=evaluateListingForBatch({item:{...item,received_verified:0},draft:{...draft,status:'DRAFT',category_id:'',price_cents:0},photos:[],duplicateSku:true});
 assert.equal(row.localReady,false);
 assert.ok(row.blockers.length>=5);
});
