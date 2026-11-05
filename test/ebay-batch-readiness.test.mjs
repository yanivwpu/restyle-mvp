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
test('incorrect precious-metal and marketing claims are flagged; plain color description is safe',()=>{
 const plain=evaluateListingForBatch({item,draft,photos:[{id:'photo'}]});
 assert.equal(plain.localReady,true);
 const misleading=evaluateListingForBatch({item,draft:{...draft,description:'Made of white gold with gold accents. High-quality materials and fine craftsmanship.'},photos:[{id:'photo'}]});
 assert.equal(misleading.localReady,false);
 assert.ok(misleading.blockers.some(x=>x.includes('white-gold')));
 assert.ok(misleading.blockers.some(x=>x.includes('quality/craftsmanship')));
});
test('missing verified warehouse, category, photographs, price, and duplicate SKU all block batch',()=>{
 const row=evaluateListingForBatch({item:{...item,received_verified:0},draft:{...draft,status:'DRAFT',category_id:'',price_cents:0},photos:[],duplicateSku:true});
 assert.equal(row.localReady,false);
 assert.ok(row.blockers.length>=5);
});
