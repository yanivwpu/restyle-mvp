const $=(s)=>document.querySelector(s);
let items=[], selected=null;
const esc=(x)=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const label=(s)=>String(s||'').replace(/_/g,' ').toLowerCase().replace(/(^|\s)\S/g,c=>c.toUpperCase());
const money=(n)=>n==null?'—':`$${(n/100).toFixed(2)}`;
async function api(p,opts){const res=await fetch(p,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...opts});const body=await res.json();if(!res.ok)throw new Error(body.error||`HTTP ${res.status}`);return body;}
async function init(){const r=await api('/api/admin/session');$('#loginView').hidden=r.authenticated;$('#dashboard').hidden=!r.authenticated;$('#logoutBtn').hidden=!r.authenticated;if(r.authenticated)await Promise.all([refresh(),loadEbayStatus()]);}
$('#loginForm').addEventListener('submit',async(e)=>{e.preventDefault();const err=$('#loginError');err.hidden=true;try{await api('/api/admin/login',{method:'POST',body:JSON.stringify({password:e.target.elements.password.value})});e.target.reset();await init();}catch(e){err.hidden=false;err.textContent=e.message;}});
$('#logoutBtn').addEventListener('click',async()=>{await api('/api/admin/logout',{method:'POST',body:'{}'});items=[];selected=null;await init();});
$('#refreshBtn')?.addEventListener('click',()=>{refresh();loadEbayStatus();});
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
  start.textContent=oauth.connected?'Reconnect eBay seller':'Connect eBay seller';
  $('#ebayOrdersBtn').hidden=!oauth.connected;
  if(oauth.connected&&!ebayResults)loadEbayOrders();
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
   start.hidden=refresh.hidden=disconnect.hidden=true;$('#ebayOrdersBtn').hidden=true;$('#ebayOrdersBtn').hidden=true;link.hidden=false;
 }
}
let ebayPage=0,ebayResults=null;
const ebayReadable=s=>String(s||'').toLowerCase().replace(/_/g,' ');
const ebayOrderType=o=>{const p=o.paymentStatus.toUpperCase(),f=o.fulfillmentStatus.toUpperCase();
 if(p.includes('REFUND'))return 'refunded';
 if(p.includes('DISPUTE'))return 'disputed';
 if(f==='FULFILLED')return 'shipped';
 if(p==='PAID'||p==='FULLY_PAID')return 'awaiting';
 return 'disputed';
};
const ebayLabel=t=>({SHIPPING_LABEL:'Shipping label',SALE:'Sale',REFUND:'Refund',DISPUTE:'Dispute',CREDIT:'Credit adjustment'}[t]||ebayReadable(t));
function renderEbayOrders(){
 const out=$('#ebayOrdersResult');out.textContent='';
 if(!ebayResults){out.textContent='Select Refresh orders to load the latest sales.';return;}
 const filter=$('#ebaySalesFilter').value,q=$('#ebaySalesSearch').value.trim().toLowerCase();
 const orders=ebayResults.orders.filter(o=>(filter==='all'||ebayOrderType(o)===filter||filter==='paid'&&o.paymentStatus==='PAID')&&(!q||[o.orderId,o.title,o.sku].join(' ').toLowerCase().includes(q)));
 const title=document.createElement('p');title.className='ebay-sales-count';title.textContent='Showing '+orders.length+' of '+ebayResults.orders.length+' orders on this page'+(ebayResults.total!==null?' · '+ebayResults.total+' total from eBay':'');out.append(title);
 if(!orders.length){const empty=document.createElement('p');empty.textContent='No matching orders on this page.';out.append(empty);}
 for(const o of orders){
  const row=document.createElement('article');row.className='ebay-sales-order';out.append(row);
  const media=document.createElement('div');media.className='ebay-item-photo';row.append(media);
  if(o.imageUrl){const img=document.createElement('img');img.src=o.imageUrl;img.alt='eBay item image';img.loading='lazy';img.referrerPolicy='no-referrer';media.append(img);}
  else{media.textContent='No photo';media.title='No verified photo returned by eBay';}
  const content=document.createElement('div');content.className='ebay-item-copy';row.append(content);
  const name=document.createElement(o.listingId?'a':'strong');name.textContent=o.title;name.className='ebay-item-title';
  if(o.listingId){name.href='https://www.ebay.com/itm/'+o.listingId;name.target='_blank';name.rel='noopener noreferrer';}
  content.append(name);
  const meta=document.createElement('div');meta.className='ebay-order-meta';meta.textContent='Order '+o.orderId+' · '+(o.createdAt?new Date(o.createdAt).toLocaleDateString()+' · ':'')+o.lineItems+' item(s)'+(o.sku?' · SKU '+o.sku:'');content.append(meta);
  const status=document.createElement('span');status.className='ebay-order-state';status.textContent=ebayReadable(o.paymentStatus)+' · '+ebayReadable(o.fulfillmentStatus);content.append(status);
  const match=o.inventoryMatch||{status:'UNMATCHED',issues:['MATCH_NOT_CHECKED']};
  const matched=document.createElement('div');matched.className='ebay-match-status';
  const phrase=match.status==='MATCHED'?'Inventory matched':match.status==='NEEDS_REVIEW'?'Inventory match needs review':'Not matched to SHUKCHIC inventory';
  matched.textContent=phrase+(match.submissionId?' · Ref '+match.submissionId:'')+(match.issues?.length?' · '+match.issues.map(ebayReadable).join(', '):'');
  matched.dataset.status=match.status;content.append(matched);
  const action=document.createElement('button');action.type='button';action.className='ebay-finance-action';action.textContent='Review finances';row.append(action);
  const detail=document.createElement('div');detail.className='ebay-finance-detail';detail.hidden=true;out.append(detail);
  action.addEventListener('click',async()=>{
   if(!detail.hidden){detail.hidden=true;action.textContent='Review finances';return;}
   detail.hidden=false;action.disabled=true;action.textContent='Loading finances…';detail.textContent='Loading transactions…';
   try{
    const data=await api('/api/admin/ebay/finances-preview?orderId='+encodeURIComponent(o.orderId));
    detail.textContent='';const h=document.createElement('strong');h.textContent='Financial transactions ('+data.transactions.length+') · '+(data.payoutStatus||'Under review');detail.append(h);
    const table=document.createElement('table');table.className='ebay-finance-table';const head=document.createElement('tr');
    for(const label of ['Type','Status','Entry','Amount']){const cell=document.createElement('th');cell.textContent=label;head.append(cell);}table.append(head);
    for(const t of data.transactions){const tr=document.createElement('tr');for(const value of [ebayLabel(t.type),ebayReadable(t.status),ebayReadable(t.bookingEntry),t.amount===null?'Unavailable':t.amount+' USD']){const td=document.createElement('td');td.textContent=value;tr.append(td);}table.append(tr);}
    detail.append(table);
    if(data.businessSummary){
     const view=document.createElement('div');view.className='ebay-business-summary';
     const header=document.createElement('strong');header.textContent=data.businessSummary.label;view.append(header);
     const body=document.createElement('p');body.textContent=data.businessSummary.explanation;view.append(body);
     const lines=document.createElement('p');
     lines.textContent='Shipping charges and credits are included in the totals below. Refund and dispute adjustments require review.';
     view.append(lines);
     const notice=document.createElement('small');notice.textContent='Consignor payment: Not eligible. All amounts provisional.';view.append(notice);
     detail.append(view);
    }
    if(data.ledger){
     const dollars=n=>(n<0?'−':'')+'$'+(Math.abs(n)/100).toFixed(2);
     const cards=document.createElement('div');cards.className='ebay-money-cards';
     const makeCard=(label,value,kind)=>{const el=document.createElement('div');el.className='ebay-money-card '+kind;const t=document.createElement('small');t.textContent=label;const v=document.createElement('strong');v.textContent=value;el.append(t,v);cards.append(el);};
     makeCard('Money received',dollars(data.ledger.creditCents),'credit');
     makeCard('Charges & refunds',dollars(data.ledger.debitCents),'debit');
     makeCard('Estimated balance',dollars(data.ledger.netCents),'estimate');
     detail.append(cards);
     const explain=document.createElement('p');explain.className='ebay-plain-note';explain.textContent='Estimated from eBay activity only. Not a verified profit or consignor payment.';detail.append(explain);
     const verdict=document.createElement('p');verdict.className='ebay-earnings-notice';
     verdict.textContent=data.earnings?.available?'eBay earnings available for comparison. Reported net income: '+(data.earnings.netIncome??'Not supplied')+' USD. Review is still required.':data.earnings?.reauthorizationRequired?'Official eBay earnings are not available to this app yet. Your existing transactions are still available; no reconnection needed.':'Official eBay earnings not yet available. '+(data.earnings?.reason||'');
     detail.append(verdict);
    }
    const readable={FINANCIAL_MAPPING_REQUIRES_REVIEW:'Confirm fees and adjustments',DELIVERY_NOT_VERIFIED:'Delivery still needs verification',NO_PAYOUT_ALLOWED:'Consignor payment not approved',REFUND_OR_DISPUTE_REQUIRES_REVIEW:'Refund or dispute needs review',ORDER_EARNINGS_NOT_VERIFIED:'Official eBay earnings not confirmed',TRANSACTION_AMOUNTS_NOT_VERIFIED:'Some amounts need verification',TRANSACTION_PAGINATION_INCOMPLETE:'Not all transactions could be loaded'};
    const items=(data.issues||[]).filter(x=>x!=='NO_PAYOUT_ALLOWED'&&!(x==='ORDER_EARNINGS_NOT_VERIFIED'&&data.earnings?.reauthorizationRequired)).map(x=>readable[x]||ebayReadable(x));
    const note=document.createElement('p');note.className='ebay-plain-note';note.textContent='To finish checking: '+items.join(' · ')+(data.shippingLabelCharges>1?' · '+data.shippingLabelCharges+' separate shipping charges':'');detail.append(note);action.textContent='Hide finances';
   }catch(e){detail.textContent='Financial preview failed: '+e.message;}
   finally{action.disabled=false;if(action.textContent==='Loading finances…')action.textContent='Review finances';}
  });
 }
 $('#ebayPageLabel').textContent='Page '+(ebayPage+1);
 $('#ebayPrevPage').disabled=ebayPage===0;
 $('#ebayNextPage').disabled=!ebayResults.hasMore;
}
async function loadEbayOrders(){
 const btn=$('#ebayOrdersBtn');btn.disabled=true;$('#ebayOrdersResult').textContent='Loading eBay orders (read-only)…';
 try{ebayResults=await api('/api/admin/ebay/orders-preview?offset='+(ebayPage*20));renderEbayOrders();}
 catch(e){$('#ebayOrdersResult').textContent='Could not load eBay orders: '+e.message;}
 finally{btn.disabled=false;}
}
$('#ebayOrdersBtn')?.addEventListener('click',loadEbayOrders);
$('#ebaySalesFilter')?.addEventListener('change',renderEbayOrders);
$('#ebaySalesSearch')?.addEventListener('input',renderEbayOrders);
$('#ebayPrevPage')?.addEventListener('click',()=>{if(ebayPage>0){ebayPage--;loadEbayOrders();}});
$('#ebayNextPage')?.addEventListener('click',()=>{if(ebayResults?.hasMore){ebayPage++;loadEbayOrders();}});
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
