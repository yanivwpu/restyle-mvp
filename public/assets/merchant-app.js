(()=>{'use strict';
const $=id=>document.getElementById(id),sections=['merchantInstallGate','merchantRegister','merchantPending','merchantSignIn','merchantActivate','merchantHome'];
let deferredInstall=null;
const installedMode=()=>Boolean(window.matchMedia?.('(display-mode: standalone)').matches||
  window.matchMedia?.('(display-mode: fullscreen)').matches||navigator.standalone===true);
const hasLegacyInvite=()=>new URLSearchParams(location.search).has('invite');
// Standard browser visitors see installation only. Existing emailed legacy invitations remain usable.
const show=id=>{
 const screen=!installedMode()&&!(hasLegacyInvite()&&id==='merchantActivate')?'merchantInstallGate':id;
 for(const name of sections)$(name).hidden=name!==screen;
 $('merchantLoading').hidden=true;
};
const api=async(url,opts)=>{const r=await fetch(url,{credentials:'same-origin',...opts});const data=await r.json();if(!r.ok)throw Error(data.error||'Please try again.');return data;};
const formBody=f=>Object.fromEntries(new FormData(f).entries());
function pane(name){for(const id of ['inventory','upload','shipping','earnings','store'])$('merchant'+id[0].toUpperCase()+id.slice(1)).hidden=id!==name;document.querySelectorAll('[data-tab]').forEach(button=>button.classList.toggle('active',button.dataset.tab===name));}
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>pane(button.dataset.tab)));
document.querySelectorAll('[data-jump]').forEach(button=>button.addEventListener('click',()=>pane(button.dataset.jump)));
const money=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(cents)||0)/100);
const put=(node,tag,value,cls)=>{const el=document.createElement(tag);el.textContent=value;if(cls)el.className=cls;node.append(el);return el;};
async function refresh(){
 const data=await api('/api/merchant/items'),inventory=$('merchantItemList'),shipping=$('merchantShippingList'),earnings=$('merchantEarningsList');
 inventory.replaceChildren();shipping.replaceChildren();earnings.replaceChildren();
 for(const item of data.items){const card=put(inventory,'article','', 'merchant-item');put(card,'h3',item.brand+' · '+item.category);put(card,'p',item.condition+' • '+item.photo_count+' photo(s)');put(card,'span',item.status==='SUBMITTED'?'In SHUKCHIC review':item.status.replaceAll('_',' '),'merchant-status');}
 if(!data.items.length)put(inventory,'p','No items yet. Tap Add item and upload your first product.','merchant-note');
 for(const order of data.orders){const card=put(shipping,'article','', 'merchant-item');put(card,'h3','Order '+order.ebay_order_id);put(card,'p',order.carrier+' · '+order.status.replaceAll('_',' '));if(order.tracking)put(card,'p','Tracking '+order.tracking);
 const link=put(card,'a','View shipping QR / label','merchant-primary');link.href='/api/merchant/shipping-label/'+encodeURIComponent(order.id);link.target='_blank';link.rel='noopener';
 if(['READY_TO_SHIP','TRACKING_AVAILABLE'].includes(order.status)){const btn=put(card,'button','I handed it to the carrier','merchant-outline');btn.type='button';btn.addEventListener('click',async()=>{btn.disabled=true;try{await api('/api/merchant/shipping/'+order.id,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});await refresh();}catch(e){alert(e.message);btn.disabled=false;}});}
 }
 if(!data.orders.length)put(shipping,'p','No shipping tasks yet. SHUKCHIC will add a QR code or label when one of your items sells.','merchant-note');
 let subtotal=0;for(const order of data.orders){const earningsCents=Math.round(order.order_total_cents*(100-data.commissionPercent)/100);subtotal+=earningsCents;const line=put(earnings,'article','', 'merchant-item');put(line,'h3',money(earningsCents));put(line,'p','Order '+order.ebay_order_id+' · '+order.status.replaceAll('_',' '));}
 $('merchantEarningsTotal').textContent=money(subtotal);$('merchantEarningsRate').textContent='Estimated '+(100-data.commissionPercent)+'% merchant share of recorded sales';
 if(!data.orders.length)put(earnings,'p','Earnings appear as verified eBay orders are assigned to your inventory.','merchant-note');
}
async function startHome(data){const m=data.merchant;$('merchantBusinessName').textContent=m.storeName||m.business;$('merchantAddress').textContent='Ships from '+m.city+', '+m.state+' '+m.postalCode;show('merchantHome');
 const form=$('merchantStoreForm');for(const [field,value] of Object.entries({storeName:m.storeName||m.business,street:m.street||'',city:m.city,state:m.state,postalCode:m.postalCode})){form.elements[field].value=value;}
 pane(m.storeReady?'inventory':'store');if(!m.storeReady)$('merchantStoreStatus').textContent='Complete your real ship-from address before uploading inventory.';
 try{const signed=await api('/api/merchant/agreement');$('merchantSignedAgreement').textContent=signed.agreement.agreement_text+'\n\nSigned by: '+signed.agreement.signature+'\nSigned at: '+signed.agreement.signed_at;}catch{}
 await refresh();
}
$('merchantStoreForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,output=$('merchantStoreStatus'),button=form.querySelector('button[type=submit]');if(!form.reportValidity())return;button.disabled=true;output.textContent='Saving store…';try{await api('/api/merchant/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(formBody(form))});output.textContent='Store shipping details saved.';pane('inventory');}catch(err){output.textContent=err.message;}finally{button.disabled=false;}});

