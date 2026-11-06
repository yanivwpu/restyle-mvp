import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('single item UI has inline publish confirmation and no native browser dialogs',()=>{
 const html=fs.readFileSync(path.join(root,'public/admin.html'),'utf8');
 const js=fs.readFileSync(path.join(root,'public/assets/approved-listings.js'),'utf8');
 assert.match(html,/id="approvedLiveReview"/);
 assert.match(html,/id="approvedLiveConfirm"/);
 assert.match(html,/approved-batch-toolbar" hidden/);
 assert.match(js,/openLiveReview\(/);
 assert.doesNotMatch(js,/window\.(prompt|confirm)\(/);
 assert.doesNotThrow(()=>new Function(js));
});
test('separate explicit live confirmation is retained server-side',()=>{
 const js=fs.readFileSync(path.join(root,'public/assets/approved-listings.js'),'utf8');
 const service=fs.readFileSync(path.join(root,'ebay-unpublished-offers.mjs'),'utf8');
 assert.match(js,/approvedLiveConfirm/);
 assert.match(js,/confirmation:'PUBLISH_SELECTED_TO_EBAY'/);
 assert.match(service,/confirmation!=='PUBLISH_SELECTED_TO_EBAY'/);
});
