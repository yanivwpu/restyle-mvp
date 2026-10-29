import crypto from 'node:crypto';

// Draft management only. No eBay credentials, listing writes or public publication in this module.
const clean=(s,n=500)=>String(s??'').trim().slice(0,n);
const unpack=(s,def)=>{try{return JSON.parse(s);}catch{return def;}};
function factsFor(sub,b){return {brand:clean(sub.brand,100),category:clean(sub.category,70),condition:clean(sub.condition,80),size:clean(b.size,70),color:clean(b.color,70),material:clean(b.material,80),measurements:clean(b.measurements,300),flaws:clean(b.flaws,900),facts:clean(b.facts,900)};}
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
 function gates(sub){if(!sub)return ['Submission missing'];const issues=[];const agreement=signing.state(sub.id);
 if(agreement?.state!=='SIGNED')issues.push('Signed consignment agreement required');
 if(!sub.received_verified||!['RECEIVED','READY_TO_LIST'].includes(sub.status))issues.push('Warehouse item must be received and verified');
 if(!clean(sub.sku))issues.push('Warehouse SKU is required');
 if(!clean(sub.bin_location))issues.push('Warehouse bin is required');
 if(!db.prepare('SELECT COUNT(*) AS n FROM photos WHERE submission_id=?').get(sub.id).n)issues.push('Item photograph is required');
 return issues;}
 function inspect(sub){return {draft:draft(sub.id),gates:gates(sub),aiAvailable:!!process.env.OPENAI_API_KEY,ebayConnected:false,publishingEnabled:false};}
 async function generate(sub,body){const issues=gates(sub);if(issues.length)throw Object.assign(new Error(issues.join('; ')),{status:409});
 if(body.confirmPhysicalFacts!==true)throw Object.assign(new Error('Staff must confirm the product details were verified in person.'),{status:400});
 const f=factsFor(sub,body),mode=body.mode==='ai'?'ai':'starter',result=mode==='ai'?await generateAI(f):starter(f);
 const title=clean(result.title,80),desc=clean(result.description,5000),cat=clean(result.categorySuggestion,180);
 if(title.length<5||desc.length<30)throw Object.assign(new Error('Incomplete generation result. Draft unchanged.'),{status:502});
 const asp=Object.fromEntries(Object.entries(result.aspects||{}).slice(0,30).map(([k,v])=>[clean(k,65),clean(v,150)]));
 const checks=(result.checks||[]).slice(0,14).map(x=>clean(x,250));const date=new Date().toISOString();
 const prior=draft(sub.id);db.prepare("INSERT INTO ebay_listing_drafts (submission_id,status,source,title,description,category_hint,aspects_json,checks_json,verified_facts_json,price_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(submission_id) DO UPDATE SET status='DRAFT',source=excluded.source,title=excluded.title,description=excluded.description,category_hint=excluded.category_hint,aspects_json=excluded.aspects_json,checks_json=excluded.checks_json,verified_facts_json=excluded.verified_facts_json,price_cents=excluded.price_cents,reviewed_at=NULL,updated_at=excluded.updated_at").run(sub.id,'DRAFT',mode,title,desc,cat,JSON.stringify(asp),JSON.stringify(checks),JSON.stringify(f),prior?.price_cents??null,date,date);
 audit(sub.id,'LISTING '+mode.toUpperCase()+' DRAFT GENERATED');return inspect(sub);}
 function save(sub,body){if(gates(sub).length)throw Object.assign(new Error('Listing safety gates not satisfied.'),{status:409});if(!draft(sub.id))throw Object.assign(new Error('Generate a draft first.'),{status:409});
 const title=clean(body.title,80),desc=clean(body.description,5000),hint=clean(body.categorySuggestion,180),cid=clean(body.categoryId,20),price=Number(body.price);
 if(title.length<5||desc.length<30)throw Object.assign(new Error('Title and description required.'),{status:400});
 if(cid&&!/^[0-9]{1,20}$/.test(cid))throw Object.assign(new Error('eBay category ID must be numeric.'),{status:400});
 if(!Number.isFinite(price)||price<=0||price>100000)throw Object.assign(new Error('Valid positive asking price required.'),{status:400});
 const now=new Date().toISOString();db.prepare("UPDATE ebay_listing_drafts SET title=?,description=?,category_hint=?,category_id=?,price_cents=?,status='DRAFT',reviewed_at=NULL,updated_at=? WHERE submission_id=?").run(title,desc,hint,cid,Math.round(price*100),now,sub.id);
 audit(sub.id,'LISTING DRAFT EDITED');return inspect(sub);}
 function approve(sub){if(gates(sub).length)throw Object.assign(new Error('Listing gates not satisfied.'),{status:409});const d=draft(sub.id);
 if(!d||!d.category_id||!d.price_cents||!d.title||!d.description)throw Object.assign(new Error('Save the price, eBay category ID, title and description first.'),{status:409});
 if(d.status==='REVIEWED')return inspect(sub);
 if(!Object.keys(d.verifiedFacts||{}).length)throw Object.assign(new Error('Verified warehouse facts are required.'),{status:409});
 const now=new Date().toISOString();db.prepare("UPDATE ebay_listing_drafts SET status='REVIEWED',reviewed_at=?,updated_at=? WHERE submission_id=?").run(now,now,sub.id);audit(sub.id,'LISTING DRAFT REVIEWED (NOT PUBLISHED)');return inspect(sub);}
 return {inspect,generate,save,approve};
}
