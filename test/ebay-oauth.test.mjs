import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createEbayOAuth} from '../ebay-oauth.mjs';
const cred={clientId:'example-production-client-id',clientSecret:'example-production-client-secret',ruName:'Samantha-SHUKCHIC-PRD-example-ruName',encryptionKey:crypto.randomBytes(32).toString('base64url')};
const access='example-access-token-1234567890',refresh='example-refresh-token-1234567890';
function setup({username='shukchic',failIdentity=false}={}){
 const db=new DatabaseSync(':memory:');
 let now=Date.parse('2026-10-28T00:00:00.000Z'),posts=[],calls=[];
 const fetcher=async (url,opts)=>{
  calls.push({url,method:opts.method||'GET'});
  if(url.endsWith('/identity/v1/oauth2/token')){
   const b=new URLSearchParams(opts.body);posts.push(b);
   return {ok:true,json:async()=>b.get('grant_type')==='refresh_token'?
     {access_token:'refreshed-access-token-123456789',expires_in:3600}:
     {access_token:access,refresh_token:refresh,expires_in:7200,refresh_token_expires_in:47304000}};
  }
  if(url.endsWith('/commerce/identity/v1/user/')){
   if(failIdentity)return {ok:false,json:async()=>({})};
   return {ok:true,json:async()=>({username,userId:'u-seller-001'})};
  }
  throw Error('Unexpected external request '+url);
 };
 const oauth=createEbayOAuth({db,...cred,fetcher,clock:()=>now});
 return {db,oauth,posts,calls,advance(ms){now+=ms;}};
}
function state(s){return new URL(s.authorizationUrl).searchParams.get('state');}
test('OAuth is disabled with missing Production RuName or encryption key',()=>{
 const db=new DatabaseSync(':memory:');
 for(const props of [{...cred,ruName:''},{...cred,encryptionKey:''}]){
  const o=createEbayOAuth({db,...props});
  assert.equal(o.status().configured,false);
  assert.throws(()=>o.start(),e=>e.status===503);
 }
 db.close();
});
test('OAuth start uses eBay Production RuName and read-only scope; state is SHA-256 hashed and expires in ten minutes',()=>{
 const {db,oauth,advance}=setup();
 const data=oauth.start(),url=new URL(data.authorizationUrl);
 assert.equal(url.origin,'https://auth.ebay.com');
 assert.equal(url.searchParams.get('redirect_uri'),cred.ruName);
 assert.equal(url.searchParams.get('response_type'),'code');
 assert.ok(url.searchParams.get('scope').includes('sell.fulfillment.readonly'));
 assert.ok(url.searchParams.get('scope').includes('commerce.identity.readonly'));
 assert.ok(!url.searchParams.get('scope').includes('sell.inventory '));
 assert.equal(state(data).length,43);
 assert.doesNotMatch(JSON.stringify(db.prepare('SELECT * FROM ebay_oauth_states').get()),new RegExp(state(data)));
 advance(600001);
 db.close();
});
test('valid consent verifies seller before storing AES-GCM encrypted tokens, rejects replay',async()=>{
 const {db,oauth,posts}=setup();
 const nonce=state(oauth.start());
 const result=await oauth.complete({state:nonce,code:'ebay-one-use-code-123456789'});
 assert.equal(result.connected,true);
 assert.equal(oauth.status().sellerUsername,'shukchic');
 const row=db.prepare('SELECT * FROM ebay_oauth_connection').get();
 assert.equal(row.seller_user_id,'u-seller-001');
 assert.equal(row.token_cipher.startsWith('v1.'),true);
 assert.doesNotMatch(JSON.stringify(row),/example-refresh-token|example-access-token|ebay-one-use-code/);
 assert.equal(posts[0].get('redirect_uri'),cred.ruName);
 assert.equal(posts[0].get('grant_type'),'authorization_code');
 await assert.rejects(oauth.complete({state:nonce,code:'ebay-one-use-code-123456789'}),e=>e.status===400);
 assert.equal(oauth.status().dataSyncEnabled,false);
 assert.equal(oauth.status().listingPublishingEnabled,false);
 db.close();
});
test('renamed seller reconnect succeeds only when immutable seller ID matches',async()=>{
 const {db,oauth}=setup({username:'shukchic'});
 await oauth.complete({state:state(oauth.start()),code:'ebay-first-code-123456789'});
 db.prepare("UPDATE ebay_oauth_connection SET seller_username='ssammikat99u2' WHERE id=1").run();
 const renewed=await oauth.complete({state:state(oauth.start()),code:'ebay-second-code-123456789'});
 assert.equal(renewed.connected,true);
 assert.equal(oauth.status().sellerUsername,'shukchic');
 assert.equal(db.prepare('SELECT seller_user_id FROM ebay_oauth_connection WHERE id=1').get().seller_user_id,'u-seller-001');
 db.close();
});
test('renamed username must not bypass existing seller ID mismatch',async()=>{
 const {db,oauth}=setup({username:'shukchic'});
 await oauth.complete({state:state(oauth.start()),code:'ebay-first-code-123456789'});
 db.prepare("UPDATE ebay_oauth_connection SET seller_user_id='another-seller',seller_username='ssammikat99u2' WHERE id=1").run();
 await assert.rejects(oauth.complete({state:state(oauth.start()),code:'ebay-second-code-123456789'}),e=>e.status===409);
 assert.equal(db.prepare('SELECT seller_user_id FROM ebay_oauth_connection WHERE id=1').get().seller_user_id,'another-seller');
 db.close();
});
test('wrong eBay username never persists tokens or a linked seller',async()=>{
 const {db,oauth}=setup({username:'wrong-account'});
 await assert.rejects(oauth.complete({state:state(oauth.start()),code:'ebay-one-use-code-123456789'}),e=>e.status===409);
 assert.equal(oauth.status().connected,false);
 db.close();
});
test('expired or fabricated state is rejected before contacting eBay',async()=>{
 const {db,oauth,advance,calls}=setup();
 const nonce=state(oauth.start());
 await assert.rejects(oauth.complete({state:'A'.repeat(43),code:'ebay-one-use-code-123456789'}),e=>e.status===400);
 advance(600001);
 await assert.rejects(oauth.complete({state:nonce,code:'ebay-one-use-code-123456789'}),e=>e.status===400);
 assert.equal(calls.length,0);
 db.close();
});
test('encrypted refresh token can be renewed without rotating durable token or leaking secret',async()=>{
 const {db,oauth,posts}=setup();
 await oauth.complete({state:state(oauth.start()),code:'ebay-one-use-code-123456789'});
 const before=db.prepare('SELECT * FROM ebay_oauth_connection').get();
 const ret=await oauth.refresh();
 assert.equal(ret.refreshed,true);
 const after=db.prepare('SELECT * FROM ebay_oauth_connection').get();
 assert.notEqual(after.token_cipher,before.token_cipher);
 assert.equal(after.refresh_expires_at,before.refresh_expires_at);
 assert.equal(posts.at(-1).get('grant_type'),'refresh_token');
 assert.equal(posts.at(-1).get('refresh_token'),refresh);
 assert.equal(oauth.status().connected,true);
 assert.deepEqual(oauth.disconnect(),{disconnected:true});
 assert.equal(oauth.status().connected,false);
 db.close();
});
test('internal access token automatically renews only when close to expiry',async()=>{
 const {db,oauth,advance,posts}=setup();
 await oauth.complete({state:state(oauth.start()),code:'ebay-one-use-code-123456789'});
 assert.equal(await oauth.getAccessToken(),access);
 assert.equal(posts.length,1,'No early refresh while access token is valid');
 advance(7200*1000-30000);
 assert.equal(await oauth.getAccessToken(),'refreshed-access-token-123456789');
 assert.equal(posts.length,2);
 db.close();
});
test('cannot connect when eBay identity API fails; state is consumed',async()=>{
 const {db,oauth}=setup({failIdentity:true});
 const nonce=state(oauth.start());
 await assert.rejects(oauth.complete({state:nonce,code:'ebay-one-use-code-123456789'}),e=>e.status===502);
 assert.equal(oauth.status().connected,false);
 await assert.rejects(oauth.complete({state:nonce,code:'ebay-one-use-code-123456789'}),e=>e.status===400);
 db.close();
});


