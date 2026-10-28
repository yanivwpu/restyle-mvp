import crypto from 'node:crypto';

const forbidden = () => Object.assign(new Error('eBay deletion notification endpoint not configured'),{status:503});
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
const tokenOK=s=>typeof s==='string' && /^[A-Za-z0-9_-]{32,80}$/.test(s);
const urlOK=s=>{try{const u=new URL(s);return u.protocol==='https:'&&!u.search&&!u.hash&&!u.username&&!u.password&&u.pathname==='/api/ebay/account-deletion'&&u.hostname!=='localhost';}catch{return false;}};
export function createEbayDeletionListener({db,token=process.env.EBAY_DELETION_VERIFICATION_TOKEN,endpoint=process.env.EBAY_DELETION_ENDPOINT}){
  db.exec("CREATE TABLE IF NOT EXISTS ebay_deletion_notifications (notification_id TEXT PRIMARY KEY,received_at TEXT NOT NULL,signature TEXT NOT NULL,signed_payload TEXT NOT NULL,signature_state TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',processing_state TEXT NOT NULL DEFAULT 'BLOCKED_PENDING_VERIFICATION',verified_at TEXT,handled_at TEXT)");
  const configured=tokenOK(token)&&urlOK(endpoint);
  function challenge(code){
    if(!configured)throw forbidden();
    if(typeof code!=='string'||code.length<1||code.length>512)throw bad('Missing or invalid challenge_code.');
    return {challengeResponse:crypto.createHash('sha256').update(code+token+endpoint,'utf8').digest('hex')};
  }
  function receive({signature,raw,contentType}){
    if(!configured)throw forbidden();
    if(!/^application\/json(?:\s*;|$)/i.test(contentType||''))throw bad('JSON content required.',415);
    if(typeof signature!=='string'||signature.length<12||signature.length>2048||!/^[A-Za-z0-9+/=_-]+$/.test(signature))throw bad('eBay signature required.',412);
    if(!Buffer.isBuffer(raw)||raw.length===0||raw.length>65536)throw bad('Invalid notification size.',413);
    let obj;try{obj=JSON.parse(raw.toString('utf8'));}catch{throw bad('Invalid JSON.');}
    if(obj?.metadata?.topic!=='MARKETPLACE_ACCOUNT_DELETION')throw bad('Unsupported topic.');
    const id=obj?.notification?.notificationId;
    if(typeof id!=='string'||id.length<5||id.length>190||!/^[A-Za-z0-9._:-]+$/.test(id))throw bad('Invalid notification identifier.');
    const data=obj?.notification?.data;
    if(!data||typeof data!=='object'||(!data.userId&&!data.eiasToken&&!data.username))throw bad('Deletion identifier missing.');
    // eBay requires ECC signature verification AND actual deletion processing.
    // Until both are implemented, fail closed so eBay retries instead of recording
    // an acknowledgement for a request the service cannot yet fulfill.
    // In particular never store an unverified identity or return 2xx here.
    throw bad('eBay signature verification and deletion processing are not active.',503);
  }
  function summary(){
    const pending=db.prepare("SELECT count(*) AS n FROM ebay_deletion_notifications WHERE processing_state!='COMPLETE'").get().n;
    return {configured,queuedForVerification:pending,signatureVerificationEnabled:false,webhookAcknowledgementsEnabled:false,ebayDataImportAllowed:false};
  }
  return {challenge,receive,summary};
}
