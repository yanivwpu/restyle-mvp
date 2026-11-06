import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createEbayUnpublishedOffers} from '../ebay-unpublished-offers.mjs';

const item={id:'RS-A1B2C3D4E5',sku:'001',bin_location:'A1',received_verified:1,brand:'Aurelie Bidermann',condition:'New without tags'};
const draft={status:'REVIEWED',title:'Aurelie Bidermann Ear Cuff',description:'White with gold accent, new without tags.',price_cents:4500,category_id:'50647',verifiedFacts:{color:'White and Gold',category:'Ear Cuff'}};
const photos=[{id:'12345678-1234-1234-1234-123456789abc',source:'warehouse'}];
const settings={merchantLocationKey:'FL-WAREHOUSE',policies:{paymentPolicyId:'11',fulfillmentPolicyId:'22',returnPolicyId:'33'},parcel:{weightLb:0.3,lengthIn:6,widthIn:4,heightIn:3}};
function response(status,data={}){return {status,ok:status>=200&&status<300,json:async()=>data,headers:{get:()=>null}};}
function fixture({enabled=true,failOffer=false,publishEnabled=false,failPublish=false,existingInventory=false,inventoryReadError=false,collectionError=false,collectionHasSku=false}={}){
 const db=new DatabaseSync(':memory:');const calls=[];
 const fetcher=async(url,opt={})=>{
  calls.push({url,method:opt.method||'GET',headers:opt.headers||{}});
  if(url.includes('payment_policy'))return response(200,{paymentPolicies:[{paymentPolicyId:'11'}]});
  if(url.includes('fulfillment_policy'))return response(200,{fulfillmentPolicies:[{fulfillmentPolicyId:'22'}]});
  if(url.includes('return_policy'))return response(200,{returnPolicies:[{returnPolicyId:'33'}]});
  if(url.includes('/location?'))return response(200,{locations:[{merchantLocationKey:'FL-WAREHOUSE'}]});
  if(url.includes('/offer?sku='))return response(200,{offers:[]});
  if(url.includes('/inventory_item?')&&opt.method==='GET')return collectionError?response(400,{errors:[{errorId:25709,message:'Invalid limit'}]}):response(200,{total:collectionHasSku?1:0,inventoryItems:collectionHasSku?[{sku:'001'}]:[]});
  if(url.includes('/inventory_item/')&&opt.method==='GET')return inventoryReadError?response(400,{errors:[{errorId:25709,message:'Invalid value for SKU',parameters:[{name:'fieldName',value:'sku'}]}]}):existingInventory?response(200,{sku:'001'}):response(404);
  if(url.includes('/create_image_from_file'))return response(201,{imageUrl:'https://i.ebayimg.com/images/g/test/s-l500.jpg'});
  if(url.includes('/inventory_item/')&&opt.method==='PUT')return response(204);
  if(url.endsWith('/offer')&&opt.method==='POST')return failOffer?response(502,{errors:[{errorId:25101}]}):response(201,{offerId:'998877'});
  if(url.endsWith('/offer/998877')&&opt.method==='GET')return response(200,{sku:'001'});
  if(url.endsWith('/offer/998877/publish')&&opt.method==='POST')return failPublish?response(502,{errors:[{errorId:25704}]}):response(200,{listingId:'123456789012'});

  throw Error('Unexpected eBay route '+url);
 };
 const service=createEbayUnpublishedOffers({db,oauth:{getPublishingToken:async()=>'test-token-1234567890'},fetcher,
  loadPhoto:async()=>({bytes:Buffer.from([255,216,255]),mime:'image/jpeg'}),enabled:()=>enabled,publishEnabled:()=>publishEnabled,prepareAllowed:()=>true});
 return {db,calls,service};
}
test('offer preparation stays disabled by default and causes no eBay writes',async()=>{
 const x=fixture({enabled:false});
 await assert.rejects(x.service.prepare({item,draft,photos,settings}),e=>e.status===409);
 assert.equal(x.calls.length,0);x.db.close();
});
test('approved SKU creates one unpublished offer, saves ID, and cannot be silently recreated',async()=>{
 const x=fixture();
 const result=await x.service.prepare({item,draft,photos,settings});
 assert.equal(result.state,'PREPARED');assert.equal(result.offerId,'998877');assert.equal(result.listingId,null);
 assert.equal(x.calls.filter(y=>y.method==='PUT').length,1);
 assert.equal(x.calls.filter(y=>y.method==='POST'&&y.url.endsWith('/offer')).length,1);
 const count=x.calls.length;
 await assert.rejects(x.service.prepare({item,draft,photos,settings}),e=>e.status===409);
 assert.equal(x.calls.length,count);x.db.close();
});
test('failed eBay offer creation quarantines item and never retries blindly',async()=>{
 const x=fixture({failOffer:true});
 await assert.rejects(x.service.prepare({item,draft,photos,settings}),e=>e.status===502);
 assert.equal(x.service.get(item.id).requiresReconciliation,true);
 const count=x.calls.length;
 await assert.rejects(x.service.prepare({item,draft,photos,settings}),e=>e.status===409);
 assert.equal(x.calls.length,count);x.db.close();
});
test('staff approved wording is not rejected; missing parcel dimensions still block remote writes',async()=>{
 const x=fixture();
 await assert.rejects(x.service.prepare({item,draft:{...draft,description:'Crafted from white gold.'},photos,settings:{...settings,parcel:{}}}),e=>e.status===400);
 assert.equal(x.calls.length,0);
 const result=await x.service.prepare({item,draft:{...draft,description:'Crafted from white gold.'},photos,settings});
 assert.equal(result.state,'PREPARED');x.db.close();
});

