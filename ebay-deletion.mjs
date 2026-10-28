import crypto from 'node:crypto';
import {createEbaySignatureVerifier} from './ebay-signature.mjs';

const forbidden = () => Object.assign(new Error('eBay deletion endpoint not ready'),{status:503});
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
const tokenOK=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{32,80}$/.test(s);
const urlOK=s=>{try{const u=new URL(s);return u.protocol==='https:'&&!u.search&&!u.hash&&!u.username&&!u.password&&u.pathname==='/api/ebay/account-deletion'&&u.hostname!=='localhost';}catch{return false;}};
const validID=x=>typeof x==='string'&&x.length>=1&&x.length<=180;
export function createEbayDeletionListener({
 db,
 token=process.env.EBAY_DELETION_VERIFICATION_TOKEN,
 endpoint=process.env.EBAY_DELETION_ENDPOINT,
 deletionKey=process.env.EBAY_DATA_ERASURE_KEY,
 signatureVerifier=createEbaySignatureVerifier()
}){
 // Only these eBay-owned data tables may be used for future imports.
 // Any additional eBay PII storage must be added to this deletion transaction
 // and explicitly reviewed BEFORE the corresponding importer is enabled.
 db.exec("CREATE TABLE IF NOT EXISTS ebay_imported_orders (order_id TEXT PRIMARY KEY,buyer_user_id TEXT,buyer_eias_token TEXT,buyer_username TEXT,seller_user_id TEXT,raw_order_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL)");
 db.exec("CREATE TABLE IF NOT EXISTS ebay_imported_profiles (profile_id TEXT PRIMARY KEY,user_id TEXT,eias_token TEXT,username TEXT,profile_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL)");
 db.exec("CREATE TABLE IF NOT EXISTS ebay_deletion_tombstones (identity_fingerprint TEXT PRIMARY KEY,deleted_at TEXT NOT NULL)");
 db.exec("CREATE TABLE IF NOT EXISTS ebay_deletion_notifications (notification_id TEXT PRIMARY KEY,received_at TEXT NOT NULL,signature TEXT NOT NULL,signed_payload TEXT NOT NULL,signature_state TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',processing_state TEXT NOT NULL DEFAULT 'BLOCKED_PENDING_VERIFICATION',verified_at TEXT,handled_at TEXT)");
 const configured=tokenOK(token)&&urlOK(endpoint);
 const deletionEnabled=typeof deletionKey==='string'&&deletionKey.length>=32&&signatureVerifier.configured;
 function fingerprint(v){return crypto.createHmac('sha256',deletionKey).update('ebay:'+v).digest('hex');}
 function challenge(code){
  if(!configured)throw forbidden();
  if(typeof code!=='string'||code.length<1||code.length>512)throw bad('Missing or invalid challenge_code.');
  return {challengeResponse:crypto.createHash('sha256').update(code+token+endpoint,'utf8').digest('hex')};
 }
 function isBlockedUser(id){if(!deletionEnabled)throw forbidden();if(!validID(id))return false;
  return Boolean(db.prepare('SELECT 1 FROM ebay_deletion_tombstones WHERE identity_fingerprint=?').get(fingerprint(id)));
 }
 async function receive({signature,raw,contentType}){
  if(!configured||!deletionEnabled)throw forbidden();
  if(!/^application\/json(?:\s*;|$)/i.test(contentType||''))throw bad('JSON content required.',415);
  if(!Buffer.isBuffer(raw)||raw.length===0||raw.length>65536)throw bad('Invalid notification size.',413);
  // Reject forged, invalid and unresolvable eBay signatures before any database write.
  const obj=await signatureVerifier.verify(signature,raw);
  if(obj?.metadata?.topic!=='MARKETPLACE_ACCOUNT_DELETION')throw bad('Unsupported topic.');
  const id=obj?.notification?.notificationId;
  if(typeof id!=='string'||id.length<5||id.length>190||!/^[A-Za-z0-9._:-]+$/.test(id))throw bad('Invalid notification identifier.');
  const data=obj?.notification?.data;
  const identities=[data?.userId,data?.eiasToken,data?.username].filter(validID);
  if(identities.length===0)throw bad('Account deletion identifier required.');
  const when=new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try{
   if(db.prepare('SELECT 1 FROM ebay_deletion_notifications WHERE notification_id=? AND processing_state=?').get(id,'COMPLETE')){
    db.exec('COMMIT');return {accepted:true,alreadyProcessed:true};
   }
   // Buyer or seller identities: do not leave copied JSON or snapshots behind.
   let removed=0;
   for(const identity of identities){
    removed+=db.prepare('DELETE FROM ebay_imported_orders WHERE buyer_user_id=? OR buyer_eias_token=? OR buyer_username=? OR seller_user_id=?').run(identity,identity,identity,identity).changes;
    removed+=db.prepare('DELETE FROM ebay_imported_profiles WHERE user_id=? OR eias_token=? OR username=?').run(identity,identity,identity).changes;
    db.prepare('INSERT OR IGNORE INTO ebay_deletion_tombstones (identity_fingerprint,deleted_at) VALUES (?,?)').run(fingerprint(identity),when);
   }
   // Store only a completion receipt, not the unencrypted webhook or user ID.
   db.prepare("INSERT INTO ebay_deletion_notifications (notification_id,received_at,signature,signed_payload,signature_state,processing_state,verified_at,handled_at) VALUES (?,?,'','','VERIFIED','COMPLETE',?,?) ON CONFLICT(notification_id) DO UPDATE SET signature='',signed_payload='',signature_state='VERIFIED',processing_state='COMPLETE',handled_at=excluded.handled_at,verified_at=excluded.verified_at").run(id,when,when,when);
   db.exec('COMMIT');
   return {accepted:true,removed};
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 function summary(){
  const pending=db.prepare("SELECT count(*) AS n FROM ebay_deletion_notifications WHERE processing_state!='COMPLETE'").get().n;
  return {configured,queuedForVerification:pending,signatureVerificationEnabled:signatureVerifier.configured,webhookAcknowledgementsEnabled:configured&&deletionEnabled,ebayDataImportAllowed:false};
 }
 return {challenge,receive,summary,isBlockedUser};
}
