const $=(s)=>document.querySelector(s);
let items=[], selected=null;
const esc=(x)=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const label=(s)=>String(s||'').replace(/_/g,' ').toLowerCase().replace(/(^|\s)\S/g,c=>c.toUpperCase());
const money=(n)=>n==null?'—':`$${(n/100).toFixed(2)}`;
async function api(p,opts){const res=await fetch(p,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...opts});const body=await res.json();if(!res.ok)throw new Error(body.error||`HTTP ${res.status}`);return body;}
async function init(){const r=await api('/api/admin/session');$('#loginView').hidden=r.authenticated;$('#dashboard').hidden=!r.authenticated;$('#logoutBtn').hidden=!r.authenticated;if(r.authenticated)await Promise.all([refresh(),loadEbayStatus()]);}
$('#loginForm').addEventListener('submit',async(e)=>{e.preventDefault();const err=$('#loginError');err.hidden=true;try{await api('/api/admin/login',{method:'POST',body:JSON.stringify({password:e.target.elements.password.value})});e.target.reset();await init();}catch(e){err.hidden=false;err.textContent=e.message;}});
$('#logoutBtn').addEventListener('click',async()=>{await api('/api/admin/logout',{method:'POST',body:'{}'});items=[];selected=null;await init();});
$('#refreshBtn').addEventListener('click',()=>{refresh();loadEbayStatus();});
$('#filter').addEventListener('change',drawList);$('#search').addEventListener('input',drawList);
$('#ebayDemo')?.addEventListener('toggle',async e=>{
 if(!e.currentTarget.open)return;
 const node=$('#ebayDemoResult');node.textContent='Loading sample order…';
 try{
  const data=await api('/api/admin/ebay/sample');
  if(!data.demo||!data.nonBinding)throw Error('Demo validation failed.');
  const holds=Array.isArray(data.issues)?data.issues.map(v=>String(v).replaceAll('_',' ').toLowerCase()).join('; '):'unknown';
  node.textContent='Demo order: $'+(data.salePriceCents/100).toFixed(2)+' · SKU '+data.sku+'. Pending: '+holds+'. This is synthetic data, not a real eBay sale.';
 }catch(err){node.textContent='Demo unavailable: '+err.message;}
});
async function loadEbayStatus(){
 const badge=$('#ebaySyncStatus'),description=$('#ebaySyncText'),note=$('#ebaySyncNote'),link=$('#ebaySetupLink');
 const start=$('#ebayConnectBtn'),refresh=$('#ebayRefreshBtn'),disconnect=$('#ebayDisconnectBtn');
 try{
  const info=await api('/api/admin/ebay/status');
  const oauth=info.oauth||{};
  start.hidden=!oauth.configured;
  refresh.hidden=!oauth.connected;
  disconnect.hidden=!oauth.connected;
  link.hidden=!!oauth.configured;
  badge.textContent=oauth.connected?'Seller connected':oauth.configured?'Ready to authorize':'Setup incomplete';
  badge.classList.toggle('connected',!!oauth.connected);
  if(oauth.connected){
   description.textContent='Authorized seller: '+(oauth.sellerUsername||'unknown')+'. Token storage is encrypted; order sync and listing publication are still OFF.';
   note.textContent='Use Verify token refresh to test renewing access without publishing or importing anything. Reauthorization is available using Connect.';
  }else if(oauth.configured){
   description.textContent='Production API credentials are configured. To connect the correct seller account, select Connect eBay seller here in the admin—not Test Sign-In in the developer portal.';
   note.textContent='The connection uses a 10-minute single-use authorization state and verifies the seller identity before storing encrypted tokens.';
  }else{
   description.textContent='To finish eBay OAuth, add the saved Production RuName to Railway as EBAY_RUNAME and a separate 32-byte base64url encryption key as EBAY_OAUTH_ENCRYPTION_KEY.';
   note.textContent='Existing Production App ID and Client Secret are already configured. Do not copy their values into chat. No live seller data is connected.';
  }
 }catch(error){
   badge.textContent='Status unavailable';description.textContent='Could not verify eBay authorization readiness.';
   note.textContent=error.message;
   start.hidden=refresh.hidden=disconnect.hidden=true;$('#ebayOrdersBtn').hidden=true;link.hidden=false;
 }
}
$('#ebayOrdersBtn')?.addEventListener('click',async()=>{
 const btn=$('#ebayOrdersBtn'),out=$('#ebayOrdersResult');btn.disabled=true;out.hidden=false;out.textContent='Checking the latest eBay orders (read-only)…';
 try{
  const data=await api('/api/admin/ebay/orders-preview');
  out.textContent='';
  const headline=document.createElement('strong');headline.textContent='Live eBay orders: '+data.previewCount+' found (maximum 10; preview only)';out.append(headline);
  if(!data.previewCount){const p=document.createElement('p');p.textContent='No orders returned. No data was imported.';out.append(p);}
  for(const order of data.orders){const p=document.createElement('p');p.textContent='Order '+order.orderId+' — '+order.paymentStatus+' / '+order.fulfillmentStatus+' — '+order.lineItems+' line item(s)';out.append(p);}
 }catch(err){out.textContent='Live order preview failed: '+err.message;}
 finally{btn.disabled=false;}
});
$('#ebayProbeBtn')?.addEventListener('click',async()=>{
 const btn=$('#ebayProbeBtn'),output=$('#ebayProbeResult');
 btn.disabled=true;output.hidden=false;output.textContent='Checking eBay Production API…';
 try{
  const result=await api('/api/admin/ebay/oauth/probe',{method:'POST',body:'{}'});
  output.textContent=result.reachable?'PASS: eBay Production API issued an application token. Seller authorization still needs completion.':'FAILED: '+String(result.status||'Unknown API error');
 }catch(err){output.textContent='FAILED: '+err.message;}
 finally{btn.disabled=false;}
});
$('#ebayConnectBtn')?.addEventListener('click',async()=>{
 const btn=$('#ebayConnectBtn');btn.disabled=true;
 try{
  const result=await api('/api/admin/ebay/oauth/start',{method:'POST',body:'{}'});
  const u=new URL(result.authorizationUrl);
  if(u.origin!=='https://auth.ebay.com')throw Error('Invalid eBay authorization destination.');
  window.location.assign(u.toString());
 }catch(e){alert(e.message);btn.disabled=false;}
});
$('#ebayRefreshBtn')?.addEventListener('click',async()=>{
 const b=$('#ebayRefreshBtn'),output=$('#ebayProbeResult');b.disabled=true;output.hidden=false;output.textContent='Refreshing seller access token…';
 try{const result=await api('/api/admin/ebay/oauth/refresh',{method:'POST',body:'{}'});await loadEbayStatus();output.textContent='PASS: eBay seller token renewed for '+String(result.sellerUsername||'connected seller')+'. No listings or orders were changed.';}
 catch(e){output.textContent='FAILED: Token refresh unsuccessful: '+e.message;}finally{b.disabled=false;}
});
$('#ebayDisconnectBtn')?.addEventListener('click',async()=>{
 if(!confirm('Disconnect seller authorization from SHUKCHIC? No listing or transaction data will be changed on eBay.'))return;
 const b=$('#ebayDisconnectBtn');b.disabled=true;
 try{await api('/api/admin/ebay/oauth/disconnect',{method:'POST',body:'{}'});await loadEbayStatus();}
 catch(e){alert(e.message);}finally{b.disabled=false;}
});
async function refresh(){try{const r=await api('/api/admin/submissions');items=r.items;$('#count').textContent=`(${items.length})`;const review=items.filter(x=>['SUBMITTED','NEEDS_INFO'].includes(x.status)).length;const waiting=items.filter(x=>['ACCEPTED','AWAITING_SHIPMENT'].includes(x.status)).length;const onhand=items.filter(x=>['RECEIVED','READY_TO_LIST','LISTED'].includes(x.status)).length;$('#stats').innerHTML=[['Total submissions',items.length],['Needs review',review],['Awaiting inventory',waiting],['Warehouse / listing',onhand]].map(([t,v])=>`<div class="stat"><strong>${v}</strong><span>${t}</span></div>`).join('');drawList();if(!items.length){$('#detailPanel').innerHTML='<div class="empty-state"><div>◎</div><h2>Ready for the first item</h2><p>Upload a test item to see review, agreement signing, AI draft preparation and settlement tools. Nothing will be published to eBay.</p><a href="/submit" class="small-button">Upload a test item</a></div>';}else if(selected&&items.some(x=>x.id===selected))await showDetail(selected);}catch(e){$('#itemList').textContent='Unable to refresh: '+e.message;}}
function drawList(){const q=$('#search').value.toLowerCase(),filter=$('#filter').value;const matches=items.filter(x=>(!filter||x.status===filter)&&(!q||[x.brand,x.first_name,x.email,x.id].join(' ').toLowerCase().includes(q)));const list=$('#itemList');list.replaceChildren();if(matches.length===0){list.innerHTML=items.length===0?'<div class="no-results"><p>No submissions yet.</p><a href="/submit" class="small-button">Submit a test item</a></div>':'<p class="no-results">No submissions match your search.</p>';return;}matches.forEach(x=>{const row=document.createElement('button');row.type='button';row.className='item-row'+(x.id===selected?' selected':'');const thumb=x.photo_count?`<img class="item-thumbnail" src="/api/admin/photos/${esc(x.first_photo||'')}" alt=""/>`:'<span class="item-thumbnail"></span>'; // thumbnail ID retrieved through detail; placeholder until available
row.innerHTML=`<div class="item-thumbnail" style="display:grid;place-items:center;font-size:25px;color:#e8a46e">◇</div><div class="item-copy"><strong>${esc(x.brand)} · ${esc(x.category)}</strong><small>${esc(x.first_name)} · ${new Date(x.created_at).toLocaleDateString()}</small><span class="badge-status ${x.status==='REJECTED'?'rejected':['LISTED','PAID','READY_TO_LIST'].includes(x.status)?'ready':''}">${label(x.status)}</span></div>`;row.addEventListener('click',()=>showDetail(x.id));list.append(row);});}
async function showDetail(id){selected=id;drawList();const panel=$('#detailPanel');panel.innerHTML='<div class="empty-state"><p>Loading submission…</p></div>';try{const r=await api(`/api/admin/submissions/${encodeURIComponent(id)}`);const x=r.item;const gallery=r.photos.map(p=>`<a href="/api/admin/photos/${encodeURIComponent(p.id)}" target="_blank" rel="noopener"><img src="/api/admin/photos/${encodeURIComponent(p.id)}" alt="Customer-submitted item photo"></a>`).join('');const statusOptions=['SUBMITTED','NEEDS_INFO','ACCEPTED','AWAITING_SHIPMENT','RECEIVED','READY_TO_LIST','LISTED','SOLD','SHIPPED','PAID','REJECTED'].map(s=>`<option ${s===x.status?'selected':''} value="${s}">${label(s)}</option>`).join('');const agreement=r.agreement;const signPanel=`<section class="detail-mail"><h3>Signed consignment agreement</h3><p class="detail-meta">${agreement?.state==='SIGNED'?`Signed by ${esc(agreement.signer_name)} on ${new Date(agreement.signed_at).toLocaleString()}`:agreement?.state==='PENDING'?'Signing link issued; waiting for customer signature.':r.agreementConfigured?'Not yet sent — approve the item to issue a link.':'Agreement not configured yet. Set reviewed terms and shipping instructions in Railway.'}</p>${agreement?.state==='SIGNED'?`<a class="small-button" href="/api/admin/submissions/${encodeURIComponent(id)}/agreement.pdf" target="_blank" rel="noopener">Download signed agreement PDF ↗</a>`:''}</section>`;const mails=r.mails.map(m=>`<div class="mail-line"><span>${esc(m.kind.replaceAll('_',' '))}</span><strong class="${m.state==='SENT'?'sent':''}">${esc(m.state)}${m.attempts?' · '+m.attempts+' attempt(s)':''}</strong></div>`).join('')||'<p class="no-results">No messages queued.</p>';const history=r.events.slice(0,8).map(e=>`<div class="mail-line"><span>${esc(e.event)}</span><small>${new Date(e.created_at).toLocaleString()}</small></div>`).join('');panel.innerHTML=`<div class="detail-wrap"><div class="detail-head"><div><span class="ref-small">${esc(x.id)}</span><h2>${esc(x.brand)} · ${esc(x.category)}</h2><span class="detail-meta">Submitted ${new Date(x.created_at).toLocaleString()}</span></div><span class="badge-status">${label(x.status)}</span></div><div class="detail-grid"><div class="meta-box"><span>Consignor</span>${esc(x.first_name)}</div><div class="meta-box"><span>Email</span><a href="mailto:${encodeURIComponent(x.email)}">${esc(x.email)}</a></div><div class="meta-box"><span>Phone</span>${esc(x.phone||'Not provided')}</div><div class="meta-box"><span>Condition</span>${esc(x.condition)}</div><div class="meta-box"><span>Description</span>${esc(x.description||'Not provided')}</div><div class="meta-box"><span>Email receipt</span>${esc(x.email_status)}</div></div><div class="gallery">${gallery}</div><form class="detail-editor" id="editForm"><h3>Review & warehouse controls</h3><div class="editor-grid"><label>Status<select name="status">${statusOptions}</select></label><label>Estimated resale price (optional)<input type="number" min="0" max="100000" step="0.01" name="estimateDollars" value="${x.estimate_cents==null?'':(x.estimate_cents/100).toFixed(2)}" placeholder="0.00"></label><label>Incoming tracking<input name="tracking" maxlength="130" value="${esc(x.tracking)}"></label><label>Warehouse SKU<input name="sku" maxlength="90" value="${esc(x.sku)}" placeholder="RS-001"></label><label>Storage bin<input name="binLocation" maxlength="90" value="${esc(x.bin_location)}" placeholder="A-02"></label><label class="verified-row"><input type="checkbox" name="receivedVerified" ${x.received_verified?'checked':''}>Physical item received & verified</label><label class="span-all">Internal notes<textarea name="adminNotes" maxlength="3000">${esc(x.admin_notes)}</textarea></label></div><div class="editor-actions"><button class="btn btn-primary" type="submit">Save Changes</button><p>Approval sends a private e-sign link. Shipping instructions follow signature. Never list without signed terms and verified physical receipt.</p></div><div class="admin-error" id="editError" hidden></div><div class="save-notice" id="saveNotice" role="status"></div></form>${signPanel}<section class="detail-mail"><h3>Confirmation and status emails</h3>${mails}<button class="small-button" id="retryEmail" style="margin-top:13px" type="button">Retry unsent emails</button><span class="save-notice" id="retryNotice"></span></section><section class="detail-history"><h3>Audit trail</h3>${history}</section></div>`;
 if(window.restyleListingPanel)window.restyleListingPanel.mount(id,r.listing);
 if(window.shukchicSettlementPanel)window.shukchicSettlementPanel.mount(id,r.settlement,x);
 $('#editForm').addEventListener('submit',async e=>{e.preventDefault();$('#editError').hidden=true;$('#saveNotice').textContent='';const f=e.target;const b={status:f.elements.status.value,adminNotes:f.elements.adminNotes.value,tracking:f.elements.tracking.value,sku:f.elements.sku.value,binLocation:f.elements.binLocation.value,receivedVerified:f.elements.receivedVerified.checked,estimateDollars:f.elements.estimateDollars.value};try{await api(`/api/admin/submissions/${id}/update`,{method:'POST',body:JSON.stringify(b)});$('#saveNotice').textContent='Changes saved.';await refresh();}catch(err){$('#editError').textContent=err.message;$('#editError').hidden=false;}});
 $('#retryEmail').addEventListener('click',async()=>{const notice=$('#retryNotice');notice.textContent=' Checking…';try{const result=await api(`/api/admin/submissions/${id}/resend`,{method:'POST',body:'{}'});notice.textContent=result.configured?` ${result.sent} message(s) sent.`:' Email provider not configured.';await refresh();}catch(err){notice.textContent=' '+err.message;}});
 }catch(err){panel.innerHTML=`<div class="empty-state"><p>${esc(err.message)}</p></div>`;}}
init().catch(err=>{$('#loginError').hidden=false;$('#loginError').textContent=err.message;});
