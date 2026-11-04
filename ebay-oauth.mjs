import crypto from 'node:crypto';

// OAuth is an isolated seller-authorization component. No inventory, orders,
// listing or payout API methods are called here.
// eBay uses the generated RuName in BOTH the authorize and code grant requests.
const MAPPING_SCOPE='https://api.ebay.com/oauth/api_scope/sell.inventory.mapping';
const PUBLISH_SCOPES=[
 'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
 'https://api.ebay.com/oauth/api_scope/sell.inventory',
 'https://api.ebay.com/oauth/api_scope/sell.account.readonly'
];
const SCOPES=[
 'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
 'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
 'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
 'https://api.ebay.com/oauth/api_scope/sell.finances'
];
const fail=(status,message)=>Object.assign(new Error(message),{status});
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const nameValid=v=>typeof v==='string'&&/^[A-Za-z0-9._-]{10,180}$/.test(v);
const tokenValid=v=>typeof v==='string'&&v.length>=12&&v.length<=7000;
const refreshTime=s=>Number.isSafeInteger(s)&&s>0&&s<=63072000?s:0;
const norm=v=>String(v||'').trim().toLowerCase();
const wait=async(fetcher,url,opt)=>{let response;
 try{response=await fetcher(url,{...opt,signal:AbortSignal.timeout(9000)});}
 catch{throw fail(502,'Unable to contact eBay. Please retry from the admin dashboard.');}
 let data;try{data=await response.json();}catch{
  // Log only safe transport metadata; never log token bodies, authorization codes, or credentials.
  console.error('eBay OAuth upstream non-JSON response',{status:response.status,contentType:(response.headers?.get('content-type')||'').slice(0,80)});
  throw fail(502,`eBay returned a non-JSON response (HTTP ${response.status}). Check the Railway OAuth diagnostics.`);
 }
 if(!response.ok){
  const safeCode=typeof data?.error==='string'&&/^[a-zA-Z0-9_.-]{1,70}$/.test(data.error)?data.error:'unknown';
  console.error('eBay OAuth upstream rejected request',{status:response.status,errorCode:safeCode});
  throw fail(502,`eBay rejected the authorization request (HTTP ${response.status}; error ${safeCode}).`);
 }
 return data;
};
export function createEbayOAuth({
 db,clientId=process.env.EBAY_CLIENT_ID,clientSecret=process.env.EBAY_CLIENT_SECRET,
 ruName=process.env.EBAY_RUNAME,encryptionKey=process.env.EBAY_OAUTH_ENCRYPTION_KEY,
 expectedUsername='ssammikat99u2',fetcher=fetch,clock=()=>Date.now()
}={}){
 db.exec("CREATE TABLE IF NOT EXISTS ebay_oauth_states (state_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER)");
 db.exec("CREATE TABLE IF NOT EXISTS ebay_ai_oauth_connection (id INTEGER PRIMARY KEY CHECK(id=1), seller_user_id TEXT NOT NULL,seller_username TEXT NOT NULL,token_cipher TEXT NOT NULL,access_expires_at INTEGER NOT NULL,refresh_expires_at INTEGER NOT NULL,connected_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
 db.exec("CREATE TABLE IF NOT EXISTS ebay_ai_oauth_states (state_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER)");
 db.exec("CREATE TABLE IF NOT EXISTS ebay_publish_oauth_states (state_hash TEXT PRIMARY KEY,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,consumed_at INTEGER)");
 db.exec("CREATE TABLE IF NOT EXISTS ebay_publish_oauth_connection (id INTEGER PRIMARY KEY CHECK(id=1),seller_user_id TEXT NOT NULL,seller_username TEXT NOT NULL,token_cipher TEXT NOT NULL,access_expires_at INTEGER NOT NULL,refresh_expires_at INTEGER NOT NULL,connected_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
 db.exec("CREATE TABLE IF NOT EXISTS ebay_oauth_connection (id INTEGER PRIMARY KEY CHECK(id=1), seller_user_id TEXT NOT NULL, seller_username TEXT NOT NULL, token_cipher TEXT NOT NULL, access_expires_at INTEGER NOT NULL, refresh_expires_at INTEGER NOT NULL, connected_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
 let key=null;
 try{const buf=Buffer.from(encryptionKey||'','base64url');if(buf.length===32&&typeof encryptionKey==='string'&&/^[A-Za-z0-9_-]{43}$/.test(encryptionKey))key=buf;}catch{}
 const configured=Boolean(clientId&&clientSecret&&nameValid(ruName)&&key);
 const base='https://api.ebay.com';
 function requireConfig(){if(!configured)throw fail(503,'eBay OAuth setup incomplete. Set EBAY_RUNAME and EBAY_OAUTH_ENCRYPTION_KEY in Railway.');}
 function encrypt(value){
   const iv=crypto.randomBytes(12);
   const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
   const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
   return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),ciphertext.toString('base64url')].join('.');
 }
 function decrypt(value){
   try{
     const [version,iv,tag,blob]=String(value).split('.');
     if(version!=='v1')throw Error('version');
     const dec=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64url'));
     dec.setAuthTag(Buffer.from(tag,'base64url'));
     return JSON.parse(Buffer.concat([dec.update(Buffer.from(blob,'base64url')),dec.final()]).toString('utf8'));
   }catch{throw fail(503,'Stored eBay credentials could not be decrypted. Check the encryption key.');}
 }
 function readRow(){return db.prepare('SELECT * FROM ebay_oauth_connection WHERE id=1').get()||null;}
 function status(){
   const r=readRow();
   return {configured,connected:Boolean(r),sellerUsername:r?.seller_username||null,expectedUsername,
     tokenRefreshSupported:!!(r&&key),accessTokenExpiresAt:r?new Date(r.access_expires_at).toISOString():null,
     refreshTokenExpiresAt:r?new Date(r.refresh_expires_at).toISOString():null,
     dataSyncEnabled:false,listingPublishingEnabled:false,missing: [
       ...(!clientId?['EBAY_CLIENT_ID']:[]),...(!clientSecret?['EBAY_CLIENT_SECRET']:[]),
       ...(!nameValid(ruName)?['EBAY_RUNAME']:[]),...(!key?['EBAY_OAUTH_ENCRYPTION_KEY']:[])
     ]};
 }
 function start(){
   requireConfig();
   const nonce=crypto.randomBytes(32).toString('base64url');
   const now=clock();
   db.prepare('DELETE FROM ebay_oauth_states WHERE expires_at<?').run(now);
   db.prepare('INSERT INTO ebay_oauth_states(state_hash,created_at,expires_at) VALUES (?,?,?)').run(hash(nonce),now,now+10*60_000);
   const u=new URL('https://auth.ebay.com/oauth2/authorize');
   u.searchParams.set('client_id',clientId);
   u.searchParams.set('response_type','code');
   u.searchParams.set('redirect_uri',ruName);
   u.searchParams.set('scope',SCOPES.join(' '));
   u.searchParams.set('state',nonce);
   return {authorizationUrl:u.toString(),expiresInSeconds:600};
 }
 function aiStatus(){const r=db.prepare('SELECT * FROM ebay_ai_oauth_connection WHERE id=1').get();return {connected:!!r,sellerUsername:r?.seller_username||null,configured,readOnlyPreview:true,publishingEnabled:false};}
 function startAI(){
   requireConfig();if(!readRow())throw fail(409,'Connect the standard eBay seller first.');
   const nonce=crypto.randomBytes(32).toString('base64url'),now=clock();
   db.prepare('DELETE FROM ebay_ai_oauth_states WHERE expires_at<?').run(now);
   db.prepare('INSERT INTO ebay_ai_oauth_states(state_hash,created_at,expires_at) VALUES (?,?,?)').run(hash(nonce),now,now+600000);
   const u=new URL('https://auth.ebay.com/oauth2/authorize');
   u.searchParams.set('client_id',clientId);u.searchParams.set('response_type','code');u.searchParams.set('redirect_uri',ruName);
   u.searchParams.set('scope',[...SCOPES,MAPPING_SCOPE].join(' '));u.searchParams.set('state',nonce);
   return {authorizationUrl:u.toString(),expiresInSeconds:600};
 }
 async function completeAI({state,code,error}){
   if(typeof state!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(state))throw fail(400,'Invalid authorization state.');
   const ok=db.prepare('UPDATE ebay_ai_oauth_states SET consumed_at=? WHERE state_hash=? AND consumed_at IS NULL AND expires_at>?').run(clock(),hash(state),clock());
   if(ok.changes!==1)throw fail(400,'AI authorization expired or already used.');
   if(error)throw fail(400,'AI access declined. The existing eBay connection is unchanged.');
   if(!tokenValid(code))throw fail(400,'No valid authorization code was returned.');
   const r=await requestTokens({grant_type:'authorization_code',code,redirect_uri:ruName});
   if(!tokenValid(r.access_token)||!tokenValid(r.refresh_token))throw fail(502,'Incomplete AI authorization. No changes made.');
   const user=await identity(r.access_token),main=readRow();
   if(!main||user.userId!==main.seller_user_id)throw fail(409,'AI authorization seller does not match the connected seller. Existing connection unchanged.');
   const access=refreshTime(r.expires_in),refreshLife=refreshTime(r.refresh_token_expires_in);
   if(!access||!refreshLife)throw fail(502,'Invalid AI authorization expiry information.');
   const now=clock(),stamp=new Date(now).toISOString();
   db.prepare("INSERT INTO ebay_ai_oauth_connection (id,seller_user_id,seller_username,token_cipher,access_expires_at,refresh_expires_at,connected_at,updated_at) VALUES (1,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET seller_user_id=excluded.seller_user_id,seller_username=excluded.seller_username,token_cipher=excluded.token_cipher,access_expires_at=excluded.access_expires_at,refresh_expires_at=excluded.refresh_expires_at,updated_at=excluded.updated_at")
   .run(user.userId,user.username,encrypt({accessToken:r.access_token,refreshToken:r.refresh_token}),now+access*1000,now+refreshLife*1000,stamp,stamp);
   return {connected:true,sellerUsername:user.username,ai:true};
 }
 async function getAIToken(){
   requireConfig();let row=db.prepare('SELECT * FROM ebay_ai_oauth_connection WHERE id=1').get();
   if(!row)throw fail(409,'eBay AI access not yet connected.');
   if(row.access_expires_at<=clock()+60000){
     const current=decrypt(row.token_cipher);
     if(row.refresh_expires_at<=clock()+120000)throw fail(409,'eBay AI authorization expired. Reconnect eBay AI.');
     const r=await requestTokens({grant_type:'refresh_token',refresh_token:current.refreshToken,scope:[...SCOPES,MAPPING_SCOPE].join(' ')});
     if(!tokenValid(r.access_token)||!refreshTime(r.expires_in))throw fail(502,'Unable to refresh eBay AI access.');
     const updated=encrypt({accessToken:r.access_token,refreshToken:tokenValid(r.refresh_token)?r.refresh_token:current.refreshToken});
     const result=db.prepare('UPDATE ebay_ai_oauth_connection SET token_cipher=?,access_expires_at=?,updated_at=? WHERE id=1 AND token_cipher=?').run(updated,clock()+Number(r.expires_in)*1000,new Date(clock()).toISOString(),row.token_cipher);
     if(result.changes!==1)throw fail(409,'AI token updated concurrently; retry.');
     row=db.prepare('SELECT * FROM ebay_ai_oauth_connection WHERE id=1').get();
   }
   return decrypt(row.token_cipher).accessToken;
 }
 function publishStatus(){
   const row=db.prepare('SELECT seller_username,access_expires_at,refresh_expires_at FROM ebay_publish_oauth_connection WHERE id=1').get();
   const main=readRow();
   return {connected:!!row&&!!main,sellerUsername:row?.seller_username||null,standardConnected:!!main,
    canReadPolicies:!!row,publishingEnabled:false,
    accessExpiresAt:row?new Date(row.access_expires_at).toISOString():null};
 }
 function startPublishing(){
   requireConfig();
   if(!readRow())throw fail(409,'Connect your regular eBay seller account first.');
   const nonce=crypto.randomBytes(32).toString('base64url'),now=clock();
   db.prepare('DELETE FROM ebay_publish_oauth_states WHERE expires_at<?').run(now);
   db.prepare('INSERT INTO ebay_publish_oauth_states(state_hash,created_at,expires_at) VALUES (?,?,?)').run(hash(nonce),now,now+600000);
   const u=new URL('https://auth.ebay.com/oauth2/authorize');
   u.searchParams.set('client_id',clientId);u.searchParams.set('response_type','code');u.searchParams.set('redirect_uri',ruName);
   u.searchParams.set('scope',PUBLISH_SCOPES.join(' '));u.searchParams.set('state',nonce);
   return {authorizationUrl:u.toString(),expiresInSeconds:600,publishingEnabled:false};
 }
 async function completePublishing({state,code,error}){
   if(typeof state!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(state))throw fail(400,'Invalid publishing authorization state.');
   const result=db.prepare('UPDATE ebay_publish_oauth_states SET consumed_at=? WHERE state_hash=? AND consumed_at IS NULL AND expires_at>?').run(clock(),hash(state),clock());
   if(result.changes!==1)throw fail(400,'Publishing authorization expired or already used.');
   if(error)throw fail(400,'Publishing access declined. No existing connection was changed.');
   if(!tokenValid(code))throw fail(400,'Missing eBay publishing authorization code.');
   const tokens=await requestTokens({grant_type:'authorization_code',code,redirect_uri:ruName});
   if(!tokenValid(tokens.access_token)||!tokenValid(tokens.refresh_token))throw fail(502,'Incomplete eBay publishing consent.');
   const seller=await identity(tokens.access_token),main=readRow();
   if(!main||seller.userId!==main.seller_user_id)throw fail(409,'Publishing authorization belongs to a different seller. Existing connection unchanged.');
   const accessLife=refreshTime(tokens.expires_in),refreshLife=refreshTime(tokens.refresh_token_expires_in);
   if(!accessLife||!refreshLife)throw fail(502,'Invalid authorization expiry.');
   const now=clock(),stamp=new Date(now).toISOString();
   db.prepare("INSERT INTO ebay_publish_oauth_connection (id,seller_user_id,seller_username,token_cipher,access_expires_at,refresh_expires_at,connected_at,updated_at) VALUES (1,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET seller_user_id=excluded.seller_user_id,seller_username=excluded.seller_username,token_cipher=excluded.token_cipher,access_expires_at=excluded.access_expires_at,refresh_expires_at=excluded.refresh_expires_at,updated_at=excluded.updated_at")
    .run(seller.userId,seller.username,encrypt({accessToken:tokens.access_token,refreshToken:tokens.refresh_token}),now+accessLife*1000,now+refreshLife*1000,stamp,stamp);
   return {connected:true,publishingAuthorization:true,sellerUsername:seller.username,publishingEnabled:false};
 }
 async function getPublishingToken(){
   requireConfig();
   let row=db.prepare('SELECT * FROM ebay_publish_oauth_connection WHERE id=1').get();
   if(!row)throw fail(409,'Connect eBay publishing permission first.');
   if(!readRow()||row.seller_user_id!==readRow().seller_user_id)throw fail(409,'Publishing seller does not match connected account.');
   if(row.access_expires_at<=clock()+60000){
    if(row.refresh_expires_at<=clock()+120000)throw fail(409,'Publishing permission expired. Reconnect.');
    const current=decrypt(row.token_cipher);
    const tokens=await requestTokens({grant_type:'refresh_token',refresh_token:current.refreshToken,scope:PUBLISH_SCOPES.join(' ')});
    if(!tokenValid(tokens.access_token)||!refreshTime(tokens.expires_in))throw fail(502,'Could not refresh publishing authorization.');
    const next=encrypt({accessToken:tokens.access_token,refreshToken:tokenValid(tokens.refresh_token)?tokens.refresh_token:current.refreshToken});
    const updated=db.prepare('UPDATE ebay_publish_oauth_connection SET token_cipher=?,access_expires_at=?,updated_at=? WHERE id=1 AND token_cipher=?')
     .run(next,clock()+Number(tokens.expires_in)*1000,new Date(clock()).toISOString(),row.token_cipher);
    if(updated.changes!==1)throw fail(409,'Publishing credentials changed; retry.');
    row=db.prepare('SELECT * FROM ebay_publish_oauth_connection WHERE id=1').get();
   }
   return decrypt(row.token_cipher).accessToken;
 }
 function consume(state){
   if(typeof state!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(state))throw fail(400,'Invalid authorization state. Start again from SHUKCHIC Admin.');
   const now=clock();
   const ok=db.prepare('UPDATE ebay_oauth_states SET consumed_at=? WHERE state_hash=? AND consumed_at IS NULL AND expires_at>?').run(now,hash(state),now);
   if(ok.changes!==1)throw fail(400,'Authorization link expired or already used. Start again from SHUKCHIC Admin.');
 }
 async function requestTokens(body){
   requireConfig();
   return wait(fetcher,base+'/identity/v1/oauth2/token',{
     method:'POST',
     headers:{Authorization:'Basic '+Buffer.from(clientId+':'+clientSecret).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},
     body:new URLSearchParams(body).toString()
   });
 }
 async function identity(accessToken){
   // Minimal public identity fields, and a hard match to the intended seller.
   // No authorization is persisted until this check succeeds.
   const user=await wait(fetcher,'https://apiz.ebay.com/commerce/identity/v1/user/',{
     headers:{Authorization:'Bearer '+accessToken}
   });
   const username=String(user?.username||'').trim();
   const userId=String(user?.userId||'').trim();
   if(!username||!userId||username.length>180||userId.length>180)throw fail(409,'Could not verify eBay seller identity. No account connected.');
   if(norm(username)!==norm(expectedUsername))throw fail(409,'Wrong eBay seller account. Sign in as '+expectedUsername+' instead.');
   return {username,userId};
 }
 async function complete({state,code,error}){
   consume(state); // consume even on consent rejection, and before any network call
   if(error)throw fail(400,'eBay authorization was declined. Nothing was connected.');
   if(!tokenValid(code))throw fail(400,'eBay did not return a valid authorization code.');
   const result=await requestTokens({grant_type:'authorization_code',code,redirect_uri:ruName});
   if(!tokenValid(result.access_token)||!tokenValid(result.refresh_token))throw fail(502,'eBay did not return both user access and refresh tokens. Nothing was connected.');
   const user=await identity(result.access_token);
   const accessLife=refreshTime(result.expires_in);
   const refreshLife=refreshTime(result.refresh_token_expires_in);
   if(!accessLife||!refreshLife)throw fail(502,'eBay token expiry data was invalid. Nothing was connected.');
   const now=clock(),stamp=new Date(now).toISOString();
   const secrets={accessToken:result.access_token,refreshToken:result.refresh_token};
   const encrypted=encrypt(secrets);
   db.prepare("INSERT INTO ebay_oauth_connection (id,seller_user_id,seller_username,token_cipher,access_expires_at,refresh_expires_at,connected_at,updated_at) VALUES (1,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET seller_user_id=excluded.seller_user_id,seller_username=excluded.seller_username,token_cipher=excluded.token_cipher,access_expires_at=excluded.access_expires_at,refresh_expires_at=excluded.refresh_expires_at,connected_at=excluded.connected_at,updated_at=excluded.updated_at")
     .run(user.userId,user.username,encrypted,now+accessLife*1000,now+refreshLife*1000,stamp,stamp);
   return {connected:true,sellerUsername:user.username};
 }
 async function refresh(){
   requireConfig();
   const old=readRow();if(!old)throw fail(409,'No eBay seller account is connected.');
   if(old.refresh_expires_at<=clock()+120000)throw fail(409,'eBay authorization expired. Reconnect the seller account.');
   const original=decrypt(old.token_cipher);
   if(!tokenValid(original.refreshToken))throw fail(503,'Stored refresh token is invalid.');
   const r=await requestTokens({grant_type:'refresh_token',refresh_token:original.refreshToken});
   if(!tokenValid(r.access_token)||!refreshTime(r.expires_in))throw fail(502,'eBay did not return a refreshed access token.');
   const now=clock(),next={
      accessToken:r.access_token,
      refreshToken:tokenValid(r.refresh_token)&&r.refresh_token!=='N/A'?r.refresh_token:original.refreshToken
   };
   const refreshExpiry=next.refreshToken!==original.refreshToken&&refreshTime(r.refresh_token_expires_in)?
     now+Number(r.refresh_token_expires_in)*1000:old.refresh_expires_at;
   // Optimistic concurrency: a parallel refresh must not overwrite newer credentials.
   const changed=db.prepare("UPDATE ebay_oauth_connection SET token_cipher=?,access_expires_at=?,refresh_expires_at=?,updated_at=? WHERE id=1 AND token_cipher=?")
     .run(encrypt(next),now+Number(r.expires_in)*1000,refreshExpiry,new Date(now).toISOString(),old.token_cipher);
   if(changed.changes!==1)throw fail(409,'eBay credentials changed during refresh. Retry.');
   return {refreshed:true,sellerUsername:old.seller_username};
 }
 // Internal-only retrieval. Future read-only integrations can obtain a valid
 // access token; the admin HTTP API never returns tokens or refresh secrets.
 async function getAccessToken(){
   requireConfig();
   let row=readRow();if(!row)throw fail(409,'Connect the intended eBay seller first.');
   if(row.access_expires_at<=clock()+60000){await refresh();row=readRow();}
   const secrets=decrypt(row.token_cipher);
   if(!tokenValid(secrets.accessToken))throw fail(503,'Stored eBay access token was invalid.');
   return secrets.accessToken;
 }
 async function getAppAccessToken(){const r=await requestTokens({grant_type:'client_credentials',scope:'https://api.ebay.com/oauth/api_scope'});if(!tokenValid(r.access_token))throw fail(502,'eBay application token unavailable');return r.access_token;}
 async function probe(){
   requireConfig();
   try{
     const response=await requestTokens({grant_type:'client_credentials',scope:'https://api.ebay.com/oauth/api_scope'});
     return {reachable:tokenValid(response.access_token),status:'Application token request succeeded',sellerConnected:status().connected};
   }catch(error){
     return {reachable:false,status:error.message,sellerConnected:status().connected};
   }
 }
 function disconnect(){
   db.prepare('DELETE FROM ebay_oauth_connection WHERE id=1').run();
   db.prepare('DELETE FROM ebay_oauth_states').run();
   return {disconnected:true};
 }
 return {status,start,complete,refresh,getAccessToken,getAppAccessToken,disconnect,probe,aiStatus,startAI,completeAI,getAIToken,publishStatus,startPublishing,completePublishing,getPublishingToken};
}
