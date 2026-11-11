import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const safe=(value,max=300)=>String(value??'').trim().slice(0,max);
const validEmail=value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)&&value.length<=254;
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function equal(a,b){const x=Buffer.from(sha(String(a))),y=Buffer.from(sha(String(b)));return crypto.timingSafeEqual(x,y);}
const fail=(code,message)=>Object.assign(new Error(message),{status:code});
const stringify=(res,status,value,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(value));};
function clientCookie(req,name){const value=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));return value?value.slice(name.length+1):'';}
function passwordHash(password){const salt=crypto.randomBytes(16).toString('hex');return salt+':'+crypto.scryptSync(password,salt,64).toString('hex');}
function checkPassword(password,hash){if(!hash?.includes(':'))return false;const [salt,stored]=hash.split(':');if(!/^[a-f0-9]{32}$/.test(salt)||!/^[a-f0-9]{128}$/.test(stored))return false;const attempt=crypto.scryptSync(password,salt,64);return crypto.timingSafeEqual(attempt,Buffer.from(stored,'hex'));}
const digit=(n)=>Number.isFinite(Number(n))?Number(n):NaN;

export function createMerchantPortal({db,sessionSecret,uploadDir,mailEnabled=false,emailFrom='',resendKey='',baseUrl='',getEbayToken,getEbayPublishingToken}){
 db.exec("CREATE TABLE IF NOT EXISTS merchant_applications(id TEXT PRIMARY KEY,business TEXT NOT NULL,contact TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',city TEXT NOT NULL,state TEXT NOT NULL,postal_code TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'APPLIED',created_at TEXT NOT NULL)");
 db.exec("CREATE TABLE IF NOT EXISTS merchant_accounts(id TEXT PRIMARY KEY,application_id TEXT NOT NULL UNIQUE REFERENCES merchant_applications(id),business TEXT NOT NULL,email TEXT NOT NULL UNIQUE,contact TEXT NOT NULL,city TEXT NOT NULL,state TEXT NOT NULL,postal_code TEXT NOT NULL,password_hash TEXT NOT NULL DEFAULT '',commission_percent REAL NOT NULL,agreement_text TEXT NOT NULL,agreement_sha TEXT NOT NULL,signature TEXT NOT NULL DEFAULT '',signed_at TEXT,signature_ip_hash TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL)");
 db.exec("CREATE TABLE IF NOT EXISTS merchant_invites(id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id),secret_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT NOT NULL)");
 db.exec("CREATE TABLE IF NOT EXISTS merchant_items(merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id),submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id),stock_confirmed INTEGER NOT NULL,created_at TEXT NOT NULL)");
 db.exec("CREATE TABLE IF NOT EXISTS merchant_shipping_tasks(id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id),submission_id TEXT NOT NULL REFERENCES submissions(id),ebay_order_id TEXT NOT NULL UNIQUE,order_total_cents INTEGER NOT NULL,carrier TEXT NOT NULL,label_filename TEXT NOT NULL,label_mime TEXT NOT NULL,tracking TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'READY_TO_SHIP',created_at TEXT NOT NULL,shipped_at TEXT)");
if(!db.prepare('PRAGMA table_info(merchant_accounts)').all().some(x=>x.name==='ship_street'))db.exec("ALTER TABLE merchant_accounts ADD COLUMN ship_street TEXT NOT NULL DEFAULT ''");
 if(!db.prepare('PRAGMA table_info(merchant_accounts)').all().some(x=>x.name==='store_display_name'))db.exec("ALTER TABLE merchant_accounts ADD COLUMN store_display_name TEXT NOT NULL DEFAULT ''");
if(!db.prepare('PRAGMA table_info(merchant_accounts)').all().some(x=>x.name==='ebay_location_key'))db.exec("ALTER TABLE merchant_accounts ADD COLUMN ebay_location_key TEXT NOT NULL DEFAULT ''");
 if(!db.prepare('PRAGMA table_info(merchant_accounts)').all().some(x=>x.name==='ebay_location_verified_at'))db.exec("ALTER TABLE merchant_accounts ADD COLUMN ebay_location_verified_at TEXT");
 const addCookie=(res,value,remove=false)=>res.setHeader('Set-Cookie','shukchic_merchant='+value+'; HttpOnly; Path=/; SameSite=Lax; '+(process.env.NODE_ENV==='production'?'Secure; ':'')+'Max-Age='+(remove?0:30*86400));
 const makeSession=id=>{const payload=Buffer.from(JSON.stringify({id,exp:Date.now()+30*86400_000,v:1})).toString('base64url');return payload+'.'+crypto.createHmac('sha256',sessionSecret).update(payload).digest('base64url');};
 function logged(req){
  const token=clientCookie(req,'shukchic_merchant');const [p,signature]=token.split('.');if(!p||!signature||p.length>500)return null;
  const expected=crypto.createHmac('sha256',sessionSecret).update(p).digest('base64url');if(!equal(expected,signature))return null;
  try{const obj=JSON.parse(Buffer.from(p,'base64url').toString('utf8'));if(obj.v!==1||obj.exp<Date.now())return null;
   return db.prepare('SELECT id,business,email,contact,city,state,postal_code,ship_street,store_display_name,commission_percent,signed_at,ebay_location_key FROM merchant_accounts WHERE id=? AND active=1').get(obj.id)||null;
  }catch{return null;}
 }
 function invite(token){
  if(!/^[A-Za-z0-9_-]{32,80}$/.test(String(token||'')))return null;
  return db.prepare('SELECT i.id AS invite_id,i.expires_at,i.used_at,m.id,m.business,m.contact,m.email,m.commission_percent,m.agreement_text,m.agreement_sha FROM merchant_invites i JOIN merchant_accounts m ON m.id=i.merchant_id WHERE i.secret_hash=?').get(sha(token));
 }
 async function mail(to,subject,body,id){
  if(!mailEnabled)return false;
  try{const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+resendKey,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify({from:emailFrom,to:[to],subject,html:body}),signal:AbortSignal.timeout(9000)});return response.ok;}catch{return false;}
 }
 const responseAccount=m=>({business:m.business,storeName:m.store_display_name||m.business,contact:m.contact,email:m.email,city:m.city,state:m.state,postalCode:m.postal_code,street:m.ship_street||'',storeReady:!!m.ship_street,locationReady:!!m.ebay_location_key,commissionPercent:m.commission_percent});
 function owner(req,res){const u=logged(req);if(!u){stringify(res,401,{error:'Merchant sign-in required.'});return null;}return u;}
 async function handle(req,res,url,helpers){
  const p=url.pathname,method=req.method||'GET',send=(status,v)=>stringify(res,status,v);
  const body=async(limit=26000)=>helpers.readJson(req,limit);
  const publicOp=['/api/partners/apply','/api/merchant/invite','/api/merchant/activate','/api/merchant/login'].includes(p);
  if(!(p.startsWith('/api/partners/')||p.startsWith('/api/merchant/')||p.startsWith('/api/admin/partners')||p==='/api/admin/merchant-orders'))return false;
  if(method==='POST'&&!helpers.checkOrigin(req))throw fail(403,'Request origin not permitted.');
  if(method==='POST'&&!helpers.throttle(req,'merchant_'+p,publicOp?8:40,3600_000))throw fail(429,'Too many requests. Please try again later.');
  if(method==='POST'&&p==='/api/partners/apply'){
   const x=await body(7000);if(x.website)return send(200,{ok:true}),true;
   const business=safe(x.business,120),contact=safe(x.contact,100),email=safe(x.email,254).toLowerCase(),phone=safe(x.phone,40),city=safe(x.city,100),state=safe(x.state,50),postal=safe(x.postalCode,18),description=safe(x.description,1300);
   if(business.length<2||contact.length<2||!validEmail(email)||city.length<2||state.length<2||postal.length<4||!x.confirmBusinessInventory)return send(400,{error:'Complete the business details and confirm you control the stock.'}),true;
   const id=crypto.randomUUID(),time=new Date().toISOString();
   db.prepare('INSERT INTO merchant_applications(id,business,contact,email,phone,city,state,postal_code,description,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,business,contact,email,phone,city,state,postal,description,time);
   return send(201,{ok:true,reference:id}),true;
  }
  if(method==='GET'&&p==='/api/merchant/invite'){
   const info=invite(url.searchParams.get('token'));if(!info||info.used_at||Date.parse(info.expires_at)<Date.now())return send(404,{error:'Invitation unavailable or expired.'}),true;
   return send(200,{business:info.business,contact:info.contact,email:info.email,commissionPercent:info.commission_percent,agreementText:info.agreement_text,agreementHash:info.agreement_sha}),true;
  }
  if(method==='POST'&&p==='/api/merchant/activate'){
   const b=await body(15000),info=invite(b.token);
   if(!info||info.used_at||Date.parse(info.expires_at)<Date.now())return send(410,{error:'Invitation expired or already used.'}),true;
   const signature=safe(b.signature,120),password=String(b.password||'');
   if(!b.accept||!b.confirmBusinessInventory||signature.length<3||password.length<12||password.length>150)return send(400,{error:'Review the terms, sign your name, verify your inventory and choose a password of at least 12 characters.'}),true;
   const stamp=new Date().toISOString(),hash=passwordHash(password);
   db.exec('BEGIN IMMEDIATE');try{
    const change=db.prepare("UPDATE merchant_invites SET used_at=? WHERE id=? AND used_at IS NULL").run(stamp,info.invite_id);
    if(change.changes!==1)throw fail(409,'Invitation already accepted.');
    db.prepare('UPDATE merchant_accounts SET password_hash=?,signature=?,signed_at=?,signature_ip_hash=?,active=1 WHERE id=?').run(hash,signature,stamp,sha(helpers.ipOf(req)+':'+sessionSecret),info.id);
    db.prepare("UPDATE merchant_applications SET status='ACTIVE' WHERE id=(SELECT application_id FROM merchant_accounts WHERE id=?)").run(info.id);
    db.exec('COMMIT');
   }catch(err){db.exec('ROLLBACK');throw err;}
   addCookie(res,makeSession(info.id));return send(200,{ok:true}),true;
  }
  if(method==='POST'&&p==='/api/merchant/login'){
   const b=await body(2500),email=safe(b.email,254).toLowerCase(),m=db.prepare('SELECT id,password_hash,active FROM merchant_accounts WHERE email=?').get(email);
   if(!m||!m.active||!checkPassword(String(b.password||''),m.password_hash))return send(401,{error:'Incorrect merchant credentials.'}),true;
   addCookie(res,makeSession(m.id));return send(200,{ok:true}),true;
  }
  if(method==='POST'&&p==='/api/merchant/logout'){addCookie(res,'',true);return send(200,{ok:true}),true;}
  if(p.startsWith('/api/admin/')){
   if(!helpers.admin)return send(401,{error:'Admin sign-in required.'}),true;
   if(method==='GET'&&p==='/api/admin/partners'){
    const applications=db.prepare('SELECT * FROM merchant_applications ORDER BY created_at DESC LIMIT 200').all();
    const merchants=db.prepare('SELECT id,application_id,business,email,city,state,postal_code,commission_percent,signed_at,active,ship_street,ebay_location_key FROM merchant_accounts ORDER BY created_at DESC').all();
    return send(200,{applications,merchants}),true;
   }
   const approve=p.match(/^\/api\/admin\/partners\/([a-f0-9-]{36})\/invite$/);
   if(method==='POST'&&approve){
    const a=db.prepare('SELECT * FROM merchant_applications WHERE id=?').get(approve[1]);if(!a)return send(404,{error:'Application not found.'}),true;
    const b=await body(20000),pct=digit(b.commissionPercent),terms=safe(b.agreementText,12500);
    if(!Number.isInteger(pct)||pct<0||pct>80||terms.length<350||!b.reviewedTerms)return send(400,{error:'Enter reviewed merchant agreement text (350+ characters) and a confirmed SHUKCHIC commission percentage of 0–80.'}),true;
    let m=db.prepare('SELECT * FROM merchant_accounts WHERE application_id=?').get(a.id),stamp=new Date().toISOString();
    if(m?.signed_at)return send(409,{error:'Partner already signed. Changes require a new agreement process.'}),true;
    if(!m){const duplicate=db.prepare('SELECT id FROM merchant_accounts WHERE email=?').get(a.email);if(duplicate)return send(409,{error:'Merchant email already registered.'}),true;
      const id=crypto.randomUUID();db.prepare('INSERT INTO merchant_accounts(id,application_id,business,email,contact,city,state,postal_code,commission_percent,agreement_text,agreement_sha,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,a.id,a.business,a.email,a.contact,a.city,a.state,a.postal_code,pct,terms,sha(terms),stamp);
      m=db.prepare('SELECT * FROM merchant_accounts WHERE id=?').get(id);
    }else{
      db.prepare('UPDATE merchant_accounts SET commission_percent=?,agreement_text=?,agreement_sha=? WHERE id=?').run(pct,terms,sha(terms),m.id);
    }
    const raw=crypto.randomBytes(32).toString('base64url'),id=crypto.randomUUID(),expires=new Date(Date.now()+7*86400_000).toISOString();
    db.prepare('UPDATE merchant_invites SET used_at=? WHERE merchant_id=? AND used_at IS NULL').run(stamp,m.id);
    db.prepare('INSERT INTO merchant_invites(id,merchant_id,secret_hash,expires_at,created_at) VALUES(?,?,?,?,?)').run(id,m.id,sha(raw),expires,stamp);
    db.prepare("UPDATE merchant_applications SET status='INVITED' WHERE id=?").run(a.id);
    const link=baseUrl+'/merchant?invite='+encodeURIComponent(raw);
    const sent=await mail(m.email,'SHUKCHIC merchant partnership invitation','<h2>Welcome to SHUKCHIC</h2><p>Review and sign your merchant partnership terms, then activate your secure mobile account.</p><p><a href="'+link+'">Activate your merchant account</a></p><p>This link expires in seven days.</p>','merchant-invite-'+id);
    return send(200,{ok:true,emailSent:sent,inviteUrl:link,expiresAt:expires}),true;
   }
   const loc=p.match(/^\/api\/admin\/partners\/([a-f0-9-]{36})\/location$/);
   if(method==='POST'&&loc){
    const m=db.prepare('SELECT id,business,ship_street,city,state,postal_code,signed_at,active,ebay_location_key FROM merchant_accounts WHERE id=?').get(loc[1]);
    if(!m||!m.active||!m.signed_at)return send(409,{error:'Merchant must sign the partnership agreement before location setup.'}),true;
    if(m.ship_street.length<5||!/^[A-Za-z]{2}$/.test(m.state)||!/^\d{5}(?:-\d{4})?$/.test(m.postal_code))
     return send(409,{error:'Merchant must complete a valid US shipping address in their mobile store settings.'}),true;
    const key='SCM_'+m.id.replaceAll('-','').slice(0,18)+'_'+sha(m.ship_street+'|'+m.city+'|'+m.state+'|'+m.postal_code).slice(0,8);
    const endpoint='https://api.ebay.com/sell/inventory/v1/location/'+encodeURIComponent(key);
    let token;try{token=await getEbayPublishingToken();}catch{return send(503,{error:'eBay publishing permission is not connected.'}),true;}
    const headers={Authorization:'Bearer '+token,Accept:'application/json','Content-Type':'application/json'};
    const correct=remote=>{
     const address=remote?.location?.address||{},norm=x=>safe(x,180).toLowerCase().replace(/[^a-z0-9]/g,'');
     return norm(address.addressLine1)===norm(m.ship_street)&&norm(address.city)===norm(m.city)&&norm(address.stateOrProvince)===norm(m.state)&&norm(address.postalCode)===norm(m.postal_code)&&String(address.country||'').toUpperCase()==='US'&&remote.merchantLocationStatus!=='DISABLED';
    };
    let existing;try{existing=await fetch(endpoint,{headers,signal:AbortSignal.timeout(9500)});}catch{return send(502,{error:'eBay location service unavailable.'}),true;}
    if(existing.status===404){
     const payload={name:('SHUKCHIC Merchant '+m.business).slice(0,80),location:{address:{addressLine1:m.ship_street,city:m.city,stateOrProvince:m.state.toUpperCase(),postalCode:m.postal_code,country:'US'}},locationTypes:['WAREHOUSE'],merchantLocationStatus:'ENABLED'};
     let created;try{created=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(9500)});}catch{return send(502,{error:'eBay location creation could not be confirmed. Check eBay before retrying.'}),true;}
     if(!created.ok)return send(502,{error:'eBay declined this merchant shipping location. Check business location details.'}),true;
     try{existing=await fetch(endpoint,{headers,signal:AbortSignal.timeout(9500)});}catch{return send(502,{error:'eBay location was created but verification is pending.'}),true;}
    }
    if(!existing.ok)return send(502,{error:'Could not confirm eBay merchant shipping location.'}),true;
    const remote=await existing.json();if(!correct(remote))return send(409,{error:'eBay shipping location differs from merchant-provided address. Do not publish until corrected.'}),true;
    db.prepare('UPDATE merchant_accounts SET ebay_location_key=?,ebay_location_verified_at=? WHERE id=?').run(key,new Date().toISOString(),m.id);
    return send(200,{ok:true,locationKey:key,city:m.city,state:m.state,postalCode:m.postal_code}),true;
   }
   if(method==='POST'&&p==='/api/admin/merchant-orders'){
    const data=await body(7*1024*1024),submissionId=safe(data.submissionId,25),orderId=safe(data.orderId,130),carrier=safe(data.carrier,50);
    const m=db.prepare("SELECT mi.merchant_id,s.id,s.sku,s.status,s.received_verified,ma.business FROM merchant_items mi JOIN submissions s ON s.id=mi.submission_id JOIN merchant_accounts ma ON ma.id=mi.merchant_id WHERE s.id=?").get(submissionId);
    if(!m||m.status!=='LISTED'||!m.received_verified||!m.sku)return send(409,{error:'Merchant item must be listed and verified before assigning an eBay order.'}),true;
    if(!/^[\w!:-]{8,130}$/.test(orderId)||!['USPS','UPS','FedEx'].includes(carrier))return send(400,{error:'Enter a valid eBay order and shipping carrier.'}),true;
    const label=data.label;if(!label||typeof label.data!=='string'||label.data.length>6*1024*1024)return send(400,{error:'Attach the purchased eBay QR image or PDF label.'}),true;
    let mime='',fileBytes=null,ext='';
    if(label.data.startsWith('data:application/pdf;base64,')){
     mime='application/pdf';fileBytes=Buffer.from(label.data.slice(28),'base64');ext='pdf';
     if(fileBytes.subarray(0,5).toString()!=='%PDF-')return send(400,{error:'Invalid PDF label.'}),true;
    }else{
     const parsed=helpers.parsePhoto(label);mime=parsed.mime;fileBytes=parsed.bytes;ext=parsed.ext;
    }
    if(fileBytes.length>5*1024*1024)return send(413,{error:'Shipping label too large.'}),true;
    let order;try{
     const token=await getEbayToken();
     const response=await fetch('https://api.ebay.com/sell/fulfillment/v1/order/'+encodeURIComponent(orderId),{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(9500)});
     if(!response.ok)throw fail(502,'eBay order could not be verified.');
     order=await response.json();
    }catch(err){return send(err.status||502,{error:'Could not verify this order with eBay. No shipping task created.'}),true;}
    if(order.orderPaymentStatus!=='PAID'||!Array.isArray(order.lineItems)||order.lineItems.length!==1||Number(order.lineItems[0].quantity)!==1||String(order.lineItems[0].sku||'')!==m.sku)
     return send(409,{error:'eBay order is not confirmed paid, or does not match this merchant item SKU.'}),true;
    if(db.prepare('SELECT 1 FROM merchant_shipping_tasks WHERE ebay_order_id=?').get(orderId))return send(409,{error:'Order already assigned to a merchant.'}),true;
    const match=order.lineItems.find(line=>String(line.sku||'')===m.sku);
    const price=Number(match?.lineItemCost?.value||match?.total?.value);
    if(!Number.isFinite(price)||price<=0||price>100000)return send(409,{error:'eBay item sale price unavailable for safe merchant earnings calculation.'}),true;
    const totalCents=Math.round(price*100),id=crypto.randomUUID(),filename=crypto.randomUUID()+'.'+ext;
    const location=path.join(uploadDir,filename);
    try{fs.writeFileSync(location,fileBytes,{flag:'wx',mode:0o600});
      db.prepare('INSERT INTO merchant_shipping_tasks(id,merchant_id,submission_id,ebay_order_id,order_total_cents,carrier,label_filename,label_mime,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,m.merchant_id,m.id,orderId,totalCents,carrier,filename,mime,new Date().toISOString());
    }catch(err){try{fs.unlinkSync(location)}catch{}throw err;}
    return send(201,{ok:true,shippingTaskId:id}),true;
   }
   return send(404,{error:'Unknown partner admin action.'}),true;
  }
  if(method==='GET'&&p==='/api/merchant/session'){
   const u=logged(req);return send(200,{authenticated:!!u,merchant:u?responseAccount(u):null}),true;
  }
  const user=owner(req,res);if(!user)return true;
  if(method==='POST'&&p==='/api/merchant/store'){
   const b=await body(4000),storeName=safe(b.storeName,120),street=safe(b.street,180),city=safe(b.city,100),state=safe(b.state,50),postal=safe(b.postalCode,18);
   if(storeName.length<2||street.length<5||city.length<2||state.length<2||postal.length<4)return send(400,{error:'Enter your boutique name and complete real shipping address.'}),true;
   const changed=street!==user.ship_street||city!==user.city||state!==user.state||postal!==user.postal_code;
   if(changed){
    const activeListings=db.prepare("SELECT COUNT(*) AS n FROM merchant_items mi JOIN submissions s ON s.id=mi.submission_id WHERE mi.merchant_id=? AND s.status IN ('LISTED','SOLD','SHIPPED','PAID')").get(user.id).n;
    if(activeListings)return send(409,{error:'You have active listings. Contact SHUKCHIC before changing the ship-from address so existing eBay listings can be updated safely.'}),true;
    db.prepare("UPDATE merchant_accounts SET store_display_name=?,ship_street=?,city=?,state=?,postal_code=?,ebay_location_key='',ebay_location_verified_at=NULL WHERE id=?").run(storeName,street,city,state,postal,user.id);
   }
   else db.prepare('UPDATE merchant_accounts SET store_display_name=? WHERE id=?').run(storeName,user.id);
   return send(200,{ok:true}),true;
  }
  if(method==='GET'&&p==='/api/merchant/agreement'){
   const record=db.prepare('SELECT business,agreement_text,agreement_sha,signature,signed_at,commission_percent FROM merchant_accounts WHERE id=?').get(user.id);
   return send(200,{agreement:record}),true;
  }
  if(method==='POST'&&p==='/api/merchant/sync-shipping'){
   const tasks=db.prepare('SELECT id,ebay_order_id,status FROM merchant_shipping_tasks WHERE merchant_id=? ORDER BY created_at DESC LIMIT 15').all(user.id);
   if(!tasks.length)return send(200,{ok:true,updated:0,checked:0}),true;
   let token;try{token=await getEbayToken();}catch{return send(503,{error:'eBay shipment tracking unavailable right now.'}),true;}
   let updated=0;
   for(const task of tasks){
    try{
     const response=await fetch('https://api.ebay.com/sell/fulfillment/v1/order/'+encodeURIComponent(task.ebay_order_id)+'/shipping_fulfillment',{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(6000)});
     if(!response.ok)continue;
     const data=await response.json(),fulfillments=Array.isArray(data.fulfillments)?data.fulfillments:[];
     const shipment=fulfillments.find(x=>x.shipmentTrackingNumber||x.trackingNumber);
     if(!shipment)continue;
     const tracking=safe(shipment.shipmentTrackingNumber||shipment.trackingNumber,130);
     if(!tracking)continue;
     db.prepare("UPDATE merchant_shipping_tasks SET tracking=?,status=CASE WHEN status='READY_TO_SHIP' THEN 'TRACKING_AVAILABLE' ELSE status END WHERE id=? AND merchant_id=?").run(tracking,task.id,user.id);
     updated++;
    }catch{}
   }
   return send(200,{ok:true,updated,checked:tasks.length}),true;
  }
  if(method==='GET'&&p==='/api/merchant/items'){
   const items=db.prepare("SELECT s.id,s.brand,s.category,s.condition,s.description,s.sku,s.status,s.created_at,s.received_verified,(SELECT COUNT(*) FROM photos p WHERE p.submission_id=s.id) AS photo_count FROM submissions s JOIN merchant_items mi ON mi.submission_id=s.id WHERE mi.merchant_id=? ORDER BY s.created_at DESC LIMIT 200").all(user.id);
   const tasks=db.prepare('SELECT id,submission_id,ebay_order_id,order_total_cents,carrier,tracking,status,created_at,shipped_at FROM merchant_shipping_tasks WHERE merchant_id=? ORDER BY created_at DESC LIMIT 100').all(user.id);
   return send(200,{items,orders:tasks,commissionPercent:user.commission_percent,merchant:responseAccount(user)}),true;
  }
  if(method==='POST'&&p==='/api/merchant/items'){
   if(!user.ship_street)return send(409,{error:'Set your real boutique shipping address in Store settings before adding items.'}),true;
   const b=await body(26*1024*1024);
   const brand=safe(b.brand,100),category=safe(b.category,60),condition=safe(b.condition,60),description=safe(b.description,1800);
   if(brand.length<2||!helpers.categories.has(category)||!helpers.conditions.has(condition)||b.stockConfirmed!==true)return send(400,{error:'Choose category, brand, condition and confirm this item is in your stock.'}),true;
   if(!Array.isArray(b.photos)||!b.photos.length||b.photos.length>6)return send(400,{error:'Upload 1–6 product photos.'}),true;
   const images=b.photos.map(helpers.parsePhoto),id='RS-'+crypto.randomBytes(5).toString('hex').toUpperCase(),stamp=new Date().toISOString(),written=[];
   try{db.exec('BEGIN IMMEDIATE');
    db.prepare("INSERT INTO submissions(id,first_name,email,phone,category,brand,condition,description,status,email_status,intake_source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'SUBMITTED','NOT_APPLICABLE','MERCHANT',?,?)").run(id,user.business,user.email,'',category,brand,condition,description,stamp,stamp);
    db.prepare('INSERT INTO merchant_items(merchant_id,submission_id,stock_confirmed,created_at) VALUES(?,?,1,?)').run(user.id,id,stamp);
    for(const img of images){const pid=crypto.randomUUID(),filename=pid+'.'+img.ext;fs.writeFileSync(path.join(uploadDir,filename),img.bytes,{flag:'wx',mode:0o600});written.push(filename);db.prepare('INSERT INTO photos(id,submission_id,filename,mime,size) VALUES(?,?,?,?,?)').run(pid,id,filename,img.mime,img.bytes.length);}
    db.prepare('INSERT INTO admin_events(submission_id,event,created_at) VALUES(?,?,?)').run(id,'MERCHANT DROP-SHIP ITEM SUBMITTED · INVENTORY HELD BY PARTNER',stamp);
    db.exec('COMMIT');
   }catch(err){try{db.exec('ROLLBACK');}catch{}for(const name of written){try{fs.unlinkSync(path.join(uploadDir,name));}catch{}}throw err;}
   return send(201,{ok:true,id}),true;
  }
  if(method==='GET'&&p.startsWith('/api/merchant/shipping-label/')){
   const id=p.slice('/api/merchant/shipping-label/'.length);
   if(!/^[a-f0-9-]{36}$/.test(id))return send(404,{error:'Not found.'}),true;
   const task=db.prepare('SELECT * FROM merchant_shipping_tasks WHERE id=? AND merchant_id=?').get(id,user.id);if(!task)return send(404,{error:'Not found.'}),true;
   const file=path.resolve(uploadDir,path.basename(task.label_filename));if(!file.startsWith(path.resolve(uploadDir)+path.sep))return send(404,{error:'Not found.'}),true;
   res.writeHead(200,{'Content-Type':task.label_mime,'Content-Disposition':"inline; filename=shipping-label",'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(fs.readFileSync(file));return true;
  }
  if(method==='POST'&&p.startsWith('/api/merchant/shipping/')){
   const id=p.slice('/api/merchant/shipping/'.length),task=db.prepare('SELECT id,status FROM merchant_shipping_tasks WHERE id=? AND merchant_id=?').get(id,user.id);
   if(!task)return send(404,{error:'Shipping task not found.'}),true;
   if(!['READY_TO_SHIP','TRACKING_AVAILABLE'].includes(task.status))return send(409,{error:'Already marked handed to carrier.'}),true;
   db.prepare("UPDATE merchant_shipping_tasks SET status='DROPPED_OFF',shipped_at=? WHERE id=?").run(new Date().toISOString(),id);
   return send(200,{ok:true,requiresVerification:true}),true;
  }
  return send(404,{error:'Unknown merchant action.'}),true;
 }
 return {handle,logged,applicationCount:()=>db.prepare("SELECT COUNT(*) AS n FROM merchant_applications WHERE status='APPLIED'").get().n};
}