test('missing inventory does not query getOffers with an unknown SKU',async()=>{
 const x=fixture();const result=await x.service.prepare({item,draft,photos,settings});
 assert.equal(result.state,'PREPARED');
 assert.equal(x.calls.some(c=>c.url.includes('/offer?sku=')),false);
 assert.equal(x.calls.some(c=>c.url.includes('/inventory_item/001')&&c.method==='GET'),true);
 x.db.close();
});
test('a known prior 25709 offer lookup failure can be recovered without duplicate writes',async()=>{
 const x=fixture();
 const now=new Date().toISOString();
 x.db.prepare("INSERT INTO ebay_offer_preparations(submission_id,sku,state,last_error,created_at,updated_at) VALUES (?,?,'UNKNOWN',?,?,?)")
 .run(item.id,item.sku,'Existing offer lookup rejected by eBay (HTTP 400; codes 25709). Check the account and listing settings.',now,now);
 const result=await x.service.prepare({item,draft,photos,settings});
 assert.equal(result.state,'PREPARED');
 assert.equal(x.calls.filter(c=>c.method==='POST'&&c.url.endsWith('/offer')).length,1);
 x.db.close();
});
test('existing inventory blocks write and remains quarantined',async()=>{
 const x=fixture({existingInventory:true});
 await assert.rejects(x.service.prepare({item,draft,photos,settings}),e=>e.status===409);
 assert.equal(x.service.get(item.id).state,'BLOCKED_READ_ONLY');
 assert.equal(x.calls.filter(c=>c.method==='PUT').length,0);
 x.db.close();
});
test('25709 single-SKU error falls back to complete read-only inventory collection',async()=>{
 const x=fixture({inventoryReadError:true});
 const result=await x.service.prepare({item,draft,photos,settings});
 assert.equal(result.state,'PREPARED');
 assert.equal(x.calls.some(c=>c.url.includes('/inventory_item?limit=100&offset=0')),true);
 x.db.close();
});
test('25709 fallback blocks any existing SKU or incomplete inventory lookup',async()=>{
 const a=fixture({inventoryReadError:true,collectionHasSku:true});
 await assert.rejects(a.service.prepare({item,draft,photos,settings}),e=>e.status===409);
 assert.equal(a.service.get(item.id).state,'BLOCKED_READ_ONLY');
 assert.equal(a.calls.some(c=>c.method==='PUT'),false);a.db.close();
 const b=fixture({inventoryReadError:true,collectionError:true});
 await assert.rejects(b.service.prepare({item,draft,photos,settings}),e=>e.status===502&&e.message.includes('Invalid limit'));
 assert.equal(b.service.get(item.id).state,'BLOCKED_READ_ONLY');
 assert.equal(b.calls.some(c=>c.method==='PUT'),false);b.db.close();
});
test('known read-only 25709 inventory failure is recovered after code fix',async()=>{
 const x=fixture({inventoryReadError:true});
 const stamp=new Date().toISOString();
 x.db.prepare("INSERT INTO ebay_offer_preparations(submission_id,sku,state,last_error,created_at,updated_at) VALUES (?,?,'BLOCKED_READ_ONLY',?,?,?)")
  .run(item.id,item.sku,'Existing inventory lookup rejected by eBay (HTTP 400; codes 25709). Check the account and listing settings.',stamp,stamp);
 const prepared=await x.service.prepare({item,draft,photos,settings});
 assert.equal(prepared.state,'PREPARED');x.db.close();
});
test('live publication is disabled by default even after offer preparation',async()=>{
 const x=fixture();await x.service.prepare({item,draft,photos,settings});
 await assert.rejects(x.service.publish({item,draft,photos,confirmation:'PUBLISH_SELECTED_TO_EBAY'}),e=>e.status===409);
 assert.equal(x.service.get(item.id).state,'PREPARED');x.db.close();
});
test('explicit SKU-allowlisted publication stores listing ID exactly once',async()=>{
 const original=process.env.SHUKCHIC_EBAY_PUBLISH_ALLOWLIST;
 process.env.SHUKCHIC_EBAY_PUBLISH_ALLOWLIST='001';
 try{
  const x=fixture({publishEnabled:true});
  await x.service.prepare({item,draft,photos,settings});
  await assert.rejects(x.service.publish({item,draft,photos,confirmation:'WRONG'}),e=>e.status===400);
  const published=await x.service.publish({item,draft,photos,confirmation:'PUBLISH_SELECTED_TO_EBAY'});
  assert.equal(published.state,'LIVE');assert.equal(published.listingId,'123456789012');
  assert.equal(x.calls.filter(y=>y.url.endsWith('/publish')).length,1);
  await assert.rejects(x.service.publish({item,draft,photos,confirmation:'PUBLISH_SELECTED_TO_EBAY'}),e=>e.status===409);
  assert.equal(x.calls.filter(y=>y.url.endsWith('/publish')).length,1);x.db.close();
 }finally{if(original===undefined)delete process.env.SHUKCHIC_EBAY_PUBLISH_ALLOWLIST;else process.env.SHUKCHIC_EBAY_PUBLISH_ALLOWLIST=original;}
});
test('changed approved listing after preparation blocks live publishing',async()=>{
 const original=process.env.SHUKCHIC_EBAY_PUBLISH_ALLOWLIST;process.env.SHUKCHIC_EBAY_PUBLISH_ALLOWLIST='001';
 try{
  const x=fixture({publishEnabled:true});await x.service.prepare({item,draft,photos,settings});
  await assert.rejects(x.service.publish({item,draft:{...draft,price_cents:4600},photos,confirmation:'PUBLISH_SELECTED_TO_EBAY'}),e=>e.status===409);
  assert.equal(x.service.get(item.id).state,'PREPARED');x.db.close();
 }finally{if(original===undefined)delete process.env.SHUKCHIC_EBAY_PUBLISH_ALLOWLIST;else process.env.SHUKCHIC_EBAY_PUBLISH_ALLOWLIST=original;}
});
test('ambiguous eBay live publish response quarantines offer, never retries automatically',async()=>{
 const original=process.env.SHUKCHIC_EBAY_PUBLISH_ALLOWLIST;process.env.SHUKCHIC_EBAY_PUBLISH_ALLOWLIST='001';
 try{
  const x=fixture({publishEnabled:true,failPublish:true});await x.service.prepare({item,draft,photos,settings});
  await assert.rejects(x.service.publish({item,draft,photos,confirmation:'PUBLISH_SELECTED_TO_EBAY'}),e=>e.status===502);
  assert.equal(x.service.get(item.id).state,'UNKNOWN');
  const count=x.calls.filter(y=>y.url.endsWith('/publish')).length;
  await assert.rejects(x.service.publish({item,draft,photos,confirmation:'PUBLISH_SELECTED_TO_EBAY'}),e=>e.status===409);
  assert.equal(x.calls.filter(y=>y.url.endsWith('/publish')).length,count);x.db.close();
 }finally{if(original===undefined)delete process.env.SHUKCHIC_EBAY_PUBLISH_ALLOWLIST;else process.env.SHUKCHIC_EBAY_PUBLISH_ALLOWLIST=original;}
});

