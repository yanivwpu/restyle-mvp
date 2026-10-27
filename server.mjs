import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createSigning } from './signing.mjs';
import { createListingDrafts } from './listing-drafts.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(root,'data'));
const UPLOAD_DIR = path.join(DATA_DIR,'uploads');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const EMAIL_FROM = process.env.EMAIL_FROM || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || '';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/,'');
const MAIL_ENABLED = Boolean(RESEND_API_KEY && EMAIL_FROM && !EMAIL_FROM.includes('your-verified-domain'));
const PRODUCTION = process.env.NODE_ENV === 'production';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true' || PRODUCTION;
// Short passwords are permitted only in the isolated staging pilot.
// Production launch environments continue to require a stronger password.
const MIN_ADMIN_PASSWORD_LENGTH = process.env.RAILWAY_ENVIRONMENT_NAME === 'staging' ? 5 : 14;
if(PRODUCTION && (ADMIN_PASSWORD.length < MIN_ADMIN_PASSWORD_LENGTH || SESSION_SECRET.length < 32)) {
  throw new Error(`Deployment requires ADMIN_PASSWORD (${MIN_ADMIN_PASSWORD_LENGTH}+ chars) and SESSION_SECRET (32+ chars).`);
}
const ALLOWED_STATUSES = new Set(['SUBMITTED','NEEDS_INFO','ACCEPTED','AWAITING_SHIPMENT','RECEIVED','READY_TO_LIST','LISTED','SOLD','SHIPPED','PAID','REJECTED']);
const CATEGORIES = new Set(['Handbags','Clothing','Shoes','Jewelry','Accessories','Other']);
const CONDITIONS = new Set(['New with tags','Like new','Excellent','Good','Fair']);
const rate = new Map();

