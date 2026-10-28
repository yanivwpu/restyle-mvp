import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createEbaySignatureVerifier} from '../ebay-signature.mjs';

const {publicKey,privateKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const clientId='production-id-for-test-only',clientSecret='test-secret-not-real',kid='mock-public-key-id';
const publicPEM=publicKey.export({type:'spki',format:'pem'}).toString();
let tokenCalls=0,keyCalls=0;
async function fakeFetch(url){
 if(url.endsWith('/identity/v1/oauth2/token')){tokenCalls++;return {ok:true,json:async()=>({access_token:'mock-access-token-long-enough',expires_in:7200})};}
 if(url.endsWith('/commerce/notification/v1/public_key/'+kid)){keyCalls++;return {ok:true,json:async()=>({key:publicPEM})};}
 return {ok:false,status:404};
}
const verifier=createEbaySignatureVerifier({clientId,clientSecret,fetchImpl:fakeFetch});
function signed(body,{digest='SHA256',override}={}){
 const text=JSON.stringify(body);
 const signature=crypto.createSign(digest==='SHA256'?'sha256':'sha1').update(text).sign(privateKey,'base64');
 return Buffer.from(JSON.stringify({alg:'ecdsa',kid,digest,signature:override||signature})).toString('base64');
}
const event=()=>({metadata:{topic:'MARKETPLACE_ACCOUNT_DELETION',schemaVersion:'1.0'},notification:{notificationId:'demo-notification-01',data:{userId:'test-user-001'}}});

test('verifies eBay ECC notification signature using SHA256 and cached public key',async()=>{
 const data=event(),raw=Buffer.from(JSON.stringify(data));
 assert.deepEqual(await verifier.verify(signed(data),raw),data);
 assert.deepEqual(await verifier.verify(signed(data),raw),data);
 assert.equal(tokenCalls,1);assert.equal(keyCalls,1);
});
test('rejects tampered payloads and malformed signature header before processing',async()=>{
 const data=event();
 await assert.rejects(verifier.verify(signed(data),Buffer.from(JSON.stringify({...data,notification:{...data.notification,notificationId:'tampered'}}))),e=>e.status===412);
 await assert.rejects(verifier.verify('not-a-valid-ebay-signature',Buffer.from(JSON.stringify(data))),e=>e.status===412);
});
test('supports legacy signature digest from eBay SDK',async()=>{
 const data=event();
 assert.deepEqual(await verifier.verify(signed(data,{digest:'SHA1'}),Buffer.from(JSON.stringify(data))),data);
});
test('does not allow verification without private application credentials',async()=>{
 const empty=createEbaySignatureVerifier({clientId:'',clientSecret:'',fetchImpl:fakeFetch});
 await assert.rejects(empty.verify(signed(event()),Buffer.from(JSON.stringify(event()))),e=>e.status===503);
});
