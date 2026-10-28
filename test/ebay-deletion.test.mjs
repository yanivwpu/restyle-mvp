import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createEbayDeletionListener} from '../ebay-deletion.mjs';

const endpoint='https://restyle-web-staging.up.railway.app/api/ebay/account-deletion';
const token='a'.repeat(48);
function setup(){const db=new DatabaseSync(':memory:');return {db,listener:createEbayDeletionListener({db,token,endpoint})};}

test('eBay challenge matches documented SHA256 order using exact endpoint URL',()=>{
 const {db,listener}=setup();
 assert.deepEqual(listener.challenge('ABC123'),{challengeResponse:crypto.createHash('sha256').update('ABC123'+token+endpoint).digest('hex')});
 db.close();
});
test('deletion verification requires valid token and HTTPS endpoint and never leaks configuration',()=>{
 const db=new DatabaseSync(':memory:');
 for(const config of [{token:'short',endpoint},{token,endpoint:'http://localhost:3000/api/ebay/account-deletion'}]){
  const x=createEbayDeletionListener({db,...config});
  assert.equal(x.summary().configured,false);
  assert.throws(()=>x.challenge('123'),/not configured/);
 }
 db.close();
});
test('unverified deletion notifications are rejected without queueing or false acknowledgement',()=>{
 const {db,listener}=setup();
 const payload=Buffer.from(JSON.stringify({metadata:{topic:'MARKETPLACE_ACCOUNT_DELETION',schemaVersion:'1.0'},notification:{notificationId:'notification-001',data:{userId:'seller-001'}}}));
 const signed=Buffer.from('some-signature-object').toString('base64');
 assert.throws(()=>listener.receive({signature:signed,raw:payload,contentType:'application/json'}),e=>e.status===503);
 assert.equal(listener.summary().queuedForVerification,0);
 assert.equal(listener.summary().webhookAcknowledgementsEnabled,false);
 assert.equal(listener.summary().signatureVerificationEnabled,false);
 assert.equal(db.prepare('SELECT count(*) AS n FROM ebay_deletion_notifications').get().n,0);
 db.close();
});
test('malformed, unsigned and unsupported eBay deletion messages are rejected',()=>{
 const {db,listener}=setup();
 const data=Buffer.from(JSON.stringify({metadata:{topic:'INCORRECT'},notification:{notificationId:'test-001',data:{userId:'u'}}}));
 assert.throws(()=>listener.receive({signature:'',raw:data,contentType:'application/json'}),/signature/i);
 assert.throws(()=>listener.receive({signature:'Zm9vYmFyLXNhbXBsZQ==',raw:data,contentType:'application/json'}),/Unsupported topic/);
 assert.throws(()=>listener.receive({signature:'Zm9vYmFyLXNhbXBsZQ==',raw:Buffer.from('{bad'),contentType:'application/json'}),/Invalid JSON/);
 assert.equal(listener.summary().queuedForVerification,0);
 db.close();
});