async function checkSession(){
 const data=await api('/api/merchant/session');
 if(data.authenticated){await startHome(data);return;}
 if(data.onboarding){showPending(data.onboarding);return;}
 show(new URLSearchParams(location.search).has('start')?'merchantRegister':'merchantSignIn');
}
function showPending(data){
 $('merchantPendingName').textContent=data.business||'Your boutique';
 const approved=data.status==='INVITED'&&data.readyToSign;
 $('merchantPendingStatus').textContent=approved?'Approved — agreement ready':data.status==='INVITATION_EXPIRED'?'Invitation needs renewal':data.status==='ACTIVE'?'Account activated — sign in':data.status==='REJECTED'?'Store application not approved':'Your store is under review';
 $('merchantPendingText').textContent=approved?'Welcome! Review and sign your individual partnership terms below to unlock your inventory, shipping and earnings tools.':data.status==='INVITATION_EXPIRED'?'Your approval invitation has expired. Contact SHUKCHIC to renew it.':data.status==='ACTIVE'?'Your account is active. Sign in to continue.':data.status==='REJECTED'?'Contact SHUKCHIC for more information.':'We received your store details. You can reopen this app anytime to check your approval. SHUKCHIC also sends an email when your agreement is ready.';
 $('merchantPendingAgreementForm').hidden=!approved;
 if(approved){
  $('merchantApprovedCommission').textContent='SHUKCHIC commission: '+data.commissionPercent+'%. See the full agreement for fees and settlement terms.';
  $('merchantPendingTerms').textContent=data.agreementText;
 }
 show('merchantPending');
}
$('merchantRegisterForm').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type=submit]'),output=$('merchantRegisterError');
 if(!installedMode()){show('merchantInstallGate');return;}
 if(!form.reportValidity())return;button.disabled=true;output.textContent='';
 try{
  const details={...formBody(form),confirmBusinessInventory:form.elements.confirmBusinessInventory.checked};
  await api('/api/merchant/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(details)});
  history.replaceState({},'', '/merchant');
  await checkSession();
 }catch(err){output.textContent=err.message;}finally{button.disabled=false;}
});
$('merchantLoginForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;try{await api('/api/merchant/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(formBody(form))});history.replaceState({},'', '/merchant');await checkSession();}catch(err){$('merchantLoginError').textContent=err.message;}});
$('merchantGoRegister').addEventListener('click',()=>show('merchantRegister'));
$('merchantGoLogin').addEventListener('click',()=>show('merchantSignIn'));
$('merchantCheckApproval').addEventListener('click',()=>checkSession().catch(err=>{$('merchantPendingText').textContent=err.message;}));
$('merchantPendingAgreementForm').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget,btn=form.querySelector('button[type=submit]');
 if(!form.reportValidity())return;btn.disabled=true;$('merchantPendingError').textContent='';
 try{
  await api('/api/merchant/onboarding/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...formBody(form),accept:form.elements.accept.checked,confirmBusinessInventory:form.elements.confirmBusinessInventory.checked})});
  await checkSession();
 }catch(err){$('merchantPendingError').textContent=err.message;}finally{btn.disabled=false;}
});
function setupInstall(){
 const button=$('merchantInstallButton'),instructions=$('merchantInstallInstructions'),copy=$('merchantCopyLink'),status=$('merchantCopyStatus');
 if(!installedMode()){
  const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||(/Macintosh/.test(navigator.userAgent)&&navigator.maxTouchPoints>1);
  const mobile=/Android|iPhone|iPad|iPod/.test(navigator.userAgent)||ios;
  instructions.textContent=ios?'On iPhone or iPad, open Safari, tap Share, select Add to Home Screen, and confirm Open as Web App. Then tap the SHUKCHIC icon.':
    /Android/.test(navigator.userAgent)?'On Android, tap Install Merchant App. If no prompt appears, use the browser menu and choose Install app or Add to Home screen. Then tap the SHUKCHIC icon.':
    'On your phone, open shukchic.com/merchant in Safari (iPhone) or Chrome (Android), then add it to your Home Screen. Open the SHUKCHIC icon to register.';
  if(!mobile){button.textContent='Open link on your phone';button.addEventListener('click',()=>{instructions.focus?.();});}
 }
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;});
 window.addEventListener('appinstalled',()=>{deferredInstall=null;button.textContent='Open SHUKCHIC from Home Screen';instructions.textContent='Installed. Open the SHUKCHIC icon from your Home Screen to register or sign in.';});
 button.addEventListener('click',async()=>{
  if(deferredInstall){
   const prompt=deferredInstall;deferredInstall=null;
   try{await prompt.prompt();}catch{}
  } else {
   instructions.setAttribute('tabindex','-1');instructions.focus();
  }
 });
 copy.addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText('https://shukchic.com/merchant');status.textContent='App link copied';}
  catch{status.textContent='Open shukchic.com/merchant on your phone';}
 });
 if('serviceWorker' in navigator)navigator.serviceWorker.register('/merchant-sw.js',{scope:'/merchant'}).catch(()=>{});
}
setupInstall();
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!$('merchantPending').hidden)checkSession().catch(()=>{});});
setInterval(()=>{if(!document.hidden&&!$('merchantPending').hidden)checkSession().catch(()=>{});},60000);
$('merchantRefreshTracking').addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;button.textContent='Checking…';try{await api('/api/merchant/sync-shipping',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});await refresh();}catch(err){alert(err.message);}finally{button.disabled=false;button.textContent='Refresh tracking';}});
async function signOut(){await api('/api/merchant/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});show('merchantSignIn');}
$('merchantLogout').addEventListener('click',signOut);
$('merchantPendingLogout').addEventListener('click',signOut);
const params=new URLSearchParams(location.search),invite=params.get('invite');if(invite){
 show('merchantActivate');api('/api/merchant/invite?token='+encodeURIComponent(invite)).then(data=>{const form=$('merchantActivateForm');$('merchantInviteBusiness').textContent=data.business;$('merchantInviteCommission').textContent='SHUKCHIC commission: '+data.commissionPercent+'% of the agreed sales basis. See signed terms for all deductions and payout conditions.';$('merchantAgreementText').textContent=data.agreementText;form.hidden=false;
 form.addEventListener('submit',async e=>{e.preventDefault();if(!form.reportValidity())return;const submit=form.querySelector('button[type=submit]');submit.disabled=true;
 try{const body={...formBody(form),token:invite,accept:form.elements.accept.checked,confirmBusinessInventory:form.elements.confirmBusinessInventory.checked};await api('/api/merchant/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});history.replaceState({},'', '/merchant');await startHome(await api('/api/merchant/session'));}catch(err){$('merchantInviteStatus').textContent=err.message;submit.disabled=false;}
 });}).catch(err=>{$('merchantInviteStatus').textContent=err.message;});
}else{checkSession().catch(()=>show('merchantSignIn'));}
const photos=[],fileInput=$('merchantPhotoInput'),previews=$('merchantPhotoPreviews'),form=$('merchantItemForm');
function render(){previews.replaceChildren();photos.forEach((x,i)=>{const card=put(previews,'div','', 'merchant-preview');const img=document.createElement('img');img.src=x.data;img.alt='Photo '+(i+1);card.append(img);const remove=put(card,'button','×');remove.type='button';remove.setAttribute('aria-label','Remove photo '+(i+1));remove.onclick=()=>{photos.splice(i,1);render();};});}
function compress(file){return new Promise((resolve,reject)=>{if(!['image/jpeg','image/png','image/webp'].includes(file.type))return reject(Error('Only JPG, PNG and WebP supported.'));const reader=new FileReader();reader.onerror=()=>reject(Error('Cannot read photo.'));reader.onload=()=>{const img=new Image();img.onerror=()=>reject(Error('Cannot open image.'));img.onload=()=>{const c=document.createElement('canvas'),scale=Math.min(1,1800/Math.max(img.width,img.height));c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));c.getContext('2d').drawImage(img,0,0,c.width,c.height);const data=c.toDataURL('image/jpeg',.8);if(data.length>7000000)return reject(Error('Photo too large.'));resolve({data});};img.src=reader.result;};reader.readAsDataURL(file);});}
fileInput.addEventListener('change',async()=>{try{const files=[...fileInput.files];if(photos.length+files.length>6)throw Error('Maximum six photos.');for(const file of files)photos.push(await compress(file));render();$('merchantItemStatus').textContent='';}catch(err){$('merchantItemStatus').textContent=err.message;}finally{fileInput.value='';}});
form.addEventListener('submit',async e=>{e.preventDefault();if(!form.reportValidity())return;if(!photos.length){$('merchantItemStatus').textContent='Add at least one photo.';return;}const btn=form.querySelector('[type=submit]');btn.disabled=true;$('merchantItemStatus').textContent='Uploading photos…';const body={...formBody(form),stockConfirmed:form.elements.stockConfirmed.checked,photos};
try{await api('/api/merchant/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});form.reset();photos.length=0;render();await refresh();pane('inventory');}catch(err){$('merchantItemStatus').textContent=err.message;}finally{btn.disabled=false;}});
})();