test('startup recovers only known pre-write 25709 failures; uncertain writes remain quarantined',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE ebay_offer_preparations (submission_id TEXT PRIMARY KEY,sku TEXT NOT NULL UNIQUE,state TEXT NOT NULL,offer_id TEXT,listing_id TEXT,policy_json TEXT NOT NULL DEFAULT '{}',source_hash TEXT NOT NULL DEFAULT '',last_error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
 const add=db.prepare("INSERT INTO ebay_offer_preparations(submission_id,sku,state,offer_id,last_error,created_at,updated_at) VALUES (?,?, 'UNKNOWN', ?, ?, ?, ?)");
 const stamp=new Date().toISOString();
 add.run('RS-A1B2C3D4E5','001',null,'Existing offer lookup rejected by eBay (HTTP 400; codes 25709). Check the account and listing settings.',stamp,stamp);
 add.run('RS-1111111111','002',null,'eBay offer creation rejected by eBay (HTTP 400; codes 25709).',stamp,stamp);
 add.run('RS-2222222222','003','998877','Existing offer lookup rejected by eBay (HTTP 400; codes 25709).',stamp,stamp);
 const service=createEbayUnpublishedOffers({db,oauth:{getPublishingToken:async()=> 'test-token'},loadPhoto:async()=>null});
 assert.equal(service.get('RS-A1B2C3D4E5').state,'NOT_PREPARED');
 assert.equal(service.get('RS-1111111111').state,'UNKNOWN');
 assert.equal(service.get('RS-2222222222').state,'UNKNOWN');
 db.close();
});