test('publishing consent is separate, seller-verified, non-publishing, and revokes on disconnect',async()=>{
 const {db,oauth,posts}=setup();
 assert.equal(oauth.publishStatus().connected,false);
 assert.throws(()=>oauth.startPublishing(),e=>e.status===409);
 await oauth.complete({state:state(oauth.start()),code:'ebay-one-use-code-123456789'});
 const standard=db.prepare('SELECT token_cipher FROM ebay_oauth_connection WHERE id=1').get().token_cipher;
 const start=oauth.startPublishing(),url=new URL(start.authorizationUrl);
 assert(url.searchParams.get('scope').includes('sell.inventory'));
 assert(url.searchParams.get('scope').includes('sell.account.readonly'));
 assert.equal(start.publishingEnabled,false);
 const id=state(start);
 const response=await oauth.completePublishing({state:id,code:'ebay-publish-code-123456789'});
 assert.equal(response.publishingEnabled,false);
 assert.equal(oauth.publishStatus().connected,true);
 assert.equal(db.prepare('SELECT token_cipher FROM ebay_oauth_connection WHERE id=1').get().token_cipher,standard);
 assert.equal(await oauth.getPublishingToken(),access);
 assert.equal(posts.at(-1).get('grant_type'),'authorization_code');
 await assert.rejects(oauth.completePublishing({state:id,code:'ebay-publish-code-123456789'}),e=>e.status===400);
 assert.equal(oauth.disconnect().disconnected,true);
 assert.equal(oauth.publishStatus().connected,false);
 assert.equal(db.prepare('SELECT * FROM ebay_publish_oauth_connection').get(),undefined);
 db.close();
});
test('wrong eBay seller cannot authorize publishing over a connected account',async()=>{
 const {db,oauth}=setup();
 await oauth.complete({state:state(oauth.start()),code:'ebay-one-use-code-123456789'});
 db.prepare("UPDATE ebay_oauth_connection SET seller_user_id='another-seller' WHERE id=1").run();
 await assert.rejects(oauth.completePublishing({state:state(oauth.startPublishing()),code:'ebay-publish-code-123456789'}),e=>e.status===409);
 assert.equal(oauth.publishStatus().connected,false);
 db.close();
});
