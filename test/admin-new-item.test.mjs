import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('admin offers dedicated authenticated inventory entry while preserving customer intake',()=>{
 const html=fs.readFileSync(path.join(root,'public/admin.html'),'utf8');
 const server=fs.readFileSync(path.join(root,'server.mjs'),'utf8');
 const customer=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
 assert.match(html,/<a id="addNewItem"[^>]+href="\/admin\/new-item"/);
 assert.match(html,/Add New Item/);
 assert.match(server,/['"]\/submit['"]\s*:\s*['"]index\.html['"]/);
 assert.match(server,/p==='\/api\/submissions'/);
 assert.match(customer,/id="submitForm"/);
 assert.match(customer,/name="category"/);
 assert.match(customer,/name="brand"/);
 assert.match(server,/p===\x27\/api\/admin\/owned-items\x27/);
});
