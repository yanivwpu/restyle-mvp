import crypto from 'node:crypto';

// Draft management only. No eBay credentials, listing writes or public publication in this module.
const clean=(s,n=500)=>String(s??'').trim().slice(0,n);
const unpack=(s,def)=>{try{return JSON.parse(s);}catch{return def;}};
function factsFor(sub,b){return {brand:clean(sub.brand,100),category:clean(b.itemType,70)||clean(sub.category,70),condition:clean(sub.condition,80),size:clean(b.size,70),color:clean(b.color,70),material:clean(b.material,80),measurements:clean(b.measurements,300),flaws:clean(b.flaws,900),facts:clean(b.facts,900)};}
function starter(f){
 const title=[f.brand,f.category,f.size?'Size '+f.size:'',f.color].filter(Boolean).join(' ').slice(0,80);
 const lines=[f.brand+' '+f.category,'Warehouse verified condition: '+f.condition];
 for(const [k,v] of [['Size',f.size],['Color',f.color],['Material',f.material],['Measurements',f.measurements],['Known wear / flaws',f.flaws],['Additional verified details',f.facts]])if(v)lines.push(k+': '+v);
 lines.push('Please review item specifics, authenticity and warehouse photos before publication.');
 return {title,description:lines.join('\n'),categorySuggestion:f.category,aspects:{Brand:f.brand,Condition:f.condition,...(f.size?{Size:f.size}:{}),...(f.color?{Color:f.color}:{}),...(f.material?{Material:f.material}:{})},checks:['Verify eBay category and required item specifics','Check warehouse photographs','Verify price using actual comparables','Inspect authenticity and disclose defects']};
}
const schema={type:'object',additionalProperties:false,required:['title','description','categorySuggestion','aspects','checks'],properties:{title:{type:'string'},description:{type:'string'},categorySuggestion:{type:'string'},aspects:{type:'array',items:{type:'object',additionalProperties:false,required:['name','value'],properties:{name:{type:'string'},value:{type:'string'}}}},checks:{type:'array',items:{type:'string'}}}};
async function generateAI(f){
 if(!process.env.OPENAI_API_KEY)throw Object.assign(new Error('AI not connected. Set OPENAI_API_KEY to enable actual AI drafting.'),{status:409});
 const instruction='Create a factual eBay listing suggestion from ONLY the supplied verified warehouse facts. Title maximum 80 characters. Plain text description with flaws. Never invent provenance, authenticity, brand, measurements, materials, dates, defects, comparable sale prices, or other product specifics. Unknown aspects must be omitted. Category is a suggestion, not an official eBay category ID. Include important staff checks. Do not request personal data.';
 const request={model:process.env.RESTYLE_AI_MODEL||'gpt-4.1-mini',store:false,instructions:instruction,input:[{role:'user',content:[{type:'input_text',text:JSON.stringify(f)}]}],text:{format:{type:'json_schema',name:'restyle_listing',strict:true,schema}}};
 let response;try{response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(30000)});}catch{throw Object.assign(new Error('AI provider is not responding. Existing drafts were preserved.'),{status:502});}
 if(!response.ok)throw Object.assign(new Error('AI provider request failed. Existing drafts were preserved.'),{status:502});
 const out=await response.json();const text=(out.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
 if(out.status!=='completed'||!text)throw Object.assign(new Error('AI response incomplete. Existing drafts were preserved.'),{status:502});
 try{const j=JSON.parse(text);return {...j,aspects:Object.fromEntries((j.aspects||[]).slice(0,30).map(x=>[clean(x.name,65),clean(x.value,150)]))};}catch{throw Object.assign(new Error('AI response could not be validated. Existing drafts were preserved.'),{status:502});}
}
export function createListingDrafts({db,signing,audit}){
 db.exec("CREATE TABLE IF NOT EXISTS ebay_listing_drafts (submission_id TEXT PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'DRAFT',source TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,category_hint TEXT NOT NULL DEFAULT '',category_id TEXT NOT NULL DEFAULT '',aspects_json TEXT NOT NULL DEFAULT '{}',checks_json TEXT NOT NULL DEFAULT '[]',verified_facts_json TEXT NOT NULL DEFAULT '{}',price_cents INTEGER,reviewed_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
 function draft(id){const r=db.prepare('SELECT * FROM ebay_listing_drafts WHERE submission_id=?').get(id);return r?{...r,aspects:unpack(r.aspects_json,{}),checks:unpack(r.checks_json,[]),verifiedFacts:unpack(r.verified_facts_json,{})}:null;}
 function draftGates(sub){if(!sub)return ['Submission missing'];const issues=[];const agreement=signing.state(sub.id);
 if(!['STAFF_OWNED','MERCHANT'].includes(sub.intake_source)&&agreement?.state!=='SIGNED')issues.push('Signed consignment agreement required');
 if(!['AWAITING_SHIPMENT','RECEIVED','READY_TO_LIST'].includes(sub.status))issues.push('Approve item before drafting');
 if(!db.prepare('SELECT (SELECT COUNT(*) FROM photos WHERE submission_id=?) + (SELECT COUNT(*) FROM warehouse_photos WHERE submission_id=?) AS n').get(sub.id,sub.id).n)issues.push('Item photograph is required');
 return issues;}
 function gates(sub){const issues=draftGates(sub);if(!sub)return issues;
 if(!sub.received_verified||!['RECEIVED','READY_TO_LIST'].includes(sub.status))issues.push(sub.intake_source==='MERCHANT'?'Merchant inventory and shipping location must be verified by staff before final approval':'Warehouse item must be received and verified before final approval');
 if(!clean(sub.sku))issues.push('Warehouse SKU is required for final approval');
 if(!clean(sub.bin_location))issues.push('Warehouse bin is required for final approval');
 return issues;}
 function inspect(sub){return {draft:draft(sub.id),draftGates:draftGates(sub),gates:gates(sub),aiAvailable:!!process.env.OPENAI_API_KEY,ebayConnected:false,publishingEnabled:false,ebayMapping:{enabled:false,marketplace:'EBAY_US',status:'ACCESS_NOT_VERIFIED',message:'eBay Inventory Mapping requires a separate sell.inventory.mapping authorization. Existing seller scopes must not be modified until the app permission is confirmed. No eBay AI preview was requested.',documentation:'https://developer.ebay.com/develop/api/sell/inventory_mapping'}};}
 async function generate(sub,body){const issues=draftGates(sub);if(issues.length)throw Object.assign(new Error(issues.join('; ')),{status:409});
 if(body.confirmPhysicalFacts!==true)throw Object.assign(new Error('Staff must confirm the entered product information is based on the customer submission or inspected facts.'),{status:400});
 const f=factsFor(sub,body),mode=body.mode==='ai'?'ai':'starter',result=mode==='ai'?await generateAI(f):starter(f);
 const title=clean(result.title,80),desc=clean(result.description,5000),cat=clean(result.categorySuggestion,180);
 if(title.length<5||desc.length<30)throw Object.assign(new Error('Incomplete generation result. Draft unchanged.'),{status:502});
 const asp=Object.fromEntries(Object.entries(result.aspects||{}).slice(0,30).map(([k,v])=>[clean(k,65),clean(v,150)]));
 const checks=(result.checks||[]).slice(0,14).map(x=>clean(x,250));if(!sub.received_verified)checks.unshift('Preliminary draft: item and condition not yet physically inspected');const date=new Date().toISOString();
 const prior=draft(sub.id);db.prepare("INSERT INTO ebay_listing_drafts (submission_id,status,source,title,description,category_hint,aspects_json,checks_json,verified_facts_json,price_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(submission_id) DO UPDATE SET status='DRAFT',source=excluded.source,title=excluded.title,description=excluded.description,category_hint=excluded.category_hint,aspects_json=excluded.aspects_json,checks_json=excluded.checks_json,verified_facts_json=excluded.verified_facts_json,price_cents=excluded.price_cents,reviewed_at=NULL,updated_at=excluded.updated_at").run(sub.id,'DRAFT',mode,title,desc,cat,JSON.stringify(asp),JSON.stringify(checks),JSON.stringify(f),prior?.price_cents??null,date,date);
 audit(sub.id,'LISTING '+mode.toUpperCase()+' DRAFT GENERATED');return inspect(sub);}
 function importEbay(sub,preview,body={}){
  const issues=draftGates(sub);if(issues.length)throw Object.assign(new Error(issues.join('; ')),{status:409});
  if(!preview?.title||!preview?.description)throw Object.assign(new Error('eBay returned an incomplete recommendation.'),{status:409});
  const existing=draft(sub.id);
  if(existing&&body.replace!==true)return inspect(sub);
  const itemType=clean(body.itemType,70)||clean(sub.category,70);
  const mismatched=itemType.toLowerCase()==='ear cuff'&&/necklace|pendant/i.test(String(preview.categoryName||''));
  const title=clean([sub.brand,itemType,sub.condition].filter(Boolean).join(' '),80);
  // Begin with the seller's supplied facts. Keep unverified AI marketing copy in the stored preview, not the customer-facing draft.
  const description=[clean(sub.brand,100)+' '+itemType, 'Condition: '+clean(sub.condition,80),clean(sub.description,700)].filter(Boolean).join('\n');
  const checks=['Verify category and item specifics before approval','Verify all AI claims; photos do not establish materials or authenticity','Confirm price and shipping terms',...(mismatched?['CATEGORY CONFLICT: eBay suggested '+clean(preview.categoryName,110)+' but staff confirmed '+itemType]:[])];
  const now=new Date().toISOString(),price=existing?.price_cents??null;
  db.prepare("INSERT INTO ebay_listing_drafts (submission_id,status,source,title,description,category_hint,category_id,aspects_json,checks_json,verified_facts_json,price_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(submission_id) DO UPDATE SET status='DRAFT',source=excluded.source,title=excluded.title,description=excluded.description,category_hint=excluded.category_hint,category_id=excluded.category_id,aspects_json=excluded.aspects_json,checks_json=excluded.checks_json,verified_facts_json=excluded.verified_facts_json,price_cents=excluded.price_cents,reviewed_at=NULL,updated_at=excluded.updated_at")
   .run(sub.id,'DRAFT','ebay_ai',title,description,mismatched?itemType:clean(preview.categoryName,180),mismatched?'':clean(preview.categoryId,20),JSON.stringify({Brand:sub.brand,'Item type':itemType,Condition:sub.condition}),JSON.stringify(checks),JSON.stringify({category:itemType,condition:sub.condition,source:'customer submission; pending warehouse verification'}),price,now,now);
  audit(sub.id,'EBAY AI PREVIEW IMPORTED INTO EDITABLE DRAFT (NOT PUBLISHED)');
  return inspect(sub);
 }
 function save(sub,body){
  if(draftGates(sub).length)throw Object.assign(new Error('Listing draft requirements not satisfied.'),{status:409});
  const prior=draft(sub.id);if(!prior)throw Object.assign(new Error('Generate a draft first.'),{status:409});
  const title=clean(body.title,80),desc=clean(body.description,5000),hint=clean(body.categorySuggestion,180),cid=clean(body.categoryId,20),price=Number(body.price);
  if(title.length<5||desc.length<30)throw Object.assign(new Error('Title and description required.'),{status:400});
  if(cid&&!/^[0-9]{1,20}$/.test(cid))throw Object.assign(new Error('eBay category ID must be numeric.'),{status:400});
  if(clean(body.price)&&(!Number.isFinite(price)||price<=0||price>100000))throw Object.assign(new Error('Enter a positive asking price, or leave it blank to save for later.'),{status:400});
  const received=body.verifiedFacts;
  let facts=prior.verifiedFacts||{};
  if(received!==undefined){
   if(!received||typeof received!=='object'||Array.isArray(received))throw Object.assign(new Error('Invalid verified item details.'),{status:400});
   facts={...facts,...factsFor(sub,{...facts,itemType:received.itemType??facts.category,color:received.color??facts.color,size:received.size??facts.size,material:received.material??facts.material,measurements:received.measurements??facts.measurements,flaws:received.flaws??facts.flaws,facts:received.facts??facts.facts})};
  }
  const aspects={...prior.aspects};
  // Keep staff-verified item specifics aligned with the final listing draft.
  for(const [key,value] of [['Item type',facts.category],['Color',facts.color],['Size',facts.size],['Material',facts.material]]){
   if(value)aspects[key]=value;
   else delete aspects[key];
  }
  const now=new Date().toISOString();
  db.prepare("UPDATE ebay_listing_drafts SET title=?,description=?,category_hint=?,category_id=?,price_cents=?,aspects_json=?,verified_facts_json=?,status='DRAFT',reviewed_at=NULL,updated_at=? WHERE submission_id=?")
   .run(title,desc,hint,cid,clean(body.price)?Math.round(price*100):null,JSON.stringify(aspects),JSON.stringify(facts),now,sub.id);
  audit(sub.id,'LISTING DRAFT EDITED');
  return inspect(sub);
 }
 function approve(sub,body){
  // An edit + approval is atomic: failed approval cannot leave a fake success or half-saved review.
  if(body&&Object.keys(body).length){
   db.exec('BEGIN');
   try{
    save(sub,body);
    const result=approveStored(sub);
    db.exec('COMMIT');
    return result;
   }catch(err){db.exec('ROLLBACK');throw err;}
  }
  return approveStored(sub);
 }
 function approveStored(sub){
  if(gates(sub).length)throw Object.assign(new Error('Listing requirements not satisfied: '+gates(sub).join('; ')),{status:409});
  const d=draft(sub.id);
  if(!d||!d.category_id||!d.price_cents||!d.title||!d.description)throw Object.assign(new Error('Save the price, eBay category, title and description first.'),{status:409});
  if(d.status==='REVIEWED')return inspect(sub);
  if(!Object.keys(d.verifiedFacts||{}).length)throw Object.assign(new Error('Verified item facts are required.'),{status:409});
  const now=new Date().toISOString();db.prepare("UPDATE ebay_listing_drafts SET status='REVIEWED',reviewed_at=?,updated_at=? WHERE submission_id=?").run(now,now,sub.id);
  audit(sub.id,'LISTING DRAFT REVIEWED (NOT PUBLISHED)');return inspect(sub);
 }
 return {inspect,generate,save,approve,importEbay};
}