test('eBay Inventory requests send explicit supported US Accept-Language, not fetch default',async()=>{
 const x=fixture({inventoryReadError:true});
 const prepared=await x.service.prepare({item,draft,photos,settings});
 assert.equal(prepared.state,'PREPARED');
 for(const call of x.calls.filter(c=>c.url.startsWith('https://api.ebay.com/sell/inventory/'))){
  assert.equal(call.headers['Accept-Language'],'en-US');
 }
 assert.ok(x.calls.some(c=>c.url.includes('/inventory_item?limit=100&offset=0')));
 x.db.close();
});
test('only an old blocked read-only Accept-Language rejection is recovered, never an uncertain write',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE ebay_offer_preparations (submission_id TEXT PRIMARY KEY,sku TEXT NOT NULL UNIQUE,state TEXT NOT NULL,offer_id TEXT,listing_id TEXT,policy_json TEXT NOT NULL DEFAULT '{}',source_hash TEXT NOT NULL DEFAULT '',last_error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
 const add=db.prepare("INSERT INTO ebay_offer_preparations(submission_id,sku,state,offer_id,last_error,created_at,updated_at) VALUES (?,?, ?, ?, ?, ?, ?)");
 const t=new Date().toISOString(),error='Inventory collection fallback rejected by eBay (HTTP 400; codes 25709): Invalid value for header Accept-Language.';
 add.run('RS-A1B2C3D4E5','001','BLOCKED_READ_ONLY',null,error,t,t);
 add.run('RS-1111111111','002','UNKNOWN',null,error,t,t);
 add.run('RS-2222222222','003','BLOCKED_READ_ONLY','offer123',error,t,t);
 const svc=createEbayUnpublishedOffers({db,oauth:{getPublishingToken:async()=>'test-token'},loadPhoto:async()=>null});
 assert.equal(svc.get('RS-A1B2C3D4E5').state,'NOT_PREPARED');
 assert.equal(svc.get('RS-1111111111').state,'UNKNOWN');
 assert.equal(svc.get('RS-2222222222').state,'BLOCKED_READ_ONLY');
 db.close();
});
