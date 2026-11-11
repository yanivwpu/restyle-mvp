import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('staff add-item uses a dedicated page, never the customer landing page',()=>{
 const admin=read('public/admin.html'),page=read('public/admin-new-item.html'),script=read('public/assets/admin-new-item.js'),server=read('server.mjs');
 assert.match(admin,/id="addNewItem"[^>]*href="\/admin\/new-item"/);
 assert.doesNotMatch(admin,/id="addNewItem"[^>]*target="_blank"/);
 assert.match(server,/\/admin\/new-item':'admin-new-item.html'/);
 assert.match(server,/p==='\/admin\/new-item'&&!admin\(req\)/);
 assert.match(page,/INTERNAL INVENTORY/);
 assert.doesNotMatch(page,/name="firstName"|name="email"|name="consent"|name="ownerConfirmed"/);
 assert.match(script,/fetch\('\/api\/admin\/owned-items'/);
 assert.doesNotMatch(script,/\/api\/submissions/);
 assert.doesNotThrow(()=>new Function(script));
});

test('staff-owned backend avoids consent, customer email, and fictitious signatures',()=>{
 const server=read('server.mjs'),listing=read('listing-drafts.mjs'),mapping=read('ebay-ai-mapping.mjs');
 assert.match(server,/p==='\/api\/admin\/owned-items'/);
 assert.match(server,/p\.startsWith\('\/api\/admin\/'\)&&!admin\(req\)/);
 assert.match(server,/intake_source TEXT NOT NULL DEFAULT 'CUSTOMER'/);
 assert.match(server,/ALTER TABLE submissions ADD COLUMN intake_source/);
 assert.match(server,/NOT_APPLICABLE','STAFF_OWNED'/);
 assert.match(server,/STAFF-OWNED INVENTORY CREATED - NO CUSTOMER AGREEMENT OR EMAIL/);
 assert.match(server,/old\.intake_source!=='STAFF_OWNED'&&status!==old\.status&&status==='ACCEPTED'/);
 assert.match(server,/old\.intake_source!=='STAFF_OWNED'&&status!==old\.status&&\['NEEDS_INFO','REJECTED'\]/);
 assert.match(listing,/sub\.intake_source!=='STAFF_OWNED'/);
 assert.match(listing,/warehouse_photos WHERE submission_id/);
 assert.match(mapping,/sub\.intake_source!=='STAFF_OWNED'/);
});

test('admin detail explains ownership and does not bind missing customer email action',()=>{
 const admin=read('public/assets/admin.js');
 assert.match(admin,/SHUKCHIC-owned inventory/);
 assert.match(admin,/Company-owned inventory: no customer e-signature or emails/);
 assert.match(admin,/\$\('#retryEmail'\)\?\.addEventListener/);
 assert.doesNotThrow(()=>new Function(admin));
});