import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createEbayDeletionListener} from '../ebay-deletion.mjs';

const endpoint='https://restyle-web-staging.up.railway.app/api/ebay/account-deletion';
const token='a'.repeat(48),deletionKey='only-for-tests-and-never-a-real-secret-12345678';
const verified={configured:true,async verify(signature,raw){
 if(signature!=='signed-valid-test-event')throw Object.assign(new Error('Invalid test signature'),{status:412});
 return JSON.parse(raw.toString('utf8'));
}};
function setup(options={}){const db=new DatabaseSync(':memory:');return {db,listener:createEbayDeletionListener({db,token,endpoint,deletionKey,signatureVerifier:verified,...options})};}
const event=(id='deletion-001',identity='ebay-user-01')=>Buffer.from(JSON.stringify({metadata:{topic:'MARKETPLACE_ACCOUNT_DELETION',schemaVersion:'1.0'},notification:{notificationId:id,data:{userId:identity}}}));

test('eBay challenge matches documented SHA256 order using exact endpoint URL',()=>{
 const {db,listener}=setup();
 assert.deepEqual(listener.challenge('ABC123'),{challengeResponse:crypto.createHash('sha256').update('ABC123'+token+endpoint).digest('hex')});
 db.close();
});
test('deletion verification requires valid token and HTTPS endpoint',()=>{
 const db=new DatabaseSync(':memory:');
 for(const config of [{token:'short',endpoint},{token,endpoint:'http://localhost:3000/api/ebay/account-deletion'}]){
  const x=createEbayDeletionListener({db,deletionKey,signatureVerifier:verified,...config});
  assert.equal(x.summary().configured,false);
  assert.throws(()=>x.challenge('123'),/not ready/);
 }
 db.close();
});
test('without signing credentials and erasure key, notifications fail closed',async()=>{
 const {db,listener}=setup({deletionKey:'',signatureVerifier:{configured:false,async verify(){throw Error('Never called');}}});
 await assert.rejects(listener.receive({signature:'anything',raw:event(),contentType:'application/json'}),e=>e.status===503);
 assert.equal(listener.summary().webhookAcknowledgementsEnabled,false);
 assert.equal(db.prepare('SELECT count(*) AS n FROM ebay_deletion_notifications').get().n,0);
 db.close();
});
test('after verification, buyer PII is erased, a nonidentifying receipt retained, and tombstones block reimport',async()=>{
 const {db,listener}=setup(),now=new Date().toISOString();
 db.prepare('INSERT INTO ebay_imported_orders(order_id,buyer_user_id,raw_order_json,created_at) VALUES (?,?,?,?)').run('o1','ebay-user-01','{"buyerEmail":"private@test.invalid"}',now);
 db.prepare('INSERT INTO ebay_imported_orders(order_id,buyer_user_id,raw_order_json,created_at) VALUES (?,?,?,?)').run('o2','unrelated-user','{"keep":"safe"}',now);
 db.prepare('INSERT INTO ebay_imported_profiles(profile_id,user_id,profile_json,created_at) VALUES (?,?,?,?)').run('p1','ebay-user-01','{"name":"Private buyer"}',now);
 const result=await listener.receive({signature:'signed-valid-test-event',raw:event(),contentType:'application/json'});
 assert.equal(result.accepted,true);assert.equal(result.removed,2);
 assert.equal(db.prepare('SELECT count(*) AS n FROM ebay_imported_orders').get().n,1);
 assert.equal(db.prepare('SELECT count(*) AS n FROM ebay_imported_profiles').get().n,0);
 assert.equal(listener.isBlockedUser('ebay-user-01'),true);
 assert.equal(listener.isBlockedUser('unrelated-user'),false);
 const record=db.prepare('SELECT * FROM ebay_deletion_notifications').get();
 assert.equal(record.processing_state,'COMPLETE');assert.equal(record.signature_state,'VERIFIED');
 assert.equal(record.signed_payload,'');assert.equal(record.signature,'');
 assert.doesNotMatch(JSON.stringify(record),/Private buyer|private@test|ebay-user-01/);
 assert.equal((await listener.receive({signature:'signed-valid-test-event',raw:event(),contentType:'application/json'})).alreadyProcessed,true);
 db.close();
});
test('rejects forged signature, unsupported topic and malformed signed content before changing data',async()=>{
 const {db,listener}=setup();
 await assert.rejects(listener.receive({signature:'unsigned',raw:event(),contentType:'application/json'}),e=>e.status===412);
 const unsupported=Buffer.from(JSON.stringify({metadata:{topic:'NOT_DELETION'},notification:{notificationId:'bad-12345',data:{userId:'ebay-user-01'}}}));
 await assert.rejects(listener.receive({signature:'signed-valid-test-event',raw:unsupported,contentType:'application/json'}),/Unsupported topic/);
 await assert.rejects(listener.receive({signature:'signed-valid-test-event',raw:Buffer.from('{invalid'),contentType:'application/json'}),/Unexpected token|Expected property name|not valid JSON/);
 assert.equal(db.prepare('SELECT count(*) AS n FROM ebay_deletion_notifications').get().n,0);
 db.close();
});
