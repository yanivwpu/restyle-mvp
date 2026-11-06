import crypto from 'node:crypto';
import {evaluateListingForBatch} from './ebay-batch-readiness.mjs';

// Explicitly guarded, one-off unpublished offer preparation.
// A failed or interrupted write is quarantined for reconciliation rather than retried blindly.
const fail=(status,message)=>Object.assign(new Error(message),{status});
const digits=v=>typeof v==='string'&&/^\d{1,30}$/.test(v);
const slim=s=>String(s??'').trim();
const finite=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const sourceFingerprint=(item,draft,photos)=>crypto.createHash('sha256').update(JSON.stringify({
 sku:item.sku,condition:item.condition,warehouseStatus:item.status,received:item.received_verified,bin:item.bin_location,
 draftStatus:draft.status,title:draft.title,description:draft.description,price:draft.price_cents,category:draft.category_id,
 facts:draft.verifiedFacts,aspects:draft.aspects,photos:photos.map(x=>[x.source,x.id])
})).digest('hex');
const CONDITIONS={'New with tags':'NEW','New without tags':'NEW_OTHER','Like new':'LIKE_NEW','Excellent':'USED_EXCELLENT','Good':'USED_GOOD','Fair':'USED_ACCEPTABLE'};
export function createEbayUnpublishedOffers({db,oauth,fetcher=fetch,loadPhoto,clock=()=>Date.now(),enabled=()=>process.env.SHUKCHIC_EBAY_PREPARE_ENABLED==='true',publishEnabled=()=>process.env.SHUKCHIC_EBAY_LIVE_PUBLISH_ENABLED==='true',prepareAllowed=(sku)=>{const allow=slim(process.env.SHUKCHIC_EBAY_PREPARE_ALLOWLIST||'').split(',').map(x=>x.trim());return allow.includes(sku)||allow.includes('*');}}){
 db.exec("CREATE TABLE IF NOT EXISTS ebay_offer_preparations (submission_id TEXT PRIMARY KEY,sku TEXT NOT NULL UNIQUE,state TEXT NOT NULL,offer_id TEXT,listing_id TEXT,policy_json TEXT NOT NULL DEFAULT '{}',source_hash TEXT NOT NULL DEFAULT '',last_error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
 // Additive migration for databases initialized before the controlled live-publish phase.
 if(!db.prepare('PRAGMA table_info(ebay_offer_preparations)').all().some(c=>c.name==='source_hash'))
  db.exec("ALTER TABLE ebay_offer_preparations ADD COLUMN source_hash TEXT NOT NULL DEFAULT ''");
 // Recovery migration: the pre-inventory-first flow called getOffers on an unknown SKU.
 // eBay rejected that READ with 25709 before any inventory, image or offer write.
 // Only this exact historical state is safe to discard; never clear an uncertain write.
 const recovered=db.prepare("DELETE FROM ebay_offer_preparations WHERE state='UNKNOWN' AND offer_id IS NULL AND listing_id IS NULL AND last_error LIKE 'Existing offer lookup rejected by eBay (HTTP 400; codes 25709)%'").run();
 if(recovered.changes>0)console.info('Recovered '+recovered.changes+' legacy read-only eBay offer lookup failure(s).');
 const recoveredInventory=db.prepare("DELETE FROM ebay_offer_preparations WHERE state='BLOCKED_READ_ONLY' AND offer_id IS NULL AND listing_id IS NULL AND last_error LIKE 'Existing inventory lookup rejected by eBay (HTTP 400; codes 25709)%'").run();
 if(recoveredInventory.changes>0)console.info('Recovered '+recoveredInventory.changes+' read-only eBay inventory lookup failure(s).');
 // The exact 25709 error on the fallback inventory collection was a rejected
 // Accept-Language header on a GET, before any mutation was attempted.
 const recoveredLanguage=db.prepare("DELETE FROM ebay_offer_preparations WHERE state='BLOCKED_READ_ONLY' AND offer_id IS NULL AND listing_id IS NULL AND last_error LIKE 'Inventory collection fallback rejected by eBay (HTTP 400; codes 25709)%Invalid value for header Accept-Language%'").run();
 if(recoveredLanguage.changes>0)console.info('Recovered '+recoveredLanguage.changes+' eBay inventory Accept-Language read-only failure(s).');
 const statement=db.prepare('SELECT submission_id,sku,state,offer_id,listing_id,last_error FROM ebay_offer_preparations WHERE submission_id=?');
 function get(id){return statement.get(id)||null;}
 const styleFailure=x=>x&&x.state==='UNKNOWN'&&!!x.offer_id&&!x.listing_id&&
   /^Live eBay publishing rejected by eBay \(HTTP 400; codes 25002\)/.test(x.last_error||'')&&
   /item specific Style is missing/i.test(x.last_error||'');
 function safeResult(id){const x=get(id);const allow=slim(process.env.SHUKCHIC_EBAY_PUBLISH_ALLOWLIST||'').split(',').map(v=>v.trim());return x?{id,sku:x.sku,state:x.state,offerId:x.offer_id||null,listingId:x.listing_id||null,requiresReconciliation:x.state==='UNKNOWN',styleFixAvailable:!!styleFailure(x),livePublishAvailable:x.state==='PREPARED'&&publishEnabled()&&(allow.includes(x.sku)||allow.includes('*'))}:{id,state:'NOT_PREPARED',offerId:null,listingId:null,livePublishAvailable:false,styleFixAvailable:false};}
 async function call(url,options){
  let response;
  try{response=await fetcher(url,{...options,signal:AbortSignal.timeout(16000)});}
  catch{throw fail(502,'eBay network request was interrupted. Inspect remote offers before retrying.');}
  let data={};
  if(response.status!==204){try{data=await response.json();}catch{}}
  return {status:response.status,ok:response.ok,data,headers:response.headers};
 }
 async function api(token,path,method='GET',body){
  return call('https://api.ebay.com'+path,{method,headers:{Authorization:'Bearer '+token,Accept:'application/json','Accept-Language':'en-US',...(body?{'Content-Type':'application/json','Content-Language':'en-US'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 }
 function eBayError(result,step){
  const errors=(result.data?.errors||[]).slice(0,4);
  const codes=errors.map(x=>Number(x.errorId)).filter(Number.isFinite);
  // eBay error 25709 contains the invalid field name in its message or parameters.
  // Limit and sanitize displayed text; never expose request headers or OAuth tokens.
  const details=errors.map(e=>{
   const params=(e.parameters||[]).map(p=>slim(p.name)+'='+slim(p.value)).join(', ');
   return [slim(e.message),slim(e.longMessage),params].filter(Boolean).join(' · ');
  }).join('; ').replace(/[\r\n\t]/g,' ').slice(0,250);
  return fail(502,step+' rejected by eBay (HTTP '+result.status+
   (codes.length?'; codes '+codes.join(', '):'')+')'+(details?': '+details:'')+'.');
 }
 // If a single-SKU GET is invalid (25709), use a complete read-only inventory scan.
 // Page offset is a page number, not a record offset in eBay's Inventory API.
 async function checkInventoryAbsence(token,sku){
  const single=await api(token,'/sell/inventory/v1/inventory_item/'+encodeURIComponent(sku));
  if(single.ok)return {absent:false};
  if(single.status===404||single.status===400&&
    (single.data?.errors||[]).some(e=>[25702,25710].includes(Number(e.errorId))))
   return {absent:true};
  const invalidField=single.status===400&&(single.data?.errors||[]).some(e=>Number(e.errorId)===25709);
  if(!invalidField)throw eBayError(single,'Existing inventory lookup');
  for(let page=0;page<20;page++){
   const result=await api(token,'/sell/inventory/v1/inventory_item?limit=100&offset='+page);
   if(!result.ok)throw eBayError(result,'Inventory collection fallback');
   const items=result.data?.inventoryItems;
   const total=Number(result.data?.total);
   if(!Array.isArray(items)||!Number.isSafeInteger(total)||total<0)
    throw fail(502,'Inventory collection returned incomplete pagination information. No writes attempted.');
   if(items.some(x=>slim(x.sku)===sku))return {absent:false};
   if(total<=100*(page+1))return {absent:true};
   if(items.length===0)throw fail(502,'eBay inventory pagination stopped unexpectedly. No writes attempted.');
  }
  throw fail(502,'eBay inventory exceeds safe verification limit. No writes attempted.');
 }

 async function availablePolicies(token){
  const requests=[
   ['/sell/account/v1/payment_policy?marketplace_id=EBAY_US','paymentPolicies','paymentPolicyId'],
   ['/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_US','fulfillmentPolicies','fulfillmentPolicyId'],
   ['/sell/account/v1/return_policy?marketplace_id=EBAY_US','returnPolicies','returnPolicyId'],
   ['/sell/inventory/v1/location?limit=100','locations','merchantLocationKey']
  ];
  const fetched=await Promise.all(requests.map(async([url,key,field])=>{
   const r=await api(token,url);
   if(!r.ok)throw eBayError(r,'Seller policy/location lookup');
   return new Set((r.data?.[key]||[]).map(v=>slim(v[field])).filter(Boolean));
  }));
  return fetched;
 }
 async function mediaUpload(token,photo){
  const original=await loadPhoto(photo);
  if(!original?.bytes||!/^image\/(png|jpeg|webp)$/.test(original.mime)||original.bytes.length>5*1024*1024)throw fail(409,'Selected photo is unavailable or unsupported.');
  const form=new FormData();
  form.append('image',new Blob([original.bytes],{type:original.mime}),original.mime==='image/png'?'listing.png':original.mime==='image/webp'?'listing.webp':'listing.jpg');
  let response;
  try{response=await fetcher('https://apim.ebay.com/commerce/media/v1_beta/image/create_image_from_file',{method:'POST',headers:{Authorization:'Bearer '+token},body:form,signal:AbortSignal.timeout(20000)});}
  catch{throw fail(502,'eBay photo upload outcome unknown. Inspect remotely before retrying.');}
  let data={};try{data=await response.json();}catch{}
  if(!response.ok)throw fail(502,'eBay image upload failed (HTTP '+response.status+').');
  if(typeof data.imageUrl==='string'&&data.imageUrl.startsWith('https://'))return data.imageUrl;
  const location=response.headers?.get?.('location');
  if(!location||!/^https:\/\/apim\.ebay\.com\/commerce\/media\/v1_beta\/image\/[A-Za-z0-9_-]+$/.test(location))throw fail(502,'eBay did not supply a verifiable uploaded-photo identifier.');
  const image=await call(location,{headers:{Authorization:'Bearer '+token}});
  if(!image.ok||typeof image.data?.imageUrl!=='string'||!image.data.imageUrl.startsWith('https://'))throw fail(502,'Uploaded eBay photo is not available yet.');
  return image.data.imageUrl;
 }
 async function prepare({item,draft,photos,duplicates,issues=[],settings}){
  if(!enabled())throw fail(409,'Unpublished eBay offer preparation is disabled until the first controlled pilot is approved.');
  if(!prepareAllowed(item.sku))throw fail(409,'This SKU is not authorized for the controlled unpublished-offer preparation pilot.');
  const checked=evaluateListingForBatch({item,draft,gates:issues,photos,duplicateSku:duplicates});
  if(!checked.localReady)throw fail(409,'Listing not locally ready: '+checked.blockers.join('; '));
  // Recover only the prior known read-only getOffers failure (25709).
  // No remote mutations occurred before that error in the previous implementation.
  const prior=db.prepare('SELECT state,offer_id,listing_id,last_error FROM ebay_offer_preparations WHERE submission_id=?').get(item.id);
  if(prior){
   const oldOfferRead=prior.state==='UNKNOWN'&&
     /^Existing offer lookup rejected by eBay \(HTTP 400; codes 25709\)/.test(prior.last_error||'');
   const oldInventoryRead=prior.state==='BLOCKED_READ_ONLY'&&
     /^Existing inventory lookup rejected by eBay \(HTTP 400; codes 25709\)/.test(prior.last_error||'');
   const oldLanguageRead=prior.state==='BLOCKED_READ_ONLY'&&
     /^Inventory collection fallback rejected by eBay \(HTTP 400; codes 25709\).*Invalid value for header Accept-Language/.test(prior.last_error||'');
   if(!prior.offer_id&&!prior.listing_id&&(oldOfferRead||oldInventoryRead||oldLanguageRead)){
    db.prepare("DELETE FROM ebay_offer_preparations WHERE submission_id=? AND state=? AND offer_id IS NULL AND listing_id IS NULL AND last_error=?")
      .run(item.id,prior.state,prior.last_error);
   }else throw fail(409,'This SKU has a prior eBay preparation. Reconcile it before making another request.');
  }
  if(get(item.id))throw fail(409,'This SKU has a prior eBay preparation. Reconcile it before making another request.');
  const cfg=settings||{},pol=cfg.policies||{},parcel=cfg.parcel||{};
  if(!digits(pol.paymentPolicyId)||!digits(pol.fulfillmentPolicyId)||!digits(pol.returnPolicyId))throw fail(400,'Select all three actual eBay policy IDs.');
  if(!/^[A-Za-z0-9._-]{1,50}$/.test(slim(cfg.merchantLocationKey)))throw fail(400,'Select an existing eBay inventory location.');
  if(!['NEW','NEW_OTHER','LIKE_NEW','USED_EXCELLENT','USED_GOOD','USED_ACCEPTABLE'].includes(CONDITIONS[item.condition]))throw fail(409,'Unsupported verified item condition. Review eBay category rules.');
  const length=Number(parcel.lengthIn),width=Number(parcel.widthIn),height=Number(parcel.heightIn),weight=Number(parcel.weightLb);
  if(![length,width,height].every(x=>finite(x,0.1,120))||!finite(weight,0.01,150))throw fail(400,'Enter verified package length, width, height (inches) and shipping weight (pounds) for calculated shipping.');
  const token=await oauth.getPublishingToken();
  const valid=await availablePolicies(token);
  const chosen=[slim(pol.paymentPolicyId),slim(pol.fulfillmentPolicyId),slim(pol.returnPolicyId),slim(cfg.merchantLocationKey)];
  if(chosen.some((v,i)=>!valid[i].has(v)))throw fail(409,'One or more selected business policies or the inventory location are unavailable to this seller.');
  const stamp=new Date(clock()).toISOString();
  try{db.prepare("INSERT INTO ebay_offer_preparations(submission_id,sku,state,policy_json,source_hash,created_at,updated_at) VALUES (?,?,'PREPARING',?,?,?,?)").run(item.id,item.sku,JSON.stringify({policies:pol,location:chosen[3],parcel}),sourceFingerprint(item,draft,photos),stamp,stamp);}
  catch{throw fail(409,'A preparation already exists for this item or warehouse SKU.');}
  // Read-only verification must never be confused with an uncertain remote write.
  let remoteWriteStarted=false;
  try{
   // Inventory API offers require an inventory item. Check the item first.
   // The legacy getOffers call could reject unknown SKU 001 with code 25709.
   const inventoryCheck=await checkInventoryAbsence(token,item.sku);
   if(!inventoryCheck.absent)throw fail(409,'An eBay inventory item already exists for this SKU. Reconcile before proceeding.');
   // No Inventory API item means there cannot be an Inventory API offer for this SKU.
   const urls=[];
   remoteWriteStarted=true;
   for(const photo of photos.slice(0,12))urls.push(await mediaUpload(token,{...photo,submissionId:item.id}));
   const facts=draft.verifiedFacts||{};
   // Include every staff-reviewed item specific, not just the five core fields.
   // Never infer a material or style from AI description prose.
   const aspects={};
   for(const [key,value] of Object.entries(draft.aspects||{})){
    if(!/^[A-Za-z][A-Za-z0-9 &/()'.,-]{0,64}$/.test(key))continue;
    const values=(Array.isArray(value)?value:[value]).map(v=>slim(v)).filter(v=>v&&v.length<=150);
    if(values.length)aspects[key]=values.slice(0,5);
   }
   for(const [key,value] of [['Brand',item.brand],['Color',facts.color],['Size',facts.size],['Material',facts.material],['Type',facts.category]]){
    if(value&&!aspects[key])aspects[key]=[slim(value)];
   }
   const inventoryBody={availability:{shipToLocationAvailability:{quantity:1}},condition:CONDITIONS[item.condition],
    product:{title:draft.title,description:draft.description,aspects,imageUrls:urls},
    packageWeightAndSize:{dimensions:{length,width,height,unit:'INCH'},weight:{value:weight,unit:'POUND'}}};
   const saved=await api(token,'/sell/inventory/v1/inventory_item/'+encodeURIComponent(item.sku),'PUT',inventoryBody);
   if(!saved.ok)throw eBayError(saved,'Inventory item creation');
   const offer={sku:item.sku,marketplaceId:'EBAY_US',format:'FIXED_PRICE',availableQuantity:1,categoryId:String(draft.category_id),
    merchantLocationKey:chosen[3],listingDuration:'GTC',listingDescription:draft.description,
    listingPolicies:{paymentPolicyId:chosen[0],fulfillmentPolicyId:chosen[1],returnPolicyId:chosen[2]},
    pricingSummary:{price:{value:(draft.price_cents/100).toFixed(2),currency:'USD'}}};
   const created=await api(token,'/sell/inventory/v1/offer','POST',offer);
   if(!created.ok||!slim(created.data?.offerId))throw created.ok?fail(502,'eBay did not confirm an offer ID. Reconciliation required.'):eBayError(created,'Unpublished offer creation');
   const offerId=slim(created.data.offerId);
   db.prepare("UPDATE ebay_offer_preparations SET state='PREPARED',offer_id=?,updated_at=?,last_error='' WHERE submission_id=? AND state='PREPARING'").run(offerId,new Date(clock()).toISOString(),item.id);
   return safeResult(item.id);
  }catch(err){
   const readOnly=!remoteWriteStarted;
   db.prepare("UPDATE ebay_offer_preparations SET state=?,updated_at=?,last_error=? WHERE submission_id=? AND state='PREPARING'")
    .run(readOnly?'BLOCKED_READ_ONLY':'UNKNOWN',new Date(clock()).toISOString(),String(err.message||'eBay request failed').slice(0,400),item.id);
   throw err;
  }
 }
 // Correct the already-created inventory item after a specific eBay "Style missing"
 // validation failure. Never recreate an offer or silently retry publishOffer.
 async function repairStyle({item,style}){
  const cleanStyle=slim(style);
  if(!cleanStyle||cleanStyle.length>70||/[<>\\r\\n]/.test(cleanStyle))throw fail(400,'Enter a verified item Style (up to 70 characters).');
  if(!publishEnabled()||!slim(process.env.SHUKCHIC_EBAY_PUBLISH_ALLOWLIST||'').split(',').map(x=>x.trim()).includes(item.sku))
   throw fail(409,'Style correction is restricted to the controlled listing pilot.');
  const current=db.prepare('SELECT * FROM ebay_offer_preparations WHERE submission_id=?').get(item.id);
  if(!styleFailure(current)||current.sku!==item.sku)
   throw fail(409,'This item does not have the verified missing-Style error. Do not alter the eBay offer.');
  const token=await oauth.getPublishingToken();
  const offer=await api(token,'/sell/inventory/v1/offer/'+encodeURIComponent(current.offer_id));
  if(!offer.ok)throw eBayError(offer,'Read-only offer reconciliation');
  if(slim(offer.data?.sku)!==item.sku||offer.data?.listingId)
   throw fail(409,'Offer SKU or published status differs. Manual reconciliation required; no writes made.');
  const remote=await api(token,'/sell/inventory/v1/inventory_item/'+encodeURIComponent(item.sku));
  if(!remote.ok)throw eBayError(remote,'Read-only inventory reconciliation');
  if(slim(remote.data?.sku)!==item.sku||!remote.data?.product||
     !Array.isArray(remote.data.product.imageUrls)||!remote.data.product.imageUrls.length)
   throw fail(409,'Existing eBay inventory or photos could not be verified. No writes made.');
  const currentStyle=remote.data.product.aspects?.Style;
  if(currentStyle?.length&&currentStyle[0]!==cleanStyle)
   throw fail(409,'A different Style is already stored at eBay. Manual review required.');
  const replacement={
   availability:remote.data.availability,
   condition:remote.data.condition,
   product:{...remote.data.product,aspects:{...(remote.data.product.aspects||{}),Style:[cleanStyle]}},
   packageWeightAndSize:remote.data.packageWeightAndSize
  };
  if(remote.data.conditionDescription)replacement.conditionDescription=remote.data.conditionDescription;
  if(remote.data.conditionDescriptors)replacement.conditionDescriptors=remote.data.conditionDescriptors;
  if(!replacement.availability||!replacement.condition||!replacement.packageWeightAndSize)
   throw fail(409,'Original eBay inventory fields are incomplete; no overwrite attempted.');
  const stamp=new Date(clock()).toISOString();
  const lock=db.prepare("UPDATE ebay_offer_preparations SET state='REPAIRING_STYLE',updated_at=? WHERE submission_id=? AND state='UNKNOWN' AND offer_id=?")
   .run(stamp,item.id,current.offer_id);
  if(lock.changes!==1)throw fail(409,'Listing repair is already in progress.');
  try{
   const updated=await api(token,'/sell/inventory/v1/inventory_item/'+encodeURIComponent(item.sku),'PUT',replacement);
   if(!updated.ok)throw eBayError(updated,'Style update on existing inventory');
   const policy=JSON.parse(current.policy_json||'{}');
   policy.staffVerifiedStyle=cleanStyle;
   db.prepare("UPDATE ebay_offer_preparations SET state='PREPARED',policy_json=?,last_error='',updated_at=? WHERE submission_id=? AND state='REPAIRING_STYLE'")
    .run(JSON.stringify(policy),new Date(clock()).toISOString(),item.id);
   return safeResult(item.id);
  }catch(err){
   // A PUT response can be ambiguous. Do not allow a second unattended update.
   db.prepare("UPDATE ebay_offer_preparations SET state='UNKNOWN',last_error=?,updated_at=? WHERE submission_id=? AND state='REPAIRING_STYLE'")
    .run(('Style update needs reconciliation: '+String(err.message||'Unknown eBay result')).slice(0,400),new Date(clock()).toISOString(),item.id);
   throw err;
  }
 }
 async function publish({item,draft,photos,duplicates,issues=[],confirmation}){
  if(!publishEnabled())throw fail(409,'Live eBay publishing is disabled until the controlled pilot succeeds.');
  const allow=slim(process.env.SHUKCHIC_EBAY_PUBLISH_ALLOWLIST||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(!allow.includes(item.sku)&&!allow.includes('*'))throw fail(409,'This SKU is not authorized for the controlled live-publishing pilot.');
  if(confirmation!=='PUBLISH_SELECTED_TO_EBAY')throw fail(400,'An explicit, deliberate publishing confirmation is required.');
  const readiness=evaluateListingForBatch({item,draft,gates:issues,photos,duplicateSku:duplicates});
  if(!readiness.localReady)throw fail(409,'Listing review changed: '+readiness.blockers.join('; '));
  const row=db.prepare('SELECT * FROM ebay_offer_preparations WHERE submission_id=?').get(item.id);
  if(!row||row.state!=='PREPARED'||!row.offer_id)throw fail(409,'An unpublished, verified eBay offer is required before live publication.');
  if(row.sku!==item.sku||!row.source_hash||row.source_hash!==sourceFingerprint(item,draft,photos))
   throw fail(409,'Listing details changed since the unpublished offer was created. Reconcile/update the eBay offer before publishing.');
  const token=await oauth.getPublishingToken();
  const remote=await api(token,'/sell/inventory/v1/offer/'+encodeURIComponent(row.offer_id));
  if(!remote.ok)throw eBayError(remote,'Unpublished offer verification');
  if(slim(remote.data?.sku)!==item.sku||remote.data?.listingId)
   throw fail(409,'Remote offer SKU/state differs from SHUKCHIC. Manual reconciliation required.');
  const stamp=new Date(clock()).toISOString();
  const lock=db.prepare("UPDATE ebay_offer_preparations SET state='PUBLISHING',updated_at=? WHERE submission_id=? AND state='PREPARED'")
   .run(stamp,item.id);
  if(lock.changes!==1)throw fail(409,'Publishing request is already in progress or has been completed.');
  try{
   const result=await api(token,'/sell/inventory/v1/offer/'+encodeURIComponent(row.offer_id)+'/publish','POST');
   if(!result.ok)throw eBayError(result,'Live eBay publishing');
   const listingId=slim(result.data?.listingId);
   if(!/^\d{5,30}$/.test(listingId))throw fail(502,'eBay did not return a verified listing ID. Reconciliation required.');
   db.prepare("UPDATE ebay_offer_preparations SET state='LIVE',listing_id=?,last_error='',updated_at=? WHERE submission_id=? AND state='PUBLISHING'")
    .run(listingId,new Date(clock()).toISOString(),item.id);
   return safeResult(item.id);
  }catch(err){
   db.prepare("UPDATE ebay_offer_preparations SET state='UNKNOWN',last_error=?,updated_at=? WHERE submission_id=? AND state='PUBLISHING'")
    .run(String(err.message||'Uncertain publishing result').slice(0,400),new Date(clock()).toISOString(),item.id);
   throw err;
  }
 }
 return {get:safeResult,prepare,publish,repairStyle};
}