fs.mkdirSync(UPLOAD_DIR,{recursive:true,mode:0o700});
const db = new DatabaseSync(path.join(DATA_DIR,'restyle.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS submissions (
 id TEXT PRIMARY KEY, first_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
 category TEXT NOT NULL, brand TEXT NOT NULL, condition TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'SUBMITTED', admin_notes TEXT NOT NULL DEFAULT '',
 estimate_cents INTEGER, tracking TEXT NOT NULL DEFAULT '', sku TEXT NOT NULL DEFAULT '', bin_location TEXT NOT NULL DEFAULT '',
 received_verified INTEGER NOT NULL DEFAULT 0, email_status TEXT NOT NULL DEFAULT 'PENDING',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS photos (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
 filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_outbox (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, to_email TEXT NOT NULL, subject TEXT NOT NULL, html TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
 last_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, submission_id TEXT NOT NULL,
 event TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_submission ON photos(submission_id);
`);

function json(res, status, obj, extras={}) {const payload=JSON.stringify(obj); res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extras});res.end(payload);}
function problem(res,status,message) {json(res,status,{error:message});}
function now(){return new Date().toISOString();}
function htmlEscape(x){return String(x??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));}
function clean(x,max=250){return String(x??'').trim().slice(0,max);}
function validEmail(x){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)&&x.length<255;}
function ipOf(req){const peer=req.socket.remoteAddress || 'unknown';if(process.env.TRUST_PROXY==='true'){const fwd=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();return fwd||peer;}return peer;}
function throttle(req,name,limit,ms){const key=`${name}:${ipOf(req)}`;const t=Date.now();const item=rate.get(key)||{start:t,count:0};if(t-item.start>ms){item.count=0;item.start=t;}item.count++;rate.set(key,item);return item.count<=limit;}
function cookie(req,key){const parts=(req.headers.cookie||'').split(';');const row=parts.find(p=>p.trim().startsWith(key+'='));return row?row.trim().slice(key.length+1):'';}
function secureEqual(a,b){const ah=crypto.createHash('sha256').update(String(a)).digest();const bh=crypto.createHash('sha256').update(String(b)).digest();return crypto.timingSafeEqual(ah,bh);}
function token(){const payload=Buffer.from(JSON.stringify({v:1,exp:Date.now()+8*3600_000,nonce:crypto.randomBytes(8).toString('hex')})).toString('base64url');const sig=crypto.createHmac('sha256',SESSION_SECRET).update(payload).digest('base64url');return `${payload}.${sig}`;}
function admin(req){if(!ADMIN_PASSWORD||!SESSION_SECRET)return false;const t=cookie(req,'restyle_session');const [p,s]=t.split('.');if(!p||!s||p.length>256)return false;const check=crypto.createHmac('sha256',SESSION_SECRET).update(p).digest('base64url');if(!secureEqual(check,s))return false;try{const v=JSON.parse(Buffer.from(p,'base64url').toString('utf8'));return v.v===1&&v.exp>Date.now();}catch{return false;}}
function setCookie(res,value,clear=false){res.setHeader('Set-Cookie',`restyle_session=${value}; HttpOnly; Path=/; SameSite=Strict; ${COOKIE_SECURE?'Secure; ':''}Max-Age=${clear?0:28800}`);}
async function readJson(req,maxBytes=26*1024*1024){let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>maxBytes){const e=new Error('Upload exceeds 26MB. Try smaller images.');e.status=413;throw e;}chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{const e=new Error('Invalid submission format.');e.status=400;throw e;}}
function checkOrigin(req){const origin=req.headers.origin; if(!origin)return true;try{const host=req.headers.host;return new URL(origin).host===host;}catch{return false;}}
function parsePhoto(photo){if(!photo || typeof photo.data!=='string')throw Error('Invalid photo.'); const m=photo.data.match(/^data:image\/(jpeg|png|webp);base64,([a-zA-Z0-9+/=]+)$/);if(!m)throw Error('Only JPEG, PNG and WebP images are accepted.');const mime=`image/${m[1]}`;const bytes=Buffer.from(m[2],'base64');if(!bytes.length||bytes.length>5*1024*1024)throw Error('Each photo must be 5MB or less.');const jpg=bytes.length>3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;const png=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));const webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';if(!((mime==='image/jpeg'&&jpg)||(mime==='image/png'&&png)||(mime==='image/webp'&&webp)))throw Error('The uploaded file is not a valid supported image.');return{bytes,mime,ext:mime==='image/jpeg'?'jpg':m[1]};}
function emailBody(name,id){return `<div style="font-family:Arial,sans-serif;max-width:580px;margin:auto;padding:24px;color:#242424"><img src="${PUBLIC_BASE_URL}/assets/shukchic-logo.svg?v=20261027-black80" width="180" height="98" alt="SHUKCHIC Designer Resale" style="display:block;border:0;max-width:180px;height:auto;margin-bottom:12px;border-radius:8px"><div style="font:12px Georgia,serif;letter-spacing:.16em;color:#4c3b2c">SHUKCHIC · DESIGNER RESALE</div><h2>We received your item submission.</h2><p>Hi ${htmlEscape(name)},</p><p>Thank you for submitting your item for a free preliminary resale assessment. Our team will review the information and photos, then contact you about next steps.</p><p style="padding:18px;background:#f7f3ef;border-radius:8px"><b>Submission reference:</b> ${htmlEscape(id)}</p><p><b>Please do not ship anything yet.</b> Only ship after our team has approved the item and you have accepted the consignment terms.</p><p>SHUKCHIC Team</p></div>`;}
function queueMail(submissionId,kind,to,subject,html){db.prepare('INSERT INTO mail_outbox (id, submission_id, kind, to_email, subject, html, created_at) VALUES (?,?,?,?,?,?,?)').run(crypto.randomUUID(),submissionId,kind,to,subject,html,now());}
async function sendPending(submissionId){const pending=db.prepare("SELECT * FROM mail_outbox WHERE submission_id=? AND state IN ('PENDING','FAILED') ORDER BY created_at LIMIT 10").all(submissionId);let sent=0;for(const mail of pending){if(!MAIL_ENABLED){db.prepare("UPDATE mail_outbox SET state='SETUP_REQUIRED' WHERE id=?").run(mail.id);continue;}try{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8500);let response;try{response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':mail.id},body:JSON.stringify({from:EMAIL_FROM,to:[mail.to_email],subject:mail.subject,html:mail.html}),signal:controller.signal});}finally{clearTimeout(timer);}if(!response.ok){throw Error(`Email provider returned HTTP ${response.status}`);}db.prepare("UPDATE mail_outbox SET state='SENT',attempts=attempts+1,last_error='' WHERE id=?").run(mail.id);sent++;}catch(err){db.prepare("UPDATE mail_outbox SET state='FAILED',attempts=attempts+1,last_error=? WHERE id=?").run(clean(err.message,140),mail.id);}}
 const latest=db.prepare("SELECT state FROM mail_outbox WHERE submission_id=? AND kind='confirmation' ORDER BY created_at DESC LIMIT 1").get(submissionId);
 if(latest)db.prepare('UPDATE submissions SET email_status=? WHERE id=?').run(latest.state,submissionId);
 return{sent,configured:MAIL_ENABLED};}
const signing=createSigning({db,dir:DATA_DIR,baseUrl:PUBLIC_BASE_URL,queueMail,sendPending,audit:(id,event)=>audit(id,event)});
const listingDrafts=createListingDrafts({db,signing,audit:(id,event)=>audit(id,event)});
function serve(res,file,contentType,isPrivate=false){try{const f=fs.readFileSync(file);res.writeHead(200,{'Content-Type':contentType,'Cache-Control':isPrivate?'private, no-store':contentType.startsWith('image/')?'public, max-age=86400':'no-store'});res.end(f);}catch{problem(res,404,'Not found');}}
function publicFile(pathname){const routes={'/':'index.html','/submit':'index.html','/admin':'admin.html','/privacy':'index.html','/terms':'index.html'};if(/^\/sign\/[a-f0-9]{64}$/.test(pathname))return path.join(root,'public','sign.html');if(routes[pathname])return path.join(root,'public',routes[pathname]);if(pathname.startsWith('/assets/')){const candidate=path.resolve(root,'public',pathname.slice(1));if(candidate.startsWith(path.join(root,'public','assets')+path.sep))return candidate;}return null;}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
function audit(id,event){db.prepare('INSERT INTO admin_events(submission_id,event,created_at) VALUES(?,?,?)').run(id,event,now());}
async function handle(req,res){
 // Keep temporary Railway staging URLs out of search engines until SHUKCHIC has its own domain.
 // Staging remains publicly reachable; noindex is not authentication or data access control.
 if(process.env.RAILWAY_ENVIRONMENT_NAME === 'staging') res.setHeader('X-Robots-Tag','noindex, nofollow');
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
 const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);const p=url.pathname;
 if(req.method==='GET'&&p==='/api/health')return json(res,200,{ok:true,service:'restyle-mvp'});
 if(req.method==='GET'&&p==='/api/admin/session')return json(res,200,{authenticated:admin(req),emailConfigured:MAIL_ENABLED,agreementConfigured:signing.enabled});
 if(req.method==='POST'&&!checkOrigin(req))return problem(res,403,'Invalid request origin.');
 // Private, expiring bearer URLs are sent only to the customer's submitted email.
 const signMatch=p.match(/^\/api\/agreements\/([a-f0-9]{64})$/);
 if(req.method==='GET'&&signMatch){const data=signing.preview(signMatch[1]);if(!data)return problem(res,404,'Agreement not found.');if(data.expired)return problem(res,410,'Agreement link expired.');return json(res,200,data);}
 if(req.method==='POST'&&signMatch){
   if(!throttle(req,'agreement_sign',10,60*60_000))return problem(res,429,'Too many attempts.');
   const body=await readJson(req,5000);const outcome=await signing.sign(signMatch[1],body,req);
   if(!outcome.ok)return problem(res,outcome.code,outcome.error);return json(res,200,outcome);
 }
 const signerPdf=p.match(/^\/api\/agreements\/([a-f0-9]{64})\/pdf$/);
 if(req.method==='GET'&&signerPdf){const f=signing.getPdfForSigner(signerPdf[1]);if(!f)return problem(res,404,'Signed PDF unavailable.');return serve(res,f,'application/pdf',true);}

 if(req.method==='POST'&&p==='/api/admin/login'){
   if(!throttle(req,'login',6,15*60_000))return problem(res,429,'Too many attempts.');
   if(!ADMIN_PASSWORD||!SESSION_SECRET)return problem(res,503,'Admin login is not configured.');
   const b=await readJson(req,2000);if(!secureEqual(b.password||'',ADMIN_PASSWORD))return problem(res,401,'Incorrect password.');
   setCookie(res,token());return json(res,200,{ok:true});
 }
 if(req.method==='POST'&&p==='/api/admin/logout'){setCookie(res,'',true);return json(res,200,{ok:true});}
 if(req.method==='POST'&&p==='/api/submissions'){
   if(!throttle(req,'submit',7,60*60_000))return problem(res,429,'Too many submissions. Please try later.');
   const b=await readJson(req);
   if(b.website) return json(res,200,{ok:true,id:'RS-RECEIVED'}); // honeypot; silently discard spam
   const first=clean(b.firstName,80),email=clean(b.email,254).toLowerCase(),phone=clean(b.phone,30),brand=clean(b.brand,100),desc=clean(b.description,1800),category=clean(b.category,60),condition=clean(b.condition,60);
   if(first.length<2||!validEmail(email)||brand.length<2||!CATEGORIES.has(category)||!CONDITIONS.has(condition)||!b.consent||!b.ownerConfirmed)return problem(res,400,'Check the required fields, ownership declaration and consent.');
   if(!Array.isArray(b.photos)||b.photos.length<1||b.photos.length>6)return problem(res,400,'Please upload between 1 and 6 photos.');
   let images;try{images=b.photos.map(parsePhoto);}catch(err){return problem(res,400,err.message);}
   const id=`RS-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
   const t=now();const created=[];
   try{db.exec('BEGIN IMMEDIATE');db.prepare('INSERT INTO submissions(id,first_name,email,phone,category,brand,condition,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,first,email,phone,category,brand,condition,desc,t,t);
   for(let i=0;i<images.length;i++){const img=images[i],pid=crypto.randomUUID(),filename=`${pid}.${img.ext}`;fs.writeFileSync(path.join(UPLOAD_DIR,filename),img.bytes,{flag:'wx',mode:0o600});created.push(filename);db.prepare('INSERT INTO photos(id,submission_id,filename,mime,size) VALUES (?,?,?,?,?)').run(pid,id,filename,img.mime,img.bytes.length);}
   audit(id,'SUBMITTED');queueMail(id,'confirmation',email,`SHUKCHIC: submission ${id} received`,emailBody(first,id));
   if(ADMIN_NOTIFY_EMAIL&&validEmail(ADMIN_NOTIFY_EMAIL))queueMail(id,'admin_notification',ADMIN_NOTIFY_EMAIL,`New SHUKCHIC submission ${id}`,`<div style="font:15px/1.6 Arial,sans-serif;max-width:580px;margin:auto;padding:24px"><img src="${PUBLIC_BASE_URL}/assets/shukchic-logo.svg?v=20261027-black80" width="180" alt="SHUKCHIC Designer Resale" style="display:block;border-radius:8px"><h2>New consignment submission</h2><p>New item to review: ${htmlEscape(brand)} (${htmlEscape(category)})</p><p>Reference: ${htmlEscape(id)}</p><p>Sign in to your SHUKCHIC admin dashboard.</p><p style="font-size:12px;color:#736c67">SHUKCHIC · DESIGNER RESALE</p></div>`);
   db.exec('COMMIT');}catch(e){try{db.exec('ROLLBACK');}catch{} for(const f of created){try{fs.unlinkSync(path.join(UPLOAD_DIR,f));}catch{}}throw e;}
   await sendPending(id);
   const recorded=db.prepare('SELECT email_status FROM submissions WHERE id=?').get(id);
   return json(res,201,{ok:true,id,emailStatus:recorded.email_status});
 }
 if(p.startsWith('/api/admin/')&&!admin(req))return problem(res,401,'Admin login required.');
 if(req.method==='GET'&&p==='/api/admin/submissions'){
   const rows=db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM photos p WHERE p.submission_id=s.id) AS photo_count FROM submissions s ORDER BY s.created_at DESC LIMIT 500`).all();return json(res,200,{items:rows});
 }
 // Authenticated listing-draft management only. No code path here publishes to eBay.
 const listingRoute=p.match(/^\/api\/admin\/submissions\/(RS-[A-F0-9]{10})\/listing(?:\/(generate|save|approve))?$/);
 if(listingRoute){
  const item=db.prepare('SELECT * FROM submissions WHERE id=?').get(listingRoute[1]);
  if(!item)return problem(res,404,'Submission not found.');
  const action=listingRoute[2];
  if(req.method==='GET'&&!action)return json(res,200,listingDrafts.inspect(item));
  if(req.method==='POST'&&action){
   if(!throttle(req,'listing_'+action,15,15*60_000))return problem(res,429,'Too many listing draft requests.');
   const body=action==='approve'?{}:await readJson(req,8000);
   if(action==='generate')return json(res,200,await listingDrafts.generate(item,body));
   if(action==='save')return json(res,200,listingDrafts.save(item,body));
   if(action==='approve')return json(res,200,listingDrafts.approve(item));
  }
  return problem(res,405,'Method not allowed.');
 }
 const detail=p.match(/^\/api\/admin\/submissions\/(RS-[A-F0-9]{10})$/);
 if(req.method==='GET'&&detail){const item=db.prepare('SELECT * FROM submissions WHERE id=?').get(detail[1]);if(!item)return problem(res,404,'Submission not found.');const photos=db.prepare('SELECT id,mime,size FROM photos WHERE submission_id=?').all(item.id);const events=db.prepare('SELECT event,created_at FROM admin_events WHERE submission_id=? ORDER BY id DESC').all(item.id);const mails=db.prepare('SELECT id,kind,state,attempts,last_error,created_at FROM mail_outbox WHERE submission_id=? ORDER BY created_at DESC').all(item.id);return json(res,200,{item,photos,events,mails,agreement:signing.state(item.id),agreementConfigured:signing.enabled,listing:listingDrafts.inspect(item)});}
 const agreementPdfMatch=p.match(/^\/api\/admin\/submissions\/(RS-[A-F0-9]{10})\/agreement\.pdf$/);
 if(req.method==='GET'&&agreementPdfMatch){const f=signing.getPdfForAdmin(agreementPdfMatch[1]);if(!f)return problem(res,404,'Signed PDF not found.');return serve(res,f,'application/pdf',true);}
 const photoMatch=p.match(/^\/api\/admin\/photos\/([0-9a-f-]{36})$/);
 if(req.method==='GET'&&photoMatch){const f=db.prepare('SELECT filename,mime FROM photos WHERE id=?').get(photoMatch[1]);if(!f)return problem(res,404,'Image not found.');res.setHeader('Cache-Control','private, no-store');return serve(res,path.join(UPLOAD_DIR,path.basename(f.filename)),f.mime,true);}
 const update=p.match(/^\/api\/admin\/submissions\/(RS-[A-F0-9]{10})\/update$/);
 if(req.method==='POST'&&update){const id=update[1];const old=db.prepare('SELECT * FROM submissions WHERE id=?').get(id);if(!old)return problem(res,404,'Submission not found.');const b=await readJson(req,10000);const status=clean(b.status||old.status,50);if(!ALLOWED_STATUSES.has(status))return problem(res,400,'Unknown status.');const verified=b.receivedVerified===undefined?old.received_verified:Number(Boolean(b.receivedVerified));
 const previousAgreement=signing.state(id);
 if(status==='ACCEPTED'&&old.status!==status&&!signing.enabled)return problem(res,409,'Set pilot agreement terms and shipping instructions before approving.');
 if(status==='REJECTED'&&previousAgreement?.state==='SIGNED')return problem(res,409,'This item has a signed agreement; handle cancellation separately.');
 if(['AWAITING_SHIPMENT','READY_TO_LIST','LISTED','SOLD','SHIPPED','PAID'].includes(status)&&previousAgreement?.state!=='SIGNED')return problem(res,409,'A signed consignment agreement is required for this stage.');
 if(['READY_TO_LIST','LISTED','SOLD','SHIPPED','PAID'].includes(status)&&!verified)return problem(res,409,'Verify physical receipt before listing this item.');const notes=clean(b.adminNotes??old.admin_notes,3000),tracking=clean(b.tracking??old.tracking,130),sku=clean(b.sku??old.sku,90),bin=clean(b.binLocation??old.bin_location,90);const estimate=b.estimateDollars===''||b.estimateDollars==null?null:Math.round(Number(b.estimateDollars)*100);if(estimate!==null&&(!Number.isFinite(estimate)||estimate<0||estimate>10_000_000))return problem(res,400,'Invalid estimate.');db.prepare('UPDATE submissions SET status=?,admin_notes=?,tracking=?,sku=?,bin_location=?,received_verified=?,estimate_cents=?,updated_at=? WHERE id=?').run(status,notes,tracking,sku,bin,verified,estimate,now(),id);audit(id,`STATUS ${old.status} → ${status}`);
 if(status!==old.status&&status==='ACCEPTED'){signing.acceptance(old);await sendPending(id);}
 if(status!==old.status&&status==='REJECTED')signing.rejection(old);
 if(status!==old.status&&['NEEDS_INFO','REJECTED'].includes(status)){
  const messages={NEEDS_INFO:['More information requested','We need a little more information to complete your assessment. Our team will contact you with the details.'],REJECTED:['Item assessment update','Thank you for submitting your item. We are unable to accept it for consignment at this time.']};
  const [subject,message]=messages[status];queueMail(id,`status_${status}`,old.email,`SHUKCHIC: ${subject} (${id})`,`<div style="font-family:Arial,sans-serif;max-width:580px;margin:auto;padding:24px"><img src="${PUBLIC_BASE_URL}/assets/shukchic-logo.svg?v=20261027-black80" alt="SHUKCHIC Designer Resale" width="180" style="display:block;border-radius:8px"><h2>${htmlEscape(subject)}</h2><p>Hi ${htmlEscape(old.first_name)},</p><p>${htmlEscape(message)}</p><p>Reference: <b>${id}</b></p><p>SHUKCHIC Team</p></div>`);
  await sendPending(id);
 }
 return json(res,200,{ok:true});}
 const retry=p.match(/^\/api\/admin\/submissions\/(RS-[A-F0-9]{10})\/resend$/);
 if(req.method==='POST'&&retry){db.prepare("UPDATE mail_outbox SET state='PENDING' WHERE submission_id=? AND state IN ('FAILED','SETUP_REQUIRED')").run(retry[1]);const r=await sendPending(retry[1]);return json(res,200,r);}
 if(req.method==='GET'){
  const file=publicFile(p);if(file){const ext=path.extname(file);return serve(res,file,mime[ext]||'application/octet-stream');}
 }
 return problem(res,404,'Not found.');
}
const server=http.createServer((req,res)=>{Promise.resolve(handle(req,res)).catch(err=>{console.error('Request failed:',err?.message);if(!res.headersSent)problem(res,err.status||500,err.status?err.message:'Unexpected server error.');else res.end();});});
server.listen(PORT,'0.0.0.0',()=>console.log(`SHUKCHIC MVP listening on ${server.address().port}`));
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0)}));