import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

async function simulateApp({installed,query='?start=1'}){
 const elements=new Map();
 const element=id=>{
  if(!elements.has(id))elements.set(id,{
   id,hidden:true,textContent:'',value:'',addEventListener(){},setAttribute(){},focus(){},
   classList:{toggle(){}},querySelector(){return {disabled:false}},querySelectorAll(){return []},
   append(){},replaceChildren(){},
  });
  return elements.get(id);
 };
 const ctx={
  document:{getElementById:element,querySelectorAll(){return []},addEventListener(){},hidden:false},
  window:{matchMedia(){return {matches:installed}},addEventListener(){}},
  navigator:{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',standalone:installed,maxTouchPoints:5},
  location:{search:query},
  history:{replaceState(){}},
  URLSearchParams,URL,Intl,Image:class {},FileReader:class {},FormData:class {},fetch:async()=>({ok:true,json:async()=>({authenticated:false,onboarding:null})}),
  setInterval(){},clearInterval(){},
 };
 vm.runInNewContext(read('public/assets/merchant-app.js'),ctx,{timeout:1500});
 await new Promise(resolve=>setImmediate(resolve));
 return element;
}

test('ordinary browser visits reveal installation and hide every merchant form',async()=>{
 const e=await simulateApp({installed:false});
 assert.equal(e('merchantInstallGate').hidden,false);
 for(const id of ['merchantRegister','merchantSignIn','merchantPending','merchantActivate','merchantHome']){
  assert.equal(e(id).hidden,true,id+' should be hidden until installed');
 }
});

test('home-screen app opens registration while keeping install gate hidden',async()=>{
 const e=await simulateApp({installed:true});
 assert.equal(e('merchantRegister').hidden,false);
 assert.equal(e('merchantInstallGate').hidden,true);
});

test('partner page has merchant payout caveat and a phone graphic, not redundant hero button',()=>{
 const page=read('public/partners.html');
 const hero=page.split('<section class="partner-hero">')[1].split('</section>')[0];
 assert.doesNotMatch(hero,/class="merchant-primary"/);
 assert.match(hero,/up to 80% of eligible net sale proceeds/);
 assert.match(hero,/href="#merchant-pay-schedule"/);
 assert.match(page,/id="merchant-pay-schedule"/);
 assert.match(page,/payout timing are set in the partnership agreement/);
 assert.match(page,/class="merchant-app-install-card"/);
 assert.match(page,/merchant-app-card-phone/);
 const merchant=read('public/merchant.html');
 assert.match(merchant,/id="merchantInstallGate"/);
 assert.match(merchant,/id="merchantInstallButton"/);
 assert.match(merchant,/id="merchantRegisterForm"/);
 const app=read('public/assets/merchant-app.js');
 assert.match(app,/display-mode: standalone/);
 assert.match(app,/installedMode\(\)/);
 assert.doesNotThrow(()=>new Function(app));
});
