import crypto from 'node:crypto';

// Matches eBay's official Event Notification Node SDK signature envelope:
// base64(JSON.stringify({kid,signature})), where signature is base64 ECC
// signed over JSON.stringify(notificationPayload) using SHA-1.
// eBay SDK: https://github.com/eBay/event-notification-nodejs-sdk
const fail=(message,status=503)=>Object.assign(new Error(message),{status});
const tokens=new Map(),keys=new Map();
const api='https://api.ebay.com';
const scope='https://api.ebay.com/oauth/api_scope';
function envelope(value){
 if(typeof value!=='string'||value.length<24||value.length>2048||!(/^[A-Za-z0-9+/=]+$/).test(value))throw fail('Missing or invalid eBay signature.',412);
 let h;try{h=JSON.parse(Buffer.from(value,'base64').toString('utf8'));}catch{throw fail('Invalid eBay signature envelope.',412);}
 if(typeof h?.kid!=='string'||!(/^[A-Za-z0-9._-]{1,180}$/).test(h.kid)||typeof h.signature!=='string'||!(/^[A-Za-z0-9+/=]{20,1024}$/).test(h.signature))throw fail('Invalid eBay signature envelope.',412);
 return h;
}
async function requestJSON(fetchImpl,url,options={}){
 let result;
 try{result=await fetchImpl(url,{...options,signal:AbortSignal.timeout(7000)});}catch{throw fail('eBay signature verification service temporarily unavailable.');}
 if(!result.ok)throw fail('eBay signature verification service returned an error.');
 try{return await result.json();}catch{throw fail('eBay signature verification response invalid.');}
}
function pem(key){
 if(typeof key!=='string'||key.length>12000||!key.includes('-----BEGIN PUBLIC KEY-----')||!key.includes('-----END PUBLIC KEY-----'))throw fail('eBay public key response invalid.');
 const raw=key.slice(key.indexOf('-----BEGIN PUBLIC KEY-----')+'-----BEGIN PUBLIC KEY-----'.length,key.indexOf('-----END PUBLIC KEY-----')).replace(/\s/g,'');
 if(!/^[A-Za-z0-9+/=]+$/.test(raw))throw fail('eBay public key has invalid encoding.');
 return '-----BEGIN PUBLIC KEY-----\n'+raw.match(/.{1,64}/g).join('\n')+'\n-----END PUBLIC KEY-----\n';
}
export function createEbaySignatureVerifier({clientId=process.env.EBAY_CLIENT_ID,clientSecret=process.env.EBAY_CLIENT_SECRET,fetchImpl=fetch}={}){
 const configured=Boolean(clientId&&clientSecret&&clientId.length>6&&clientSecret.length>6);
 async function accessToken(){
  const key=clientId;
  const cached=tokens.get(key);if(cached&&cached.until>Date.now())return cached.value;
  const payload=new URLSearchParams({grant_type:'client_credentials',scope});
  const auth=Buffer.from(clientId+':'+clientSecret).toString('base64');
  const r=await requestJSON(fetchImpl,api+'/identity/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+auth,'Content-Type':'application/x-www-form-urlencoded'},body:payload.toString()});
  if(typeof r.access_token!=='string'||r.access_token.length<10)throw fail('eBay access token missing.');
  tokens.set(key,{value:r.access_token,until:Date.now()+Math.min(600000,Math.max(60,(r.expires_in||600)-60)*1000)});
  return r.access_token;
 }
 async function publicKey(kid){
  const id=clientId+':'+kid;const cached=keys.get(id);
  if(cached&&cached.until>Date.now())return cached.value;
  const bearer=await accessToken();
  const result=await requestJSON(fetchImpl,api+'/commerce/notification/v1/public_key/'+encodeURIComponent(kid),{headers:{Authorization:'Bearer '+bearer}});
  const value=pem(result.key);
  keys.set(id,{value,until:Date.now()+3600000});
  return value;
 }
 async function verify(header,raw){
  if(!configured)throw fail('eBay app credentials required before signature verification.');
  if(!Buffer.isBuffer(raw)||raw.length===0||raw.length>65536)throw fail('Invalid signature payload.',413);
  const {kid,signature}=envelope(header);
  let body;try{body=JSON.parse(raw.toString('utf8'));}catch{throw fail('Invalid JSON payload.',400);}
  const key=await publicKey(kid);
  // Official SDK verifies JSON.stringify(parsed payload), not the raw body bytes.
  let valid=false;
  try{
   const verifier=crypto.createVerify('sha1');
   verifier.update(JSON.stringify(body));
   valid=verifier.verify(key,Buffer.from(signature,'base64'));
  }catch{throw fail('eBay ECC signature could not be validated.',412);}
  if(!valid)throw fail('eBay signature verification failed.',412);
  return body;
 }
 return {configured,verify};
}
