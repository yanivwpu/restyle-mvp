import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

async function simulateApp({installed,query='?start=1',userAgent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'}){
 const elements=new Map(),windowListeners={};
 const element=id=>{
  if(!elements.has(id)){
   const listeners={};
   elements.set(id,{
    id,hidden:true,textContent:'',value:'',attributes:{},
    addEventListener(n,cb){listeners[n]=cb},
    async dispatch(n='click'){assert.ok(listeners[n],id+' has no '+n+' listener');return listeners[n]({preventDefault(){},currentTarget:this})},
    setAttribute(n,v){this.attributes[n]=v},
    focus(){this.focused=true},scrollIntoView(){},
    classList:{toggle(){}},querySelector(){return {disabled:false}},querySelectorAll(){return []},
    append(){},replaceChildren(){},
   });
  }
  return elements.get(id);
 };
 const ctx={
  document:{getElementById:element,querySelectorAll(){return []},addEventListener(){},hidden:false},
  window:{matchMedia(){return {matches:installed}},addEventListener(n,cb){windowListeners[n]=cb}},
  navigator:{userAgent,standalone:installed,maxTouchPoints:5,clipboard:{async writeText(){}}},
  location:{search:query},
  history:{replaceState(){}},
  URLSearchParams,URL,Intl,Image:class {},FileReader:class {},FormData:class {},fetch:async()=>({ok:true,json:async()=>({authenticated:false,onboarding:null})}),
  setInterval(){},clearInterval(){},
 };
 vm.runInNewContext(read('public/assets/merchant-app.js'),ctx,{timeout:1500});
 await new Promise(resolve=>setImmediate(resolve));
 element.fireWindow=(name,event)=>{assert.ok(windowListeners[name]);return windowListeners[name](event)};
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
 assert.match(hero,/<details class="merchant-payout-disclosure">/);
 assert.match(hero,/<summary>Check pay schedule<\/summary>/);
 assert.match(hero,/class="merchant-payout-table"/);
 for(const [tier,share] of [['$100–$499','60%'],['$500–$999','70%'],['$1,000+','80%']]){
  assert.ok(hero.includes(tier),tier+' tier is missing');
  assert.ok(hero.includes('<strong>'+share+'</strong>'),share+' merchant share missing');
 }
 assert.match(hero,/net sale proceeds/);
 assert.match(hero,/30 days after confirmed delivery/);
 assert.match(hero,/individual merchant partnership agreement/);
 assert.doesNotMatch(page,/href="#merchant-pay-schedule"/);
 assert.doesNotMatch(page,/id="merchant-pay-schedule"/);
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

test('iPhone install button opens a visible Safari guide and closes reliably',async()=>{
 const e=await simulateApp({installed:false});
 const button=e('merchantInstallButton');
 assert.equal(e('merchantInstallGuide').hidden,true);
 await button.dispatch();
 assert.equal(e('merchantInstallGuide').hidden,false);
 assert.equal(e('merchantIosInstallSteps').hidden,false);
 assert.equal(e('merchantAndroidInstallSteps').hidden,true);
 assert.equal(button.attributes['aria-expanded'],'true');
 assert.match(e('merchantInstallInstructions').textContent,/Safari/);
 await e('merchantInstallGuideClose').dispatch();
 assert.equal(e('merchantInstallGuide').hidden,true);
 assert.equal(button.attributes['aria-expanded'],'false');
});
test('Android without a native install prompt shows clear instructions instead of a no-op',async()=>{
 const e=await simulateApp({installed:false,userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/127'});
 await e('merchantInstallButton').dispatch();
 assert.equal(e('merchantInstallGuide').hidden,false);
 assert.equal(e('merchantAndroidInstallSteps').hidden,false);
 assert.equal(e('merchantIosInstallSteps').hidden,true);
 assert.match(e('merchantInstallInstructions').textContent,/browser.*menu/);
});
test('Android native prompt opens when browser provides beforeinstallprompt',async()=>{
 const e=await simulateApp({installed:false,userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/127'});
 let prompts=0,prevented=0;
 e.fireWindow('beforeinstallprompt',{preventDefault(){prevented++},prompt:async()=>{prompts++},userChoice:Promise.resolve({outcome:'accepted'})});
 await e('merchantInstallButton').dispatch();
 assert.equal(prevented,1);
 assert.equal(prompts,1);
 assert.equal(e('merchantInstallGuide').hidden,true);
});
test('Dismissed native Android install prompt falls back to visible guide',async()=>{
 const e=await simulateApp({installed:false,userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/127'});
 e.fireWindow('beforeinstallprompt',{preventDefault(){},prompt:async()=>{},userChoice:Promise.resolve({outcome:'dismissed'})});
 await e('merchantInstallButton').dispatch();
 assert.equal(e('merchantInstallGuide').hidden,false);
 assert.match(e('merchantInstallInstructions').textContent,/cancelled/);
});
test('App manifest advertises correctly sized PNG install icons and iOS touch icon',()=>{
 const manifest=JSON.parse(read('public/merchant-manifest.webmanifest'));
 for(const size of [192,512]){
  const icon=manifest.icons.find(icon=>icon.sizes===size+'x'+size);
  assert.ok(icon,'missing '+size+'px PWA icon');
  assert.equal(icon.type,'image/png');
  assert.equal(icon.src,'/assets/merchant-icon-'+size+'.png');
  const bytes=fs.readFileSync(path.join(root,'public'+icon.src));
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(bytes.readUInt32BE(16),size);
  assert.equal(bytes.readUInt32BE(20),size);
 }
 assert.match(read('public/merchant.html'),/rel="apple-touch-icon" sizes="192x192" href="\/assets\/merchant-icon-192.png"/);
});
