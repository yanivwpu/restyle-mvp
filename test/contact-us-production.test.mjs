import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('public website exposes working accessible Contact Us form',()=>{
 const html=read('public/index.html'),js=read('public/assets/main.js');
 assert.match(html,/id="contact"/);
 assert.match(html,/id="contactForm"/);
 assert.match(html,/name="email"/);
 assert.match(html,/name="message"/);
 assert.match(html,/href="\/#contact"/);
 assert.match(js,/fetch\('\/api\/contact'/);
 assert.doesNotThrow(()=>new Function(js));
});
test('server persists contact inquiries and staff can read them only after auth',()=>{
 const server=read('server.mjs'),admin=read('public/admin.html'),script=read('public/assets/contact-admin.js');
 assert.match(server,/CREATE TABLE IF NOT EXISTS contact_messages/);
 assert.match(server,/p==='\/api\/contact'/);
 assert.match(server,/p==='\/api\/admin\/contact'/);
 assert.match(server,/if\(!admin\(req\)\)return problem\(res,401/);
 assert.match(server,/ADMIN_NOTIFY_EMAIL/);
 assert.match(admin,/id="contactInboxPanel"/);
 assert.match(script,/\/api\/admin\/contact/);
 assert.doesNotThrow(()=>new Function(script));
});
test('public eBay shopping link uses current SHUKCHIC seller identity',()=>{
 const html=read('public/index.html');
 assert.match(html,/https:\/\/www\.ebay\.com\/usr\/shukchic/);
 assert.doesNotMatch(html,/_ssn=ssammikat99u2/);
});

test('contact notifications retain safe provider diagnostics for staff',()=>{
 const server=read('server.mjs'),staff=read('public/assets/contact-admin.js');
 assert.match(server,/ALTER TABLE contact_messages ADD COLUMN email_error/);
 assert.match(server,/Resend HTTP /);
 assert.match(server,/response\.status/);
 assert.match(server,/SELECT id,name,email,topic,message,created_at,email_status,email_error/);
 assert.match(staff,/message\.email_error/);
 assert.doesNotMatch(server,/diagnostic\s*=\s*await response\.text\(/);
 assert.doesNotThrow(()=>new Function(staff));
});